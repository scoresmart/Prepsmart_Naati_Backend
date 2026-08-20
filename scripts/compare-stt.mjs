/**
 * Standalone STT comparison harness.
 *
 * Runs one audio file through Azure Fast Transcription, Google Cloud STT, and
 * OpenAI whisper-1 — the same three engines the score card now compares — and
 * prints each transcript with its timing.
 *
 * It reads keys from .env via dotenv and NEVER prints a key value. Failures
 * report the provider's error text only.
 *
 * Usage:
 *   node scripts/compare-stt.mjs <audio-file-or-url> <lang-code>
 *
 * Examples:
 *   node scripts/compare-stt.mjs ./sample.webm pa
 *   node scripts/compare-stt.mjs "https://...presigned-s3-url..." hi
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";

const [, , src, langArg] = process.argv;
const lang = (langArg || "en").toLowerCase();

if (!src) {
  console.error("Usage: node scripts/compare-stt.mjs <audio-file-or-url> <lang-code>");
  process.exit(1);
}

/* ── key presence check (never prints values) ───────────────────────── */
const required = {
  AZURE_SPEECH_KEY: "azure",
  GOOGLE_TRANSLATE_API_KEY: "google",
  OPENAI_API_KEY: "whisper",
};
console.log("Key presence:");
for (const [name, engine] of Object.entries(required)) {
  const v = process.env[name];
  console.log(`  ${name.padEnd(26)} ${v ? `set (len ${v.length})` : "MISSING"}  → ${engine}`);
}
const azureBase = (process.env.AZURE_SPEECH_ENDPOINT ||
  (process.env.AZURE_SPEECH_REGION
    ? `https://${process.env.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com`
    : "")).replace(/\/+$/, "");
console.log(`  azure endpoint             ${azureBase || "MISSING"}`);
console.log();

/* ── load audio ─────────────────────────────────────────────────────── */
let buffer;
if (/^https?:\/\//i.test(src)) {
  const r = await fetch(src);
  if (!r.ok) {
    console.error(`Failed to fetch audio: ${r.status} ${r.statusText}`);
    process.exit(1);
  }
  buffer = Buffer.from(await r.arrayBuffer());
} else {
  buffer = await readFile(src);
}

/* sniff container from magic bytes — same logic the controller uses */
let mimetype = "audio/webm";
let encoding = "LINEAR16";
let sampleRateHertz = 16000;
const b = buffer;
if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
  mimetype = "audio/webm"; encoding = "WEBM_OPUS"; sampleRateHertz = 48000;
} else if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
  mimetype = "audio/ogg"; encoding = "OGG_OPUS"; sampleRateHertz = 48000;
} else if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) {
  mimetype = "audio/mpeg"; encoding = "MP3"; sampleRateHertz = 16000;
} else if (b.slice(0, 4).toString() === "RIFF") {
  mimetype = "audio/wav"; encoding = "LINEAR16"; sampleRateHertz = 16000;
}
console.log(`Audio: ${buffer.length} bytes, detected ${mimetype} (google encoding ${encoding} @ ${sampleRateHertz}Hz), lang=${lang}\n`);

/* ── engines ────────────────────────────────────────────────────────── */
const AZURE_LOCALES = {
  pa: ["pa-IN"], hi: ["hi-IN"], ur: ["ur-PK"], ne: ["ne-NP"], bn: ["bn-IN"],
  gu: ["gu-IN"], ta: ["ta-IN"], te: ["te-IN"], ml: ["ml-IN"], mr: ["mr-IN"],
  zh: ["zh-CN"], ar: ["ar-EG"], fa: ["fa-IR"], es: ["es-ES"], vi: ["vi-VN"],
  en: ["en-AU", "en-US"],
};
const GOOGLE_LOCALES = {
  pa: "pa-Guru-IN", hi: "hi-IN", ur: "ur-PK", ne: "ne-NP", bn: "bn-IN",
  gu: "gu-IN", ta: "ta-IN", te: "te-IN", ml: "ml-IN", mr: "mr-IN",
  zh: "cmn-Hans-CN", ar: "ar-EG", fa: "fa-IR", es: "es-ES", vi: "vi-VN",
  en: "en-AU",
};

async function azure() {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key || !azureBase) throw new Error("AZURE_SPEECH_KEY / endpoint not configured");
  const apiVersion = process.env.AZURE_SPEECH_API_VERSION || "2025-10-15";
  const url = `${azureBase}/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(apiVersion)}`;
  const definition = { locales: AZURE_LOCALES[lang] || ["en-AU"] };
  const ext = mimetype === "audio/wav" ? ".wav" : mimetype === "audio/mpeg" ? ".mp3" : mimetype === "audio/ogg" ? ".ogg" : ".webm";
  const form = new FormData();
  form.append("audio", new Blob([buffer], { type: mimetype }), `audio${ext}`);
  form.append("definition", JSON.stringify(definition));
  const res = await fetch(url, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key }, body: form });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 300)}`);
  const json = await res.json();
  return (Array.isArray(json?.combinedPhrases) && json.combinedPhrases[0]?.text) || "";
}

async function google() {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error("GOOGLE_TRANSLATE_API_KEY not set");
  const locale = GOOGLE_LOCALES[lang];
  if (!locale) throw new Error(`no Google locale mapped for "${lang}"`);
  const res = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { encoding, sampleRateHertz, languageCode: locale, enableAutomaticPunctuation: true },
        audio: { content: buffer.toString("base64") },
      }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 300)}`);
  const json = await res.json();
  return (json.results || []).map((r) => r.alternatives?.[0]?.transcript).filter(Boolean).join(" ");
}

async function whisper() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const ext = mimetype === "audio/wav" ? ".wav" : mimetype === "audio/mpeg" ? ".mp3" : mimetype === "audio/ogg" ? ".ogg" : ".webm";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), `audio${ext}`);
  form.append("model", "whisper-1");
  form.append("language", lang);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 300)}`);
  return (await res.json()).text || "";
}

/* ── run all three concurrently, same as the controller ─────────────── */
const engines = [["azure", azure], ["google", google], ["whisper", whisper]];
const results = await Promise.allSettled(
  engines.map(async ([name, fn]) => {
    const t0 = Date.now();
    const text = await fn();
    return { name, text, ms: Date.now() - t0 };
  })
);

console.log("─".repeat(72));
results.forEach((r, i) => {
  const name = engines[i][0];
  if (r.status === "fulfilled") {
    const { text, ms } = r.value;
    console.log(`\n${name.toUpperCase()}  (${ms}ms, ${text.length} chars)`);
    console.log(text ? text : "  (empty)");
  } else {
    console.log(`\n${name.toUpperCase()}  FAILED`);
    console.log(`  ${r.reason?.message || r.reason}`);
  }
});
console.log("\n" + "─".repeat(72));
