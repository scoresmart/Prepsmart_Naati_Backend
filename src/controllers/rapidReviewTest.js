import path from "node:path";
import { models } from "../models/index.js";
import { uploadAudioToS3 } from "../utils/aws.js";

const { Segment, Dialogue, RapidReview, RapidReviewAttempt } = models;

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const clamp = (num, min, max) => {
  const n = typeof num === "number" ? num : Number(num);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const normalizeScores = (raw) => {
  let messageTransfer = clamp(raw.scores?.messageTransfer?.score ?? 0, 0, 28);
  let languageQuality = clamp(raw.scores?.languageQuality?.score ?? 0, 0, 8);
  let fluencyDelivery = clamp(raw.scores?.fluencyDelivery?.score ?? 0, 0, 6);
  let pronunciation = clamp(raw.scores?.pronunciation?.score ?? 0, 0, 3);

  // Minimum floor: if GPT returned 0 for message transfer but the student
  // clearly spoke something, guarantee minimums for the other categories.
  if (messageTransfer === 0) {
    if (fluencyDelivery < 2) fluencyDelivery = 2;
    if (pronunciation < 1) pronunciation = 1;
    if (languageQuality < 2) languageQuality = 2;
    // Student spoke on-topic → give partial message credit
    messageTransfer = 5;
  }

  const rawScore = messageTransfer + languageQuality + fluencyDelivery + pronunciation;

  // Sum penalty deductions (they come as negative numbers)
  const pen = raw.penalties || {};
  const totalPenalties =
    (pen.indirectSpeech?.deduction || 0) +
    (pen.startDelay?.deduction || 0) +
    (pen.longPauses?.deduction || 0) +
    (pen.excessiveCorrections?.deduction || 0) +
    (pen.fillerOveruse?.deduction || 0) +
    (pen.segmentRepeat?.deduction || 0);

  const finalScore = Math.max(0, Math.min(45, rawScore + totalPenalties));

  // Build the full detailed result (stored in aiScores JSON column)
  const detailed = {
    scores: {
      messageTransfer: {
        score: messageTransfer,
        maxScore: 28,
        feedback: raw.scores?.messageTransfer?.feedback ?? "",
      },
      languageQuality: {
        score: languageQuality,
        maxScore: 8,
        feedback: raw.scores?.languageQuality?.feedback ?? "",
      },
      fluencyDelivery: {
        score: fluencyDelivery,
        maxScore: 6,
        feedback: raw.scores?.fluencyDelivery?.feedback ?? "",
        azureFluencyUsed: raw.scores?.fluencyDelivery?.azureFluencyUsed ?? false,
      },
      pronunciation: {
        score: pronunciation,
        maxScore: 3,
        feedback: raw.scores?.pronunciation?.feedback ?? "",
        azurePronunciationUsed: raw.scores?.pronunciation?.azurePronunciationUsed ?? false,
      },
    },
    penalties: {
      indirectSpeech: pen.indirectSpeech || { detected: false, instances: [], deduction: 0 },
      startDelay: pen.startDelay || { detected: false, delaySeconds: null, deduction: 0 },
      longPauses: pen.longPauses || { detected: false, count: 0, details: [], deduction: 0 },
      excessiveCorrections: pen.excessiveCorrections || { detected: false, count: 0, deduction: 0 },
      fillerOveruse: pen.fillerOveruse || { detected: false, count: 0, fillers: [], deduction: 0 },
      segmentRepeat: pen.segmentRepeat || { repeatCount: 0, penaltyApplies: false, deduction: 0 },
    },
    analysis: {
      omissions: raw.analysis?.omissions || [],
      distortions: raw.analysis?.distortions || [],
      insertions: raw.analysis?.insertions || [],
      mispronunciations: raw.analysis?.mispronunciations || [],
      selfCorrections: raw.analysis?.selfCorrections || [],
    },
    detailedFeedback: {
      strengths: raw.detailedFeedback?.strengths || [],
      improvements: raw.detailedFeedback?.improvements || [],
      wordsToPractice: raw.detailedFeedback?.wordsToPractice || [],
      pronunciationTips: raw.detailedFeedback?.pronunciationTips || [],
    },
    rawScore,
    totalPenalties,
    finalScore,
    examinerNotes: raw.examinerNotes ?? "",
  };

  // Backward-compatible flat fields for DB columns
  return {
    ...detailed,
    // Legacy column mappings
    accuracy_score: messageTransfer,
    accuracy_feedback: raw.scores?.messageTransfer?.feedback ?? "",
    language_quality_score: languageQuality,
    language_quality_feedback: raw.scores?.languageQuality?.feedback ?? "",
    fluency_pronunciation_score: fluencyDelivery + pronunciation,
    fluency_pronunciation_feedback:
      (raw.scores?.fluencyDelivery?.feedback ?? "") +
      (raw.scores?.pronunciation?.feedback ? " | " + raw.scores.pronunciation.feedback : ""),
    delivery_coherence_score: 0,
    delivery_coherence_feedback: "",
    cultural_context_score: 0,
    cultural_context_feedback: "",
    response_management_score: 0,
    response_management_feedback: "",
    total_raw_score: rawScore,
    final_score: finalScore,
    one_line_feedback: raw.examinerNotes ?? "",
  };
};

const scoreSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "scores",
    "penalties",
    "analysis",
    "detailedFeedback",
    "examinerNotes",
  ],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["messageTransfer", "languageQuality", "fluencyDelivery", "pronunciation"],
      properties: {
        messageTransfer: {
          type: "object",
          additionalProperties: false,
          required: ["score", "feedback"],
          properties: {
            score: { type: "number" },
            feedback: { type: "string" },
          },
        },
        languageQuality: {
          type: "object",
          additionalProperties: false,
          required: ["score", "feedback"],
          properties: {
            score: { type: "number" },
            feedback: { type: "string" },
          },
        },
        fluencyDelivery: {
          type: "object",
          additionalProperties: false,
          required: ["score", "feedback", "azureFluencyUsed"],
          properties: {
            score: { type: "number" },
            feedback: { type: "string" },
            azureFluencyUsed: { type: "boolean" },
          },
        },
        pronunciation: {
          type: "object",
          additionalProperties: false,
          required: ["score", "feedback", "azurePronunciationUsed"],
          properties: {
            score: { type: "number" },
            feedback: { type: "string" },
            azurePronunciationUsed: { type: "boolean" },
          },
        },
      },
    },
    penalties: {
      type: "object",
      additionalProperties: false,
      required: [
        "indirectSpeech",
        "startDelay",
        "longPauses",
        "excessiveCorrections",
        "fillerOveruse",
        "segmentRepeat",
      ],
      properties: {
        indirectSpeech: {
          type: "object",
          additionalProperties: false,
          required: ["detected", "instances", "deduction"],
          properties: {
            detected: { type: "boolean" },
            instances: { type: "array", items: { type: "string" } },
            deduction: { type: "number" },
          },
        },
        startDelay: {
          type: "object",
          additionalProperties: false,
          required: ["detected", "deduction"],
          properties: {
            detected: { type: "boolean" },
            deduction: { type: "number" },
          },
        },
        longPauses: {
          type: "object",
          additionalProperties: false,
          required: ["detected", "count", "deduction"],
          properties: {
            detected: { type: "boolean" },
            count: { type: "number" },
            deduction: { type: "number" },
          },
        },
        excessiveCorrections: {
          type: "object",
          additionalProperties: false,
          required: ["detected", "count", "deduction"],
          properties: {
            detected: { type: "boolean" },
            count: { type: "number" },
            deduction: { type: "number" },
          },
        },
        fillerOveruse: {
          type: "object",
          additionalProperties: false,
          required: ["detected", "count", "fillers", "deduction"],
          properties: {
            detected: { type: "boolean" },
            count: { type: "number" },
            fillers: { type: "array", items: { type: "string" } },
            deduction: { type: "number" },
          },
        },
        segmentRepeat: {
          type: "object",
          additionalProperties: false,
          required: ["repeatCount", "penaltyApplies", "deduction"],
          properties: {
            repeatCount: { type: "number" },
            penaltyApplies: { type: "boolean" },
            deduction: { type: "number" },
          },
        },
      },
    },
    analysis: {
      type: "object",
      additionalProperties: false,
      required: ["omissions", "distortions", "insertions", "mispronunciations", "selfCorrections"],
      properties: {
        omissions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["content", "severity", "markImpact"],
            properties: {
              content: { type: "string" },
              severity: { type: "string" },
              markImpact: { type: "number" },
            },
          },
        },
        distortions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["original", "interpreted", "severity", "markImpact"],
            properties: {
              original: { type: "string" },
              interpreted: { type: "string" },
              severity: { type: "string" },
              markImpact: { type: "number" },
            },
          },
        },
        insertions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["content", "markImpact"],
            properties: {
              content: { type: "string" },
              markImpact: { type: "number" },
            },
          },
        },
        mispronunciations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["word", "issue"],
            properties: {
              word: { type: "string" },
              issue: { type: "string" },
            },
          },
        },
        selfCorrections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["phrase", "properlyPrefaced"],
            properties: {
              phrase: { type: "string" },
              properlyPrefaced: { type: "boolean" },
            },
          },
        },
      },
    },
    detailedFeedback: {
      type: "object",
      additionalProperties: false,
      required: ["strengths", "improvements", "wordsToPractice", "pronunciationTips"],
      properties: {
        strengths: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
        wordsToPractice: { type: "array", items: { type: "string" } },
        pronunciationTips: { type: "array", items: { type: "string" } },
      },
    },
    examinerNotes: { type: "string" },
  },
};

const extractResponseText = (json) => {
  if (typeof json?.output_text === "string" && json.output_text.trim())
    return json.output_text;
  const out = Array.isArray(json?.output) ? json.output : [];
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (
          c?.type === "output_text" &&
          typeof c?.text === "string" &&
          c.text.trim()
        )
          return c.text;
      }
    }
  }
  return "";
};

const guessMimeFromUrl = (url) => {
  let ext = "";
  try {
    ext = path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    ext = path.extname(String(url)).toLowerCase();
  }
  const map = {
    ".mp3": "audio/mpeg",
    ".mpeg": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".m4a": "audio/x-m4a",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".wma": "audio/x-ms-wma",
  };
  return map[ext] || "audio/webm";
};

const fetchAudio = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${url}`);
  const ab = await res.arrayBuffer();
  const contentType = res.headers.get("content-type");
  const mimetype = contentType
    ? contentType.split(";")[0].trim()
    : guessMimeFromUrl(url);
  return { buffer: Buffer.from(ab), mimetype };
};

const normalizeLocale = (v) => {
  const s = String(v || "").trim();
  if (!s) return null;
  const parts = s.split("-").filter(Boolean);
  if (parts.length === 1) return parts[0].toLowerCase();
  if (parts.length === 2)
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  const [a, b, ...rest] = parts;
  return `${a.toLowerCase()}-${b.toUpperCase()}-${rest
    .map((x) => x)
    .join("-")}`;
};

const toAzureLocales = (lang) => {
  const s = String(lang || "").trim();
  if (!s) return [];
  if (s.includes("-")) return [normalizeLocale(s)].filter(Boolean);
  const map = {
    af: ["af-ZA"],
    ar: ["ar-SA", "ar-EG", "ar-AE"],
    hy: ["hy-AM"],
    az: ["az-AZ"],
    be: ["be-BY"],
    bs: ["bs-BA"],
    bg: ["bg-BG"],
    ca: ["ca-ES"],
    zh: ["zh-CN", "zh-TW", "zh-HK"],
    hr: ["hr-HR"],
    cs: ["cs-CZ"],
    da: ["da-DK"],
    nl: ["nl-NL", "nl-BE"],
    en: ["en-AU", "en-US", "en-GB"],
    et: ["et-EE"],
    fi: ["fi-FI"],
    fr: ["fr-FR", "fr-CA"],
    gl: ["gl-ES"],
    de: ["de-DE", "de-AT", "de-CH"],
    el: ["el-GR"],
    he: ["he-IL"],
    hi: ["hi-IN"],
    hu: ["hu-HU"],
    is: ["is-IS"],
    id: ["id-ID"],
    it: ["it-IT"],
    ja: ["ja-JP"],
    kn: ["kn-IN"],
    kk: ["kk-KZ"],
    ko: ["ko-KR"],
    lv: ["lv-LV"],
    lt: ["lt-LT"],
    mk: ["mk-MK"],
    ms: ["ms-MY"],
    mr: ["mr-IN"],
    mi: ["mi-NZ"],
    ne: ["ne-NP"],
    no: ["nb-NO"],
    fa: ["fa-IR"],
    pl: ["pl-PL"],
    pt: ["pt-BR", "pt-PT"],
    ro: ["ro-RO"],
    ru: ["ru-RU"],
    sr: ["sr-RS"],
    sk: ["sk-SK"],
    sl: ["sl-SI"],
    es: ["es-ES", "es-MX"],
    sw: ["sw-KE"],
    sv: ["sv-SE"],
    tl: ["fil-PH"],
    ta: ["ta-IN"],
    th: ["th-TH"],
    tr: ["tr-TR"],
    uk: ["uk-UA"],
    ur: ["ur-PK"],
    vi: ["vi-VN"],
    cy: ["cy-GB"],
    pa: ["pa-IN"],
    gu: ["gu-IN"],
    bn: ["bn-IN"],
    te: ["te-IN"],
    ml: ["ml-IN"],
  };
  // Filter out locales Azure STT does not yet support (will use Whisper fallback)
  const unsupported = new Set(["pa-IN"]);
  return (map[s.toLowerCase()] || [])
    .map(normalizeLocale)
    .filter((l) => l && !unsupported.has(l));
};

const LANGUAGE_NAME_TO_CODE = {
  hindi: "hi", punjabi: "pa", nepali: "ne", mandarin: "zh", chinese: "zh",
  spanish: "es", english: "en", urdu: "ur", tamil: "ta", telugu: "te",
  bengali: "bn", bangla: "bn", gujarati: "gu", kannada: "kn", malayalam: "ml",
  marathi: "mr", arabic: "ar", persian: "fa", farsi: "fa", turkish: "tr",
  korean: "ko", japanese: "ja", vietnamese: "vi", thai: "th", indonesian: "id",
  malay: "ms", russian: "ru", french: "fr", german: "de", italian: "it",
  portuguese: "pt", dutch: "nl", greek: "el", polish: "pl", czech: "cs",
  romanian: "ro", hungarian: "hu", swedish: "sv", danish: "da", finnish: "fi",
  norwegian: "no", ukrainian: "uk", serbian: "sr", croatian: "hr", bosnian: "bs",
  bulgarian: "bg", filipino: "tl", tagalog: "tl", sinhalese: "si", sinhala: "si",
  khmer: "km", burmese: "my", lao: "lo", swahili: "sw",
};

// Reverse map: code → display name (for GPT prompt)
const CODE_TO_LANGUAGE_NAME = Object.fromEntries(
  Object.entries(LANGUAGE_NAME_TO_CODE).map(([name, code]) => [
    code,
    name.charAt(0).toUpperCase() + name.slice(1),
  ])
);

const toLanguageName = (code) => {
  const c = String(code || "").toLowerCase().split("-")[0];
  return CODE_TO_LANGUAGE_NAME[c] || code || "LOTE";
};

const toLanguageCode = (language) => {
  const s = String(language || "").trim();
  if (!s) return null;
  // If already a 2-letter code, return it
  if (/^[a-z]{2}$/i.test(s)) return s.toLowerCase();
  // If it's a locale like "pa-IN", extract the code
  if (s.includes("-")) return s.split("-")[0].toLowerCase();
  // Map language name to code
  return LANGUAGE_NAME_TO_CODE[s.toLowerCase()] || s.toLowerCase();
};

const makeAzureSpeechBaseEndpoint = () => {
  const region = process.env.AZURE_SPEECH_REGION;
  const custom = process.env.AZURE_SPEECH_ENDPOINT;
  if (custom) return custom.replace(/\/+$/, "");
  if (!region) return null;
  return `https://${region}.api.cognitive.microsoft.com`;
};

const makeAzureShortAudioEndpoint = () => {
  const region = process.env.AZURE_SPEECH_REGION;
  if (!region) return null;
  return `https://${region}.stt.speech.microsoft.com`;
};

const azureFastTranscribe = async ({
  buffer,
  mimetype,
  audioUrl,
  language,
  locales: overrideLocales,
}) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const base = makeAzureSpeechBaseEndpoint();
  if (!key || !base)
    throw new Error(
      "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or AZURE_SPEECH_ENDPOINT) are required"
    );

  const apiVersion = process.env.AZURE_SPEECH_API_VERSION || "2025-10-15";
  const url = `${base}/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(
    apiVersion
  )}`;

  const locales = overrideLocales || toAzureLocales(language);
  const definition = {};
  if (locales.length) definition.locales = locales;
  if (audioUrl) definition.audioUrl = audioUrl;

  const form = new FormData();

  if (buffer) {
    const ext =
      mimetype === "audio/wav"
        ? ".wav"
        : mimetype === "audio/mpeg"
        ? ".mp3"
        : mimetype === "audio/x-m4a"
        ? ".m4a"
        : mimetype === "audio/mp4"
        ? ".mp4"
        : mimetype === "audio/ogg"
        ? ".ogg"
        : mimetype === "audio/aac"
        ? ".aac"
        : mimetype === "audio/flac"
        ? ".flac"
        : mimetype === "audio/x-ms-wma"
        ? ".wma"
        : ".webm";
    form.append(
      "audio",
      new Blob([buffer], { type: mimetype || "application/octet-stream" }),
      `audio${ext}`
    );
  }

  form.append("definition", JSON.stringify(definition));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure transcription error: ${text}`);
  }

  const json = await res.json();

  const fullText =
    (Array.isArray(json?.combinedPhrases) &&
      typeof json.combinedPhrases?.[0]?.text === "string" &&
      json.combinedPhrases[0].text) ||
    (typeof json?.combinedPhrases?.text === "string" &&
      json.combinedPhrases.text) ||
    "";

  const phrases = Array.isArray(json?.phrases) ? json.phrases : [];
  const confs = phrases
    .map((p) => (typeof p?.confidence === "number" ? p.confidence : null))
    .filter((v) => typeof v === "number");
  const avgConfidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : null;
  const minConfidence = confs.length ? Math.min(...confs) : null;
  const maxConfidence = confs.length ? Math.max(...confs) : null;

  const localeCounts = {};
  for (const p of phrases) {
    const l = typeof p?.locale === "string" ? p.locale : null;
    if (!l) continue;
    localeCounts[l] = (localeCounts[l] || 0) + 1;
  }

  return {
    text: String(fullText || "").trim(),
    insights: {
      durationMilliseconds:
        typeof json?.durationMilliseconds === "number"
          ? json.durationMilliseconds
          : null,
      phrasesCount: phrases.length,
      avgConfidence,
      minConfidence,
      maxConfidence,
      locales: localeCounts,
    },
  };
};

const azurePronunciationAssessmentShort = async ({
  buffer,
  mimetype,
  language,
  referenceText,
}) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const base = makeAzureShortAudioEndpoint();
  if (!key || !base) return null;

  const locales = toAzureLocales(language);
  const locale = locales[0] || "en-US";
  const ref = String(referenceText || "").trim();
  if (!ref) return null;

  let contentType = null;
  if (mimetype === "audio/wav") contentType = "audio/wav";
  if (mimetype === "audio/ogg") contentType = "audio/ogg; codecs=opus";
  if (!contentType) return null;

  const params = {
    ReferenceText: ref,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableProsodyAssessment: "True",
    EnableMiscue: "True",
  };

  const headerVal = Buffer.from(JSON.stringify(params), "utf8").toString(
    "base64"
  );
  const url = `${base}/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(
    locale
  )}&format=detailed`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": contentType,
      "Ocp-Apim-Subscription-Key": key,
      "Pronunciation-Assessment": headerVal,
    },
    body: buffer,
  });

  if (!res.ok) return null;

  const json = await res.json();
  const nbest = Array.isArray(json?.NBest) ? json.NBest : [];
  const top = nbest[0] || null;
  if (!top) return null;

  const wordList = Array.isArray(top?.Words) ? top.Words : [];
  const errorCounts = {
    None: 0,
    Omission: 0,
    Insertion: 0,
    Mispronunciation: 0,
  };

  // Extract per-word detail with syllable & phoneme accuracy
  const words = [];
  for (const ww of wordList) {
    const t = ww?.ErrorType;
    if (typeof t === "string" && t in errorCounts) errorCounts[t] += 1;

    const syllables = Array.isArray(ww?.Syllables)
      ? ww.Syllables.map((s) => ({
          syllable: s?.Syllable ?? "",
          accuracyScore: typeof s?.AccuracyScore === "number" ? s.AccuracyScore : null,
        }))
      : [];

    const phonemes = Array.isArray(ww?.Phonemes)
      ? ww.Phonemes.map((p) => ({
          phoneme: p?.Phoneme ?? "",
          accuracyScore: typeof p?.AccuracyScore === "number" ? p.AccuracyScore : null,
        }))
      : [];

    words.push({
      word: ww?.Word ?? "",
      accuracyScore: typeof ww?.AccuracyScore === "number" ? ww.AccuracyScore : null,
      errorType: t ?? "None",
      offset: typeof ww?.Offset === "number" ? ww.Offset : null,
      duration: typeof ww?.Duration === "number" ? ww.Duration : null,
      syllables,
      phonemes,
    });
  }

  // Calculate pauses between words (gaps > 2 seconds)
  const pauses = [];
  for (let i = 0; i < words.length - 1; i++) {
    const cur = words[i];
    const nxt = words[i + 1];
    if (cur.offset != null && cur.duration != null && nxt.offset != null) {
      const curEnd = (cur.offset + cur.duration) / 10000000;
      const nxtStart = nxt.offset / 10000000;
      const gap = nxtStart - curEnd;
      if (gap > 2) {
        pauses.push({
          afterWord: cur.word,
          durationSeconds: Math.round(gap * 10) / 10,
        });
      }
    }
  }

  return {
    confidence: typeof top?.Confidence === "number" ? top.Confidence : null,
    accuracyScore:
      typeof top?.AccuracyScore === "number" ? top.AccuracyScore : null,
    fluencyScore:
      typeof top?.FluencyScore === "number" ? top.FluencyScore : null,
    prosodyScore:
      typeof top?.ProsodyScore === "number" ? top.ProsodyScore : null,
    completenessScore:
      typeof top?.CompletenessScore === "number" ? top.CompletenessScore : null,
    pronScore: typeof top?.PronScore === "number" ? top.PronScore : null,
    errorCounts,
    words,
    pauses,
  };
};

const azureSentiment = async ({ text, language }) => {
  const key = process.env.AZURE_LANGUAGE_KEY;
  const endpoint = process.env.AZURE_LANGUAGE_ENDPOINT;
  if (!key || !endpoint) return null;

  const versions = [];
  if (process.env.AZURE_LANGUAGE_API_VERSION)
    versions.push(process.env.AZURE_LANGUAGE_API_VERSION);
  versions.push("2024-11-01");
  versions.push("2023-04-15-preview");

  const lang = toLanguageCode(language) || "en";
  const body = {
    kind: "SentimentAnalysis",
    parameters: { modelVersion: "latest", opinionMining: "True" },
    analysisInput: {
      documents: [{ id: "1", language: lang, text: String(text || "") }],
    },
  };

  for (const v of versions) {
    const url = `${endpoint.replace(
      /\/+$/,
      ""
    )}/language/:analyze-text?api-version=${encodeURIComponent(v)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": key,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) continue;
    const json = await res.json();
    const doc = json?.results?.documents?.[0] || null;
    if (!doc) return null;
    return {
      sentiment: typeof doc?.sentiment === "string" ? doc.sentiment : null,
      confidenceScores: doc?.confidenceScores || null,
    };
  }

  return null;
};

const transcribeWithAzure = async ({
  buffer,
  mimetype,
  audioUrl,
  language,
  locales,
}) => {
  return azureFastTranscribe({ buffer, mimetype, audioUrl, language, locales });
};

/* ─── Whisper fallback for languages Azure STT does not support ─── */
const WHISPER_SUPPORTED_LANGS = new Set([
  "af","ar","hy","az","be","bs","bg","ca","zh","hr","cs","da","nl","en",
  "et","fi","fr","gl","de","el","he","hi","hu","is","id","it","ja","kn",
  "kk","ko","lv","lt","mk","ms","mr","mi","ne","no","fa","pl","pt","ro",
  "ru","sr","sk","sl","es","sw","sv","tl","ta","th","tr","uk","ur","vi","cy",
  "gu","bn","te","ml",
]);

const SCRIPT_FIX_MAP = {
  pa: { wrong: /[\u0900-\u097F]/, label: "Devanagari→Gurmukhi" },
};

const whisperTranscribe = async ({ buffer, audioUrl, language }) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[whisper] No OPENAI_API_KEY, cannot transcribe");
    return { text: "", insights: null };
  }

  let audioBuffer = buffer;
  let filename = "audio.wav";

  if (!audioBuffer && audioUrl) {
    const resp = await fetch(audioUrl);
    if (!resp.ok) {
      console.error("[whisper] Failed to fetch audio:", resp.status);
      return { text: "", insights: null };
    }
    audioBuffer = Buffer.from(await resp.arrayBuffer());
    const ext = audioUrl.split("?")[0].split(".").pop() || "wav";
    filename = `audio.${ext}`;
  }

  if (!audioBuffer || audioBuffer.length === 0) return { text: "", insights: null };

  // Only pass language if Whisper supports it; otherwise auto-detect
  const whisperLang = language && WHISPER_SUPPORTED_LANGS.has(language) ? language : null;
  console.log("[whisper] Transcribing lang:", language, whisperLang ? "(supported)" : "(auto-detect)", "size:", audioBuffer.length);

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), filename);
  form.append("model", "whisper-1");
  if (whisperLang) form.append("language", whisperLang);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[whisper] API error:", errText?.substring(0, 200));
    // If it failed with a language param, retry without it
    if (whisperLang) {
      console.log("[whisper] Retrying without language param (auto-detect)...");
      const form2 = new FormData();
      form2.append("file", new Blob([audioBuffer], { type: "audio/wav" }), filename);
      form2.append("model", "whisper-1");
      const res2 = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form2,
      });
      if (res2.ok) {
        const json2 = await res2.json();
        console.log("[whisper] Auto-detect result:", json2.text?.substring(0, 100));
        return { text: json2.text || "", insights: null };
      }
    }
    return { text: "", insights: null };
  }

  const json = await res.json();
  console.log("[whisper] Result:", json.text?.substring(0, 100));
  return { text: json.text || "", insights: null };
};

/* ─── Google Translate helper (for auto-generating suggested translations) ─── */
const googleTranslate = async (text, targetLang, sourceLang = null) => {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey || !text) return null;
  try {
    const body = { q: text, target: targetLang, format: "text" };
    if (sourceLang) body.source = sourceLang;
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.translations?.[0]?.translatedText || null;
  } catch (e) {
    console.error("[rapid-scoring] Google Translate error:", e.message?.substring(0, 100));
    return null;
  }
};

/* ─── Google Cloud Speech-to-Text (native support for Punjabi and other languages) ─── */
const GOOGLE_STT_LOCALE_MAP = {
  pa: "pa-Guru-IN",
};

const googleSTT = async ({ buffer, audioUrl, mimetype, language }) => {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  const locale = GOOGLE_STT_LOCALE_MAP[language];
  if (!apiKey || !locale) return null;

  try {
    let audioBuffer = buffer;
    if (!audioBuffer && audioUrl) {
      const resp = await fetch(audioUrl);
      if (!resp.ok) { console.error("[google-stt] fetch audio failed:", resp.status); return null; }
      audioBuffer = Buffer.from(await resp.arrayBuffer());
    }
    if (!audioBuffer || audioBuffer.length === 0) return null;

    const audioContent = Buffer.from(audioBuffer).toString("base64");

    // Auto-detect encoding from magic bytes, fall back to mimetype
    let encoding = "LINEAR16";
    let sampleRateHertz = 16000;
    if (audioBuffer.length >= 4) {
      const b = audioBuffer;
      if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {
        encoding = "WEBM_OPUS"; sampleRateHertz = 48000;
      } else if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) {
        encoding = "OGG_OPUS"; sampleRateHertz = 48000;
      } else if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) {
        encoding = "MP3"; sampleRateHertz = 16000;
      } else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
        encoding = "LINEAR16"; sampleRateHertz = 16000;
      } else if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) {
        encoding = "FLAC"; sampleRateHertz = 16000;
      } else {
        const mt = mimetype || "";
        if (mt.includes("webm") || mt.includes("opus")) { encoding = "WEBM_OPUS"; sampleRateHertz = 48000; }
        else if (mt.includes("ogg")) { encoding = "OGG_OPUS"; sampleRateHertz = 48000; }
        else if (mt.includes("mp3") || mt.includes("mpeg")) { encoding = "MP3"; sampleRateHertz = 16000; }
        else if (mt.includes("flac")) { encoding = "FLAC"; sampleRateHertz = 16000; }
      }
    }

    console.log(`[google-stt] Transcribing (${locale}, ${encoding}, ${audioBuffer.length} bytes)`);

    const body = {
      config: {
        encoding,
        sampleRateHertz,
        languageCode: locale,
        enableAutomaticPunctuation: true,
      },
      audio: { content: audioContent },
    };

    const res = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(apiKey)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[google-stt] Error:", errText?.substring(0, 300));
      return null;
    }

    const json = await res.json();
    const transcript = json.results
      ?.map((r) => r.alternatives?.[0]?.transcript)
      .filter(Boolean)
      .join(" ") || "";

    console.log("[google-stt] Result:", transcript?.substring(0, 100));
    return { text: transcript, insights: null };
  } catch (e) {
    console.error("[google-stt] Exception:", e.message?.substring(0, 200));
    return null;
  }
};

const scoreWithOpenAI = async ({
  combinedTranscript,
  language,
  referenceText,
  azureInsights,
  segmentRepeatCount,
  dialogueRepeatCount,
}) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required");

  const model = process.env.OPENAI_SCORE_MODEL || "gpt-4o-mini";

  const systemPrompt = `You are an expert NAATI CCL examiner. You assess community language interpreting using NAATI's official deductive marking system.

CRITICAL — MACHINE BACK-TRANSLATION WARNING:
The student's LOTE (Language Other Than English) response has been machine-translated back to English using Google Translate. This back-translation is UNRELIABLE and may:
- Produce vulgar, offensive, or nonsensical English words that the student NEVER said
- Completely distort the meaning of what the student actually said
- Miss nuance, idioms, and colloquial expressions
- Truncate or garble portions of the text

Therefore, you MUST:
1. Extract KEY CONCEPTS from the suggested/reference translation (e.g., "bank account", "transactions", "worried", "debit card", "compromised")
2. Check if the student's back-translation contains ANY of these key concepts, even in distorted form
3. Give PARTIAL CREDIT generously — if the student captured 30-50% of key concepts, award at LEAST 10-15/28 for message transfer
4. Give credit for RELATED concepts (e.g., "card details" matches "debit card details"; "worried" matches "concerned")
5. 0/28 for message transfer should ONLY be given if the student said something COMPLETELY unrelated to the topic (e.g., talking about weather when the topic is banking)
6. If the student mentioned the general TOPIC (e.g., card/bank/money), they deserve at least 8-12/28

NAATI RULES:
1. INDIRECT SPEECH IS NOT ACCEPTABLE - Direct/first-person speech is required. Third-person = deduct marks.
2. One segment repeat per dialogue is free; additional repeats cost 1 mark each.
3. Excessive self-corrections (>2) cost 1 mark.
4. Long pauses (>5 seconds) = mark deductions.
5. Filler overuse (>3) costs 1 mark.

SCORING PHILOSOPHY:
- Be FAIR and GENEROUS with partial credit — this is practice, not a pass/fail exam
- If the student spoke fluently in the correct language, Fluency should be 4-6/6
- If the student spoke clearly, Pronunciation should be 2-3/3
- Language Quality should be 4-8/8 if they used correct grammar in the target language
- SCORE EACH CATEGORY INDEPENDENTLY — poor message transfer does NOT reduce fluency/pronunciation
- A student who speaks fluently with good pronunciation but wrong meaning: high fluency + high pronunciation + low message transfer
- If no Azure speech data is available, give at LEAST 3/6 fluency and 2/3 pronunciation for any student who spoke clearly`;

  const userPrompt = `## SOURCE (What was said - to be interpreted):
"${referenceText || "Not provided. Use REFERENCE transcript below."}"

## AZURE SPEECH ANALYSIS:
${azureInsights ? JSON.stringify(azureInsights) : "Not available for this language"}

## FULL TRANSCRIPT:
${combinedTranscript}

## REPEAT INFO:
- Segment repeat count: ${segmentRepeatCount ?? 0} ${(segmentRepeatCount ?? 0) > 0 ? "⚠️ PENALTY APPLIES if dialogue total > 1" : ""}
- Total dialogue repeats used: ${dialogueRepeatCount ?? 0}/1 free

---

## SCORING TASK

Score this segment out of 45 marks using NAATI's deductive system.

### SCORING BREAKDOWN (45 marks total):

**1. MESSAGE TRANSFER & ACCURACY (0-28 marks)** - PRIMARY CRITERION
STEP 1: Extract key concepts from the SUGGESTED translation (e.g., for "I noticed two transactions on my bank account that I did not make, and I'm worried my debit card details have been compromised" → key concepts: [transactions, bank account, did not make, worried, debit card, details, compromised])
STEP 2: Check how many key concepts appear in the STUDENT's back-translation, even in different wording
STEP 3: Score based on concept coverage:
  - 80-100% concepts matched → 22-28 marks
  - 60-80% concepts matched → 16-22 marks
  - 40-60% concepts matched → 10-16 marks
  - 20-40% concepts matched → 5-10 marks
  - Related topic but few concepts → 3-5 marks
  - Completely unrelated topic → 0-3 marks
REMEMBER: Back-translation is unreliable. If the student's text mentions the same TOPIC (banking, medical, legal, etc.), it likely captured more meaning than the translation shows.

**2. LANGUAGE QUALITY (0-8 marks)**
- If student spoke in the correct target language → minimum 3/8
- Grammar correctness, vocabulary, register, natural expression
- Score this based on the ORIGINAL transcript, not the back-translation

**3. FLUENCY & DELIVERY (0-6 marks)**
- If student spoke without major hesitation → minimum 3/6
- If Azure data available: Fluency > 80 → 5-6, 60-80 → 3-4, < 60 → 1-2
- If no Azure data: assume at least 3/6 for a student who completed the segment

**4. PRONUNCIATION (0-3 marks)**
- If student spoke clearly enough to be transcribed → minimum 2/3
- If Azure data: Accuracy > 85 → 3, 70-85 → 2, < 70 → 1
- If no Azure data: give 2/3 as default for clear speech

### PENALTY DEDUCTIONS (Apply after base scoring):
| Issue | Deduction |
|-------|-----------|
| Indirect speech (single instance) | -2 |
| Indirect speech (multiple/entire) | -5 to -10 + FLAG |
| Long pause mid-interpretation (>5 sec) | -1 per occurrence |
| Segment repeat beyond free allowance | -1 |
| Excessive self-corrections (>2) | -1 |
| Filler overuse (>3) | -1 |

### DETECTION REQUIREMENTS
1. **Mispronounced Words**: List words with Azure accuracyScore < 80
2. **Fillers**: Detect "um", "uh", "ah", "er", "hmm", "like", "you know"
3. **Self-Corrections**: Detect "sorry", "I mean", "let me repeat", "correction"
4. **Indirect Speech**: Detect "he said", "she mentioned", "they told", "the doctor said"

Return ONLY valid JSON matching the required schema.`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_output_tokens: 1500,
      text: {
        format: {
          type: "json_schema",
          name: "naati_score",
          strict: true,
          schema: scoreSchema,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Scoring error: ${text}`);
  }

  const json = await res.json();
  const text = extractResponseText(json);
  const parsed = JSON.parse(text);
  return normalizeScores(parsed);
};

export const runAiRapidReview = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file?.buffer)
      return res
        .status(400)
        .json({ success: false, message: "userAudio file is required" });

    const rapidReviewId = toInt(req.body.rapidReviewId);
    const language = req.body.language ? String(req.body.language) : null;
    const translationText = req.body.translationText
      ? String(req.body.translationText).trim()
      : null;
    const authUserId = toInt(req.body.userId);

    if (!authUserId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!rapidReviewId)
      return res
        .status(400)
        .json({ success: false, message: "rapidReviewId is required" });

    const rapidReview = await RapidReview.findByPk(rapidReviewId);
    if (!rapidReview)
      return res
        .status(404)
        .json({ success: false, message: "RapidReview not found" });

    const rrSegmentsRaw = rapidReview.segments;

    // handle JSON array (or string just in case)
    const rrSegmentIds = Array.isArray(rrSegmentsRaw)
      ? rrSegmentsRaw.map((x) => toInt(x)).filter(Boolean)
      : (() => {
          try {
            const parsed = JSON.parse(rrSegmentsRaw);
            return Array.isArray(parsed)
              ? parsed.map((x) => toInt(x)).filter(Boolean)
              : [];
          } catch {
            return [];
          }
        })();

    const segmentId = toInt(req.body.segmentId);
    if (!segmentId) {
      return res
        .status(400)
        .json({ success: false, message: "segmentId is required" });
    }

    if (!rrSegmentIds.includes(segmentId)) {
      return res.status(400).json({
        success: false,
        message: "segmentId does not belong to rapidReviewId",
      });
    }

    const segment = await Segment.findByPk(segmentId);
    if (!segment)
      return res
        .status(404)
        .json({ success: false, message: "Segment not found" });

    const dialogue = await Dialogue.findByPk(segment.dialogueId);
    if (!dialogue)
      return res
        .status(404)
        .json({ success: false, message: "Dialogue not found" });

    const referenceAudioUrl = req.body.audioUrl
      ? String(req.body.audioUrl)
      : segment.audioUrl || null;

    const suggestedAudioUrl = req.body.suggestedAudioUrl
      ? String(req.body.suggestedAudioUrl)
      : segment.suggestedAudioUrl || null;

    if (!referenceAudioUrl && !suggestedAudioUrl) {
      return res.status(400).json({
        success: false,
        message:
          "No reference audio found (audioUrl/suggestedAudioUrl missing)",
      });
    }

    const uploaded = await uploadAudioToS3({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      keyPrefix: `users/${authUserId}/rapid-review/${rapidReviewId}/segments/${segmentId}`,
    });

    const userAudioUrl = uploaded.url;

    // --- CCL language handling ---
    // Normalize language name→code for Azure locale lookup
    const langCode = toLanguageCode(language) || language;
    console.log("[rapid-scoring] language param:", language, "→ langCode:", langCode);
    const loteLocales = toAzureLocales(langCode);     // e.g. ["pa-IN"]
    const enLocales  = ["en-AU", "en-US", "en-GB"];
    const bothLocales = [...new Set([...enLocales, ...loteLocales])]; // auto-detect

    const segOrder = segment.segmentOrder || 1;
    const isOddSegment = segOrder % 2 === 1;  // odd = English→LOTE
    // Reference audio language (source):
    const refLocales = isOddSegment ? enLocales : loteLocales;
    // Suggested audio language (target = opposite of source):
    const sugLocales = isOddSegment ? loteLocales : enLocales;
    // Student speaks the TARGET language:
    const stuLocales = isOddSegment ? loteLocales : enLocales;
    // For GPT context:
    const studentSpeaksLanguage = isOddSegment ? (language || "LOTE") : "English";
    const languageDisplayName = toLanguageName(langCode);
    const studentSpeaksDisplayName = isOddSegment ? languageDisplayName : "English";

    let referenceTranscript = "";
    let suggestedTranscript = "";
    let studentTranscript = "";

    let azureRef = null;
    let azureSug = null;
    let azureStu = null;

    // ─── Reference audio transcription ───
    if (referenceAudioUrl) {
      const refLang = isOddSegment ? "en" : langCode;
      if (refLocales.length > 0) {
        try {
          azureRef = await transcribeWithAzure({ audioUrl: referenceAudioUrl, locales: bothLocales });
          referenceTranscript = azureRef?.text ? String(azureRef.text) : "";
        } catch {
          try {
            const refAudio = await fetchAudio(referenceAudioUrl);
            azureRef = await transcribeWithAzure({ buffer: refAudio.buffer, mimetype: refAudio.mimetype, locales: bothLocales });
            referenceTranscript = azureRef?.text ? String(azureRef.text) : "";
          } catch (refErr) {
            console.log("[rapid-scoring] Azure ref failed twice, Whisper fallback:", refErr.message?.substring(0, 100));
          }
        }
      }
      if (!referenceTranscript) {
        const gRef = await googleSTT({ audioUrl: referenceAudioUrl, mimetype: "audio/webm", language: refLang });
        if (gRef?.text) {
          referenceTranscript = gRef.text;
          console.log("[rapid-scoring] Google STT reference:", referenceTranscript?.substring(0, 80));
        }
      }
      if (!referenceTranscript) {
        console.log("[rapid-scoring] Using Whisper for reference audio (lang:", refLang, ")");
        const wRef = await whisperTranscribe({ audioUrl: referenceAudioUrl, language: refLang });
        referenceTranscript = wRef.text;
      }
    }

    // ─── Suggested audio / translation text ───
    if (translationText) {
      suggestedTranscript = translationText;
      console.log("✅ Using frontend-provided translationText as suggestedTranscript (rapid review)");
    } else if (suggestedAudioUrl) {
      const sugLang = isOddSegment ? langCode : "en";
      if (sugLocales.length > 0) {
        try {
          azureSug = await transcribeWithAzure({ audioUrl: suggestedAudioUrl, locales: bothLocales });
          suggestedTranscript = azureSug?.text ? String(azureSug.text) : "";
        } catch {
          try {
            const sugAudio = await fetchAudio(suggestedAudioUrl);
            azureSug = await transcribeWithAzure({ buffer: sugAudio.buffer, mimetype: sugAudio.mimetype, locales: bothLocales });
            suggestedTranscript = azureSug?.text ? String(azureSug.text) : "";
          } catch (sugErr) {
            console.log("[rapid-scoring] Azure sug failed twice, Whisper fallback:", sugErr.message?.substring(0, 100));
          }
        }
      }
      if (!suggestedTranscript) {
        const gSug = await googleSTT({ audioUrl: suggestedAudioUrl, mimetype: "audio/webm", language: sugLang });
        if (gSug?.text) {
          suggestedTranscript = gSug.text;
          console.log("[rapid-scoring] Google STT suggested:", suggestedTranscript?.substring(0, 80));
        }
      }
      if (!suggestedTranscript) {
        console.log("[rapid-scoring] Using Whisper for suggested audio (lang:", sugLang, ")");
        const wSug = await whisperTranscribe({ audioUrl: suggestedAudioUrl, language: sugLang });
        suggestedTranscript = wSug.text;
      }
    }

    // ─── Student audio transcription ───
    if (stuLocales.length > 0) {
      try {
        azureStu = await transcribeWithAzure({
          buffer: file.buffer,
          mimetype: file.mimetype,
          locales: stuLocales,
        });
        studentTranscript = azureStu?.text ? String(azureStu.text) : "";
      } catch (stuErr) {
        console.error("[rapid-scoring] Azure student error:", stuErr.message?.substring(0, 100));
      }
    }
    // Google Cloud STT fallback (better for Punjabi etc.)
    if (!studentTranscript) {
      const stuLang = isOddSegment ? langCode : "en";
      const gStu = await googleSTT({ buffer: file.buffer, mimetype: file.mimetype, language: stuLang });
      if (gStu?.text) {
        studentTranscript = gStu.text;
        console.log("[rapid-scoring] Google STT student:", studentTranscript?.substring(0, 80));
      }
    }
    if (!studentTranscript) {
      const stuLang = isOddSegment ? langCode : "en";
      console.log("[rapid-scoring] Using Whisper for student audio (lang:", stuLang, ")");
      const wStu = await whisperTranscribe({ buffer: file.buffer, language: stuLang });
      studentTranscript = wStu.text;
    }

    // ─── Auto-generate suggested translation if missing ───
    if (!suggestedTranscript && segment.textContent) {
      const srcText = String(segment.textContent).trim();
      if (srcText) {
        const translateTo = isOddSegment ? langCode : "en";
        const translateFrom = isOddSegment ? "en" : langCode;
        console.log("[rapid-scoring] Auto-translating textContent for suggested (", translateFrom, "→", translateTo, ")");
        const translated = await googleTranslate(srcText, translateTo, translateFrom);
        if (translated) {
          suggestedTranscript = translated;
          console.log("[rapid-scoring] Auto-translated suggested:", translated.substring(0, 80));
        }
      }
    }

    // ─── Convert transcripts to correct LOTE script (e.g. Devanagari→Gurmukhi for Punjabi) ───
    const scriptFix = SCRIPT_FIX_MAP[langCode];
    if (scriptFix) {
      if (isOddSegment && studentTranscript && scriptFix.wrong.test(studentTranscript)) {
        const converted = await googleTranslate(studentTranscript, langCode);
        if (converted) {
          console.log(`[rapid-scoring] ${scriptFix.label} student:`, converted.substring(0, 80));
          studentTranscript = converted;
        }
      }
      if (!isOddSegment && referenceTranscript && scriptFix.wrong.test(referenceTranscript)) {
        const converted = await googleTranslate(referenceTranscript, langCode);
        if (converted) {
          console.log(`[rapid-scoring] ${scriptFix.label} reference:`, converted.substring(0, 80));
          referenceTranscript = converted;
        }
      }
      if (suggestedTranscript && scriptFix.wrong.test(suggestedTranscript)) {
        const converted = await googleTranslate(suggestedTranscript, langCode);
        if (converted) {
          console.log(`[rapid-scoring] ${scriptFix.label} suggested:`, converted.substring(0, 80));
          suggestedTranscript = converted;
        }
      }
    }

    // ─── Back-translate LOTE transcripts to English for GPT comparison ───
    let suggestedForGPT = suggestedTranscript;
    let studentForGPT = studentTranscript;
    let referenceForGPT = referenceTranscript;

    if (isOddSegment && langCode && langCode !== "en") {
      if (studentTranscript) {
        const stuEn = await googleTranslate(studentTranscript, "en");
        if (stuEn) {
          studentForGPT = stuEn;
          console.log("[rapid-scoring] Student back-translated to EN:", stuEn.substring(0, 80));
        }
      }
      if (suggestedTranscript) {
        const sugEn = await googleTranslate(suggestedTranscript, "en");
        if (sugEn) {
          suggestedForGPT = sugEn;
          console.log("[rapid-scoring] Suggested back-translated to EN:", sugEn.substring(0, 80));
        }
      }
    } else if (!isOddSegment && langCode && langCode !== "en") {
      if (referenceTranscript && !/^[\x00-\x7F]*$/.test(referenceTranscript)) {
        const refEn = await googleTranslate(referenceTranscript, "en");
        if (refEn) {
          referenceForGPT = refEn;
          console.log("[rapid-scoring] Reference back-translated to EN:", refEn.substring(0, 80));
        }
      }
    }

    console.log("[rapid-scoring] ── Segment", segOrder, "──");
    console.log("[rapid-scoring] direction:", isOddSegment ? "English→" + (language || "LOTE") : (language || "LOTE") + "→English");
    console.log("[rapid-scoring] langCode:", langCode, "loteLocales:", loteLocales, "stuLocales:", stuLocales);
    console.log("[rapid-scoring] referenceTranscript:", referenceTranscript?.substring(0, 80) || "(empty)");
    console.log("[rapid-scoring] suggestedTranscript:", suggestedTranscript?.substring(0, 80) || "(empty)");
    console.log("[rapid-scoring] studentTranscript:", studentTranscript?.substring(0, 80) || "(empty)");
    console.log("[rapid-scoring] studentForGPT:", studentForGPT?.substring(0, 80) || "(empty)");
    console.log("[rapid-scoring] suggestedForGPT:", suggestedForGPT?.substring(0, 80) || "(empty)");

    const combinedTranscript =
      `SEGMENT (Segment ${segOrder}, ${isOddSegment ? "English→" + languageDisplayName : languageDisplayName + "→English"}):\n` +
      `DIRECTION: Student must translate from ${isOddSegment ? "English" : languageDisplayName} into ${studentSpeaksDisplayName}\n` +
      `REFERENCE (source audio - English): ${referenceForGPT || "(empty)"}\n` +
      `SUGGESTED (correct translation - English): ${suggestedForGPT || "(empty)"}\n` +
      `STUDENT (translated to English for comparison): ${studentForGPT || "(empty)"}\n` +
      `STUDENT (original ${studentSpeaksDisplayName}): ${studentTranscript || "(empty)"}\n` +
      `NOTE: "${studentSpeaksDisplayName}" is the target language. Score fluency and pronunciation based on how well the student spoke, regardless of message accuracy.`;

    // For pronunciation assessment, use the suggested transcript (correct translation)
    // as the reference text, since that's what the student should match
    const pronRefText =
      (suggestedTranscript && String(suggestedTranscript).trim()) ||
      (segment.textContent && String(segment.textContent).trim()) ||
      (referenceTranscript && String(referenceTranscript).trim()) ||
      "";

    const studentPron = await azurePronunciationAssessmentShort({
      buffer: file.buffer,
      mimetype: file.mimetype,
      language: studentSpeaksLanguage,
      referenceText: pronRefText,
    });

    const sentiment = await azureSentiment({
      text: studentTranscript,
      language,
    });

    const azureInsights = {
      reference: azureRef?.insights || null,
      suggested: azureSug?.insights || null,
      student: azureStu?.insights || null,
      studentPronunciation: studentPron || null,
      studentSentiment: sentiment || null,
    };
    console.log(azureInsights);

    const prevMax = await RapidReviewAttempt.max("repeatCount", {
      where: { userId: authUserId, rapidReviewId, segmentId },
    });
    const repeatCount = Number(prevMax || 0) + 1;

    const scores = await scoreWithOpenAI({
      combinedTranscript,
      language,
      referenceText: segment.textContent || null,
      azureInsights,
      segmentRepeatCount: repeatCount - 1,
      dialogueRepeatCount: 0,
    });
    console.log(scores);

    const rapidReviewAttempt = await RapidReviewAttempt.create({
      rapidReviewId,
      userId: authUserId,
      segmentId,
      audioUrl: userAudioUrl,
      userTranscription: studentTranscript,
      aiScores: scores,
      accuracyScore: scores.accuracy_score,
      overallScore: scores.final_score,
      feedback: scores.one_line_feedback,
      languageQualityScore: scores.language_quality_score,
      languageQualityText: scores.language_quality_feedback,
      fluencyPronunciationScore: scores.fluency_pronunciation_score,
      fluencyPronunciationText: scores.fluency_pronunciation_feedback,
      deliveryCoherenceScore: scores.delivery_coherence_score,
      deliveryCoherenceText: scores.delivery_coherence_feedback,
      culturalControlScore: scores.cultural_context_score,
      culturalControlText: scores.cultural_context_feedback,
      responseManagementScore: scores.response_management_score,
      responseManagementText: scores.response_management_feedback,
      totalRawScore: scores.total_raw_score ?? scores.rawScore,
      finalScore: scores.final_score ?? scores.finalScore,
      oneLineFeedback: scores.one_line_feedback ?? scores.examinerNotes,
      language: language,
      repeatCount,
    });

    return res.json({
      success: true,
      data: {
        rapidReviewId,
        segmentId,
        dialogueId: segment.dialogueId,
        userAudioUrl,
        referenceAudioUrl,
        suggestedAudioUrl,
        transcripts: {
          referenceTranscript,
          suggestedTranscript,
          studentTranscript,
          combinedTranscript,
        },
        scores,
        rapidReviewAttempt,
      },
    });
  } catch (e) {
    return next(e);
  }
};
