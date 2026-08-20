/**
 * ElevenLabs integration.
 *
 * Speech-to-text (Scribe) is shaped to be a drop-in for the Azure fast
 * transcription helpers already used by the scoring controllers: it returns
 * { text, insights } with the same insight keys, so callers do not care which
 * vendor produced the transcript.
 *
 * Everything talks raw REST through global fetch - no SDK needed.
 */

const API_BASE = "https://api.elevenlabs.io/v1";

const STT_URL = `${API_BASE}/speech-to-text`;
const TTS_URL = `${API_BASE}/text-to-speech`;
const VOICES_URL = `${API_BASE}/voices`;

const DEFAULT_STT_MODEL = "scribe_v1";
const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
const DEFAULT_TTS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel"
const DEFAULT_TTS_FORMAT = "mp3_44100_128";
const DEFAULT_TIMEOUT_MS = 180_000;

/* ─── env ─────────────────────────────────────────────────────────── */

export const getElevenLabsKey = () =>
  String(process.env.ELEVENLABS_API_KEY || "").trim();

export const isElevenLabsConfigured = () => !!getElevenLabsKey();

/** True when the scoring flows should route transcription to Scribe. */
export const isElevenLabsSttEnabled = () =>
  String(process.env.STT_PROVIDER || "azure").trim().toLowerCase() ===
    "elevenlabs" && isElevenLabsConfigured();

const requireKey = () => {
  const key = getElevenLabsKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY is required");
  return key;
};

/* ─── mime / language helpers ─────────────────────────────────────── */

const baseMime = (mimetype) =>
  String(mimetype || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();

const EXT_BY_MIME = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/webm": ".webm",
  "video/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/opus": ".ogg",
  "audio/mp4": ".mp4",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/x-ms-wma": ".wma",
};

const extFor = (mimetype, filename) => {
  if (filename && /\.[a-z0-9]{2,5}$/i.test(filename))
    return filename.slice(filename.lastIndexOf("."));
  return EXT_BY_MIME[baseMime(mimetype)] || ".webm";
};

// Callers pass either a language name ("Punjabi"), a short code ("pa") or a
// locale ("pa-IN"). Scribe wants an ISO-639-1/639-3 code.
const LANGUAGE_NAME_TO_CODE = {
  english: "en",
  hindi: "hi",
  punjabi: "pa",
  panjabi: "pa",
  urdu: "ur",
  gujarati: "gu",
  tamil: "ta",
  telugu: "te",
  bengali: "bn",
  bangla: "bn",
  marathi: "mr",
  malayalam: "ml",
  kannada: "kn",
  nepali: "ne",
  sinhala: "si",
  arabic: "ar",
  persian: "fa",
  farsi: "fa",
  dari: "fa",
  pashto: "ps",
  mandarin: "zh",
  chinese: "zh",
  cantonese: "yue",
  japanese: "ja",
  korean: "ko",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id",
  malay: "ms",
  filipino: "tl",
  tagalog: "tl",
  burmese: "my",
  khmer: "km",
  lao: "lo",
  turkish: "tr",
  russian: "ru",
  ukrainian: "uk",
  polish: "pl",
  romanian: "ro",
  greek: "el",
  italian: "it",
  spanish: "es",
  portuguese: "pt",
  french: "fr",
  german: "de",
  dutch: "nl",
  croatian: "hr",
  serbian: "sr",
  bosnian: "bs",
  macedonian: "mk",
  albanian: "sq",
  bulgarian: "bg",
  hungarian: "hu",
  czech: "cs",
  slovak: "sk",
  somali: "so",
  swahili: "sw",
  amharic: "am",
  tigrinya: "ti",
  hebrew: "he",
  armenian: "hy",
  azerbaijani: "az",
  kurdish: "ku",
  samoan: "sm",
  tongan: "to",
  maori: "mi",
};

export const toElevenLabsLanguageCode = (language) => {
  const raw = String(language || "").trim();
  if (!raw || raw.toLowerCase() === "auto") return null;

  const mapped = LANGUAGE_NAME_TO_CODE[raw.toLowerCase()];
  if (mapped) return mapped;

  // "pa-IN" -> "pa", "en_AU" -> "en", "pa" -> "pa"
  const code = raw.split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : null;
};

/* ─── fetch with timeout ──────────────────────────────────────────── */

const fetchWithTimeout = async (url, options, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new Error(`ElevenLabs request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const readError = async (res) => {
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  try {
    const json = JSON.parse(body);
    const detail = json?.detail;
    if (typeof detail === "string") body = detail;
    else if (detail?.message) body = detail.message;
    else if (json?.message) body = json.message;
  } catch {
    /* not JSON - keep the raw body */
  }
  return `${res.status} ${res.statusText}${
    body ? ` - ${String(body).slice(0, 500)}` : ""
  }`;
};

/* ─── speech to text (Scribe) ─────────────────────────────────────── */

const wordConfidence = (word) => {
  // Scribe reports per-word logprob; turn it back into a 0..1 probability.
  if (typeof word?.logprob !== "number") return null;
  const p = Math.exp(word.logprob);
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null;
};

const buildInsights = (json, modelId) => {
  const words = Array.isArray(json?.words) ? json.words : [];
  const spoken = words.filter((w) => w?.type !== "spacing");

  const confs = spoken.map(wordConfidence).filter((v) => typeof v === "number");
  const avgConfidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : typeof json?.language_probability === "number"
    ? json.language_probability
    : null;

  const ends = spoken
    .map((w) => (typeof w?.end === "number" ? w.end : null))
    .filter((v) => typeof v === "number");

  const locales = {};
  if (json?.language_code) locales[String(json.language_code)] = spoken.length;

  return {
    durationMilliseconds: ends.length
      ? Math.round(Math.max(...ends) * 1000)
      : null,
    phrasesCount: spoken.length,
    avgConfidence,
    minConfidence: confs.length ? Math.min(...confs) : null,
    maxConfidence: confs.length ? Math.max(...confs) : null,
    locales,
    provider: "elevenlabs",
    model: modelId || null,
    detectedLanguage: json?.language_code || null,
    languageProbability:
      typeof json?.language_probability === "number"
        ? json.language_probability
        : null,
  };
};

/**
 * Transcribe audio with ElevenLabs Scribe.
 *
 * Pass either `buffer` (+ `mimetype`) or `audioUrl` for audio that already
 * lives on public storage (S3), which skips the upload entirely.
 *
 * @returns {Promise<{ text: string, insights: object }>}
 */
export const transcribeWithElevenLabs = async ({
  buffer,
  mimetype,
  filename,
  audioUrl,
  language,
  model,
  diarize = false,
  numSpeakers,
  tagAudioEvents = false,
  timeoutMs = Number(process.env.ELEVENLABS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
} = {}) => {
  const key = requireKey();
  if (!buffer && !audioUrl)
    throw new Error("transcribeWithElevenLabs needs a buffer or an audioUrl");

  const modelId =
    model || process.env.ELEVENLABS_STT_MODEL || DEFAULT_STT_MODEL;

  const form = new FormData();
  form.append("model_id", modelId);

  if (buffer) {
    form.append(
      "file",
      new Blob([buffer], { type: baseMime(mimetype) }),
      `audio${extFor(mimetype, filename)}`
    );
  } else {
    form.append("cloud_storage_url", String(audioUrl));
  }

  const languageCode = toElevenLabsLanguageCode(language);
  if (languageCode) form.append("language_code", languageCode);

  form.append("tag_audio_events", tagAudioEvents ? "true" : "false");
  form.append("diarize", diarize ? "true" : "false");
  if (diarize && Number.isFinite(Number(numSpeakers)))
    form.append("num_speakers", String(Number(numSpeakers)));

  const res = await fetchWithTimeout(
    STT_URL,
    { method: "POST", headers: { "xi-api-key": key }, body: form },
    timeoutMs
  );

  if (!res.ok)
    throw new Error(`ElevenLabs transcription error: ${await readError(res)}`);

  const json = await res.json();

  return {
    text: String(json?.text || "").trim(),
    insights: buildInsights(json, modelId),
  };
};

/* ─── text to speech ──────────────────────────────────────────────── */

/**
 * Synthesise speech and return the raw audio bytes.
 * @returns {Promise<{ buffer: Buffer, mimetype: string, voiceId: string, model: string }>}
 */
export const ttsToBuffer = async ({
  text,
  voiceId,
  model,
  outputFormat,
  voiceSettings,
  timeoutMs = Number(process.env.ELEVENLABS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
} = {}) => {
  const key = requireKey();
  const body = String(text || "").trim();
  if (!body) throw new Error("ttsToBuffer needs non-empty text");

  const voice =
    voiceId || process.env.ELEVENLABS_TTS_VOICE_ID || DEFAULT_TTS_VOICE_ID;
  const modelId = model || process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;
  const format =
    outputFormat || process.env.ELEVENLABS_TTS_FORMAT || DEFAULT_TTS_FORMAT;

  const url = `${TTS_URL}/${encodeURIComponent(
    voice
  )}?output_format=${encodeURIComponent(format)}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: body,
        model_id: modelId,
        ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
      }),
    },
    timeoutMs
  );

  if (!res.ok) throw new Error(`ElevenLabs TTS error: ${await readError(res)}`);

  const audio = Buffer.from(await res.arrayBuffer());
  const mimetype = format.startsWith("mp3")
    ? "audio/mpeg"
    : format.startsWith("opus")
    ? "audio/ogg"
    : format.startsWith("pcm") || format.startsWith("ulaw")
    ? "audio/wav"
    : "application/octet-stream";

  return { buffer: audio, mimetype, voiceId: voice, model: modelId };
};

/** List the voices available on the account (id + name + labels). */
export const listVoices = async () => {
  const key = requireKey();
  const res = await fetchWithTimeout(
    VOICES_URL,
    { method: "GET", headers: { "xi-api-key": key } },
    30_000
  );
  if (!res.ok)
    throw new Error(`ElevenLabs voices error: ${await readError(res)}`);
  const json = await res.json();
  return (Array.isArray(json?.voices) ? json.voices : []).map((v) => ({
    voiceId: v?.voice_id,
    name: v?.name,
    category: v?.category,
    labels: v?.labels || null,
    previewUrl: v?.preview_url || null,
  }));
};

/** Remaining character quota - handy for a health check before a big batch. */
export const getSubscriptionUsage = async () => {
  const key = requireKey();
  const res = await fetchWithTimeout(
    `${API_BASE}/user/subscription`,
    { method: "GET", headers: { "xi-api-key": key } },
    30_000
  );
  if (!res.ok)
    throw new Error(`ElevenLabs subscription error: ${await readError(res)}`);
  const json = await res.json();
  return {
    tier: json?.tier || null,
    characterCount: json?.character_count ?? null,
    characterLimit: json?.character_limit ?? null,
    remaining:
      typeof json?.character_limit === "number" &&
      typeof json?.character_count === "number"
        ? json.character_limit - json.character_count
        : null,
    resetUnix: json?.next_character_count_reset_unix ?? null,
  };
};
