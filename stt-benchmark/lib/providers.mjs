/**
 * STT provider registry.
 *
 * Every provider is a plain object:
 *   id       stable slug, used as the column key in the results matrix
 *   label    what the UI prints next to a transcript ("which model made this")
 *   vendor   Azure | Google | OpenAI | Deepgram | ElevenLabs | AWS
 *   needs    env vars that must be set for the provider to be selectable
 *   note     one-liner shown in the UI
 *   run()    ({ buffer, mime, filename, language }) -> { text, raw }
 *
 * Everything talks raw REST through global fetch — no SDKs, no npm install.
 */

import crypto from "node:crypto";
import fs from "node:fs";

const b64 = (buf) => Buffer.from(buf).toString("base64");

/* ------------------------------------------------------------------ *
 * Language handling
 * ------------------------------------------------------------------ */

// NAATI-relevant defaults. `language` arrives as a BCP-47-ish tag from the UI.
export const LANGUAGE_PRESETS = [
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "ur-PK", label: "Urdu" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "bn-IN", label: "Bengali" },
  { code: "ne-NP", label: "Nepali" },
  { code: "ar-SA", label: "Arabic" },
  { code: "zh-CN", label: "Mandarin (Simplified)" },
  { code: "vi-VN", label: "Vietnamese" },
  { code: "auto", label: "Auto-detect (where supported)" },
];

const shortCode = (lang) => String(lang || "").split("-")[0].toLowerCase();

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function baseMime(mime) {
  return String(mime || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function extFor(mime, filename) {
  if (filename && /\.[a-z0-9]{2,5}$/i.test(filename)) return filename.slice(filename.lastIndexOf("."));
  const map = {
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
    "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
    "audio/webm": ".webm", "video/webm": ".webm",
    "audio/ogg": ".ogg", "audio/opus": ".ogg",
    "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac",
    "audio/flac": ".flac", "audio/x-flac": ".flac",
  };
  return map[baseMime(mime)] || ".bin";
}

async function readErr(res) {
  let body = "";
  try { body = await res.text(); } catch { /* ignore */ }
  if (body.length > 600) body = body.slice(0, 600) + "...";
  return `HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`;
}

/* ------------------------------------------------------------------ *
 * Azure AI Speech - Fast Transcription (this is what production uses today)
 * ------------------------------------------------------------------ */

// Mirrors toAzureLocale() in src/controllers/mockTestFlow.controller.js so the
// benchmark measures the same locale behaviour production gets.
const AZURE_LOCALES = {
  en: "en-AU", hi: "hi-IN", pa: "pa-IN", ur: "ur-PK", gu: "gu-IN", ta: "ta-IN",
  te: "te-IN", bn: "bn-IN", ne: "ne-NP", ar: "ar-SA", zh: "zh-CN", vi: "vi-VN",
  es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-PT", ja: "ja-JP",
  ko: "ko-KR", ru: "ru-RU", th: "th-TH", tr: "tr-TR", id: "id-ID", ms: "ms-MY",
  fa: "fa-IR", pl: "pl-PL", nl: "nl-NL", el: "el-GR", he: "he-IL",
};

function azureLocale(language) {
  if (!language || language === "auto") return null;
  if (/^[a-z]{2}-[A-Za-z]{2,}$/.test(language)) return language;
  return AZURE_LOCALES[shortCode(language)] || null;
}

async function azureFast({ buffer, mime, filename, language }, { diarize = false } = {}) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const apiVersion = process.env.AZURE_SPEECH_API_VERSION || "2024-11-15";
  const endpoint =
    process.env.AZURE_SPEECH_ENDPOINT || `https://${region}.api.cognitive.microsoft.com`;
  const url = `${endpoint}/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(apiVersion)}`;

  const definition = {};
  const locale = azureLocale(language);
  // No locale => let Azure do language ID, but it needs a candidate list,
  // so give it the common NAATI pairs rather than leaving it empty.
  definition.locales = locale ? [locale] : ["en-AU", "en-IN", "hi-IN", "pa-IN", "ur-PK"];
  if (diarize) definition.diarization = { maxSpeakers: 2, enabled: true };

  const form = new FormData();
  form.append("audio", new Blob([buffer], { type: baseMime(mime) }), `audio${extFor(mime, filename)}`);
  form.append("definition", JSON.stringify(definition));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`Azure: ${await readErr(res)}`);

  const json = await res.json();
  const combined = Array.isArray(json?.combinedPhrases) ? json.combinedPhrases : [];
  let text = combined.map((x) => x?.text || "").filter(Boolean).join("\n").trim();
  if (!text) {
    const phrases = Array.isArray(json?.phrases) ? json.phrases : [];
    text = phrases.map((p) => p?.text || "").filter(Boolean).join(" ").trim();
  }
  return { text, raw: { durationMs: json?.durationMilliseconds, phrases: json?.phrases?.length } };
}

/* ------------------------------------------------------------------ *
 * Google Cloud Speech-to-Text v1  (API-key auth, sync recognize)
 * ------------------------------------------------------------------ */

function googleV1Encoding(mime) {
  switch (baseMime(mime)) {
    case "audio/wav": case "audio/x-wav": case "audio/wave":
    case "audio/flac": case "audio/x-flac":
      return {}; // header carries encoding + sample rate
    case "audio/webm": case "video/webm":
      return { encoding: "WEBM_OPUS", sampleRateHertz: 48000 };
    case "audio/ogg": case "audio/opus":
      return { encoding: "OGG_OPUS", sampleRateHertz: 48000 };
    case "audio/mpeg": case "audio/mp3":
      return { encoding: "MP3", sampleRateHertz: 44100 };
    default:
      return null; // m4a/aac/mp4 are not accepted by v1
  }
}

async function googleV1({ buffer, mime, language }, { model }) {
  const enc = googleV1Encoding(mime);
  if (enc === null) {
    throw new Error(
      `Google STT v1 cannot decode ${baseMime(mime)} (supports wav/flac/webm-opus/ogg-opus/mp3). ` +
      "Use the Chirp 2 or Gemini providers for this file."
    );
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("Google STT v1 sync recognize is capped at 10 MB / ~60 s of audio.");
  }

  const url = `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(process.env.GOOGLE_SPEECH_API_KEY)}`;
  const body = {
    config: {
      languageCode: language && language !== "auto" ? language : "en-AU",
      enableAutomaticPunctuation: true,
      model,
      ...enc,
    },
    audio: { content: b64(buffer) },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google v1 (${model}): ${await readErr(res)}`);

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const text = results
    .map((r) => r?.alternatives?.[0]?.transcript || "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const conf = results.map((r) => r?.alternatives?.[0]?.confidence).filter((n) => typeof n === "number");
  return {
    text,
    raw: { confidence: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null },
  };
}

/* ------------------------------------------------------------------ *
 * Google Cloud Speech-to-Text v2 - Chirp 2  (service-account auth)
 * ------------------------------------------------------------------ */

let gcpToken = { value: null, expiresAt: 0 };

function loadServiceAccount() {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline) return JSON.parse(inline);
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return JSON.parse(fs.readFileSync(path, "utf8"));
  throw new Error("Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.");
}

async function gcpAccessToken() {
  if (gcpToken.value && Date.now() < gcpToken.expiresAt) return gcpToken.value;

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    `${enc({ alg: "RS256", typ: "JWT" })}.` +
    enc({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth: ${await readErr(res)}`);

  const json = await res.json();
  gcpToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 300) * 1000 };
  return gcpToken.value;
}

async function googleChirp2({ buffer, language }, { model = "chirp_2" } = {}) {
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("Speech-to-Text v2 inline recognize is capped at 10 MB / ~60 s. Use batchRecognize for longer clips.");
  }
  const project = process.env.GOOGLE_PROJECT_ID || loadServiceAccount().project_id;
  const location = process.env.GOOGLE_SPEECH_LOCATION || "us-central1";
  const token = await gcpAccessToken();
  const host = location === "global" ? "speech.googleapis.com" : `${location}-speech.googleapis.com`;
  const url = `https://${host}/v2/projects/${project}/locations/${location}/recognizers/_:recognize`;

  const languageCodes = !language || language === "auto" ? ["auto"] : [language];

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      config: {
        // autoDecodingConfig sniffs the container, so webm/m4a/mp3 all work here.
        autoDecodingConfig: {},
        model,
        languageCodes,
        features: { enableAutomaticPunctuation: true },
      },
      content: b64(buffer),
    }),
  });
  if (!res.ok) throw new Error(`Google ${model}: ${await readErr(res)}`);

  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  const text = results
    .map((r) => r?.alternatives?.[0]?.transcript || "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, raw: { languageCode: results[0]?.languageCode || null } };
}

/* ------------------------------------------------------------------ *
 * Gemini - audio understanding used as an ASR
 * ------------------------------------------------------------------ */

const GEMINI_PROMPT =
  "Transcribe the speech in this audio verbatim. Preserve every word actually spoken, " +
  "including false starts, fillers and repetitions. Do not translate, summarise, correct " +
  "grammar, or add commentary. Use standard punctuation and capitalisation. " +
  "Return the transcript text only, with no preamble, labels or quotation marks.";

async function gemini({ buffer, mime, language }, { model }) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const hint =
    language && language !== "auto" ? ` The spoken language is ${language}; transcribe in its native script.` : "";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: GEMINI_PROMPT + hint },
            { inline_data: { mime_type: baseMime(mime), data: b64(buffer) } },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${model}: ${await readErr(res)}`);

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p?.text || "").join("").trim();
  return { text, raw: { finishReason: json?.candidates?.[0]?.finishReason, usage: json?.usageMetadata } };
}

/* ------------------------------------------------------------------ *
 * OpenAI /v1/audio/transcriptions
 * ------------------------------------------------------------------ */

async function openai({ buffer, mime, filename, language }, { model }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: baseMime(mime) }), `audio${extFor(mime, filename)}`);
  form.append("model", model);
  form.append("response_format", "json");
  if (language && language !== "auto") form.append("language", shortCode(language));

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${model}: ${await readErr(res)}`);

  const json = await res.json();
  return { text: String(json?.text || "").trim(), raw: { usage: json?.usage } };
}

/* ------------------------------------------------------------------ *
 * Deepgram
 * ------------------------------------------------------------------ */

async function deepgram({ buffer, mime, language }, { model }) {
  const params = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });
  if (language && language !== "auto") params.set("language", model === "nova-3" ? "multi" : language);

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": baseMime(mime),
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Deepgram ${model}: ${await readErr(res)}`);

  const json = await res.json();
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  return { text: String(alt?.transcript || "").trim(), raw: { confidence: alt?.confidence } };
}

/* ------------------------------------------------------------------ *
 * ElevenLabs Scribe
 * ------------------------------------------------------------------ */

async function elevenlabs({ buffer, mime, filename, language }, { model }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: baseMime(mime) }), `audio${extFor(mime, filename)}`);
  form.append("model_id", model);
  if (language && language !== "auto") form.append("language_code", shortCode(language));

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs ${model}: ${await readErr(res)}`);

  const json = await res.json();
  return { text: String(json?.text || "").trim(), raw: { language: json?.language_code } };
}

/* ------------------------------------------------------------------ *
 * AWS Transcribe (async job: S3 put -> start job -> poll -> fetch result)
 * Lazily imports the SDK so the harness still boots when it is not installed.
 * ------------------------------------------------------------------ */

async function awsTranscribe({ buffer, mime, filename, language }) {
  let S3;
  let TR;
  try {
    S3 = await import("@aws-sdk/client-s3");
    TR = await import("@aws-sdk/client-transcribe");
  } catch {
    throw new Error(
      "AWS Transcribe needs the SDK: npm i @aws-sdk/client-s3 @aws-sdk/client-transcribe (run inside stt-benchmark/)."
    );
  }

  const region = process.env.AWS_REGION || "ap-southeast-2";
  const bucket = process.env.AWS_TRANSCRIBE_BUCKET;
  const ext = extFor(mime, filename).replace(".", "") || "wav";
  const jobName = `sttbench-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const key = `stt-benchmark/${jobName}.${ext}`;

  const s3 = new S3.S3Client({ region });
  await s3.send(new S3.PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: baseMime(mime) }));

  const tr = new TR.TranscribeClient({ region });
  await tr.send(
    new TR.StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: `s3://${bucket}/${key}` },
      MediaFormat: ext === "webm" ? "webm" : ext === "m4a" ? "mp4" : ext,
      ...(language && language !== "auto"
        ? { LanguageCode: language }
        : { IdentifyLanguage: true, LanguageOptions: ["en-AU", "en-IN", "hi-IN", "ur-PK"] }),
    })
  );

  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`AWS Transcribe job ${jobName} timed out after 5 min.`);
    await new Promise((r) => setTimeout(r, 3000));
    const { TranscriptionJob: job } = await tr.send(
      new TR.GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
    );
    if (job.TranscriptionJobStatus === "FAILED") throw new Error(`AWS Transcribe failed: ${job.FailureReason}`);
    if (job.TranscriptionJobStatus !== "COMPLETED") continue;

    const res = await fetch(job.Transcript.TranscriptFileUri);
    if (!res.ok) throw new Error(`AWS Transcribe result fetch: ${await readErr(res)}`);
    const json = await res.json();
    return {
      text: String(json?.results?.transcripts?.[0]?.transcript || "").trim(),
      raw: { jobName, languageCode: job.LanguageCode },
    };
  }
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export const PROVIDERS = [
  {
    id: "azure-fast",
    label: "Azure Fast Transcription",
    vendor: "Azure",
    needs: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
    note: "Currently live in production (mockTestFlow.controller.js) - this is the baseline to beat.",
    baseline: true,
    run: (ctx) => azureFast(ctx),
  },
  {
    id: "azure-fast-diarized",
    label: "Azure Fast Transcription + diarization",
    vendor: "Azure",
    needs: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
    note: "Same engine, speaker separation on. Useful when a clip has interviewer + candidate.",
    run: (ctx) => azureFast(ctx, { diarize: true }),
  },
  {
    id: "google-v1-default",
    label: "Google STT v1 (default)",
    vendor: "Google",
    needs: ["GOOGLE_SPEECH_API_KEY"],
    note: "API-key auth. wav/flac/webm/ogg/mp3 only, 60 s max.",
    run: (ctx) => googleV1(ctx, { model: "default" }),
  },
  {
    id: "google-v1-latest-long",
    label: "Google STT v1 (latest_long)",
    vendor: "Google",
    needs: ["GOOGLE_SPEECH_API_KEY"],
    note: "Google's conversational long-form model on the v1 endpoint.",
    run: (ctx) => googleV1(ctx, { model: "latest_long" }),
  },
  {
    id: "google-chirp2",
    label: "Google Chirp 2 (STT v2)",
    vendor: "Google",
    needs: ["GOOGLE_SERVICE_ACCOUNT_JSON|GOOGLE_APPLICATION_CREDENTIALS"],
    note: "Google's best ASR. Service-account auth, auto container decoding, strong on accents.",
    run: (ctx) => googleChirp2(ctx, { model: "chirp_2" }),
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash (audio)",
    vendor: "Google",
    needs: ["GEMINI_API_KEY|GOOGLE_AI_API_KEY"],
    note: "LLM-based transcription. Strong on accents, but can quietly tidy up what was said.",
    run: (ctx) => gemini(ctx, { model: "gemini-2.5-flash" }),
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro (audio)",
    vendor: "Google",
    needs: ["GEMINI_API_KEY|GOOGLE_AI_API_KEY"],
    note: "Slower and pricier than Flash; usually the most literal of the Gemini tier.",
    run: (ctx) => gemini(ctx, { model: "gemini-2.5-pro" }),
  },
  {
    id: "openai-gpt-4o-transcribe",
    label: "OpenAI gpt-4o-transcribe",
    vendor: "OpenAI",
    needs: ["OPENAI_API_KEY"],
    note: "OpenAI's flagship ASR endpoint.",
    run: (ctx) => openai(ctx, { model: "gpt-4o-transcribe" }),
  },
  {
    id: "openai-gpt-4o-mini-transcribe",
    label: "OpenAI gpt-4o-mini-transcribe",
    vendor: "OpenAI",
    needs: ["OPENAI_API_KEY"],
    note: "Cheaper tier of the same family.",
    run: (ctx) => openai(ctx, { model: "gpt-4o-mini-transcribe" }),
  },
  {
    id: "openai-whisper-1",
    label: "OpenAI whisper-1",
    vendor: "OpenAI",
    needs: ["OPENAI_API_KEY"],
    note: "The classic Whisper large-v2 endpoint. Good multilingual reference point.",
    run: (ctx) => openai(ctx, { model: "whisper-1" }),
  },
  {
    id: "deepgram-nova-3",
    label: "Deepgram Nova-3",
    vendor: "Deepgram",
    needs: ["DEEPGRAM_API_KEY"],
    note: "Optional. Fastest of the set; code-switching support via language=multi.",
    run: (ctx) => deepgram(ctx, { model: "nova-3" }),
  },
  {
    id: "elevenlabs-scribe",
    label: "ElevenLabs Scribe v1",
    vendor: "ElevenLabs",
    needs: ["ELEVENLABS_API_KEY"],
    note: "Optional. Tops several public WER leaderboards for accented English.",
    run: (ctx) => elevenlabs(ctx, { model: "scribe_v1" }),
  },
  {
    id: "aws-transcribe",
    label: "AWS Transcribe",
    vendor: "AWS",
    needs: ["AWS_TRANSCRIBE_BUCKET"],
    note: "Optional. Async job - slowest by far (S3 round trip + polling). Needs the AWS SDK installed.",
    run: (ctx) => awsTranscribe(ctx),
  },
];

/** An entry in `needs` may be "A|B", meaning either variable satisfies it. */
function needsMet(need) {
  return need.split("|").some((k) => !!process.env[k.trim()]);
}

export function providerStatus() {
  return PROVIDERS.map((p) => {
    const missing = p.needs.filter((n) => !needsMet(n));
    return {
      id: p.id,
      label: p.label,
      vendor: p.vendor,
      note: p.note,
      baseline: !!p.baseline,
      enabled: missing.length === 0,
      missing,
    };
  });
}

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}
