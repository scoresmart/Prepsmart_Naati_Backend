import path from "node:path";
import { models } from "../models/index.js";
import { uploadAudioToS3 } from "../utils/aws.js";

const { Segment, Dialogue, SegmentAttempt } = models;

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
  const messageTransfer = clamp(raw.scores?.messageTransfer?.score ?? 0, 0, 28);
  const languageQuality = clamp(raw.scores?.languageQuality?.score ?? 0, 0, 8);
  const fluencyDelivery = clamp(raw.scores?.fluencyDelivery?.score ?? 0, 0, 6);
  const pronunciation = clamp(raw.scores?.pronunciation?.score ?? 0, 0, 3);

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
  return (map[s.toLowerCase()] || []).map(normalizeLocale).filter(Boolean);
};

const LANGUAGE_NAME_TO_CODE = {
  hindi: "hi",
  punjabi: "pa",
  nepali: "ne",
  mandarin: "zh",
  chinese: "zh",
  spanish: "es",
  english: "en",
  urdu: "ur",
  tamil: "ta",
  telugu: "te",
  bengali: "bn",
  bangla: "bn",
  gujarati: "gu",
  kannada: "kn",
  malayalam: "ml",
  marathi: "mr",
  arabic: "ar",
  persian: "fa",
  farsi: "fa",
  turkish: "tr",
  korean: "ko",
  japanese: "ja",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id",
  malay: "ms",
  russian: "ru",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  greek: "el",
  polish: "pl",
  czech: "cs",
  romanian: "ro",
  hungarian: "hu",
  swedish: "sv",
  danish: "da",
  finnish: "fi",
  norwegian: "no",
  ukrainian: "uk",
  serbian: "sr",
  croatian: "hr",
  bosnian: "bs",
  bulgarian: "bg",
  filipino: "tl",
  tagalog: "tl",
  sinhalese: "si",
  sinhala: "si",
  khmer: "km",
  burmese: "my",
  lao: "lo",
  swahili: "sw",
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
      const curEnd = (cur.offset + cur.duration) / 10000000; // 100-ns ticks → seconds
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

  const systemPrompt = `You are an expert NAATI CCL examiner. You assess community language interpreting using NAATI's official deductive marking system. You start with full marks and deduct for errors based on their impact on communication.

CRITICAL NAATI RULES YOU MUST ENFORCE:
1. INDIRECT SPEECH IS NOT ACCEPTABLE - Direct/first-person speech is required. If the student uses third-person ("he said", "she mentioned", "the doctor said"), deduct marks.
2. One segment repeat per dialogue is free; additional repeats cost 1 mark each.
3. Self-corrections are allowed if prefaced properly (e.g., "Sorry, I'll say that again"). Excessive self-corrections (>2 in a segment) cost 1 mark.
4. Long pauses (>5 seconds) result in mark deductions.
5. Filler overuse (>3 fillers like "um", "uh", "ah", "er") costs 1 mark.

YOUR SCORING PHILOSOPHY:
- Primary focus: MESSAGE TRANSFER (Did they convey the meaning accurately?)
- Secondary: Language quality, fluency, delivery
- Be fair but strict - match real NAATI standards
- 2-3 major errors per dialogue typically results in failure`;

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
- Completeness: Was ALL information conveyed?
- Accuracy: Is the meaning correct and undistorted?
- Omissions: List any missing information (minor = -1 to -2, major = -3 to -5 each)
- Distortions: List any meaning changes (minor = -1 to -2, major = -3 to -5 each)
- Insertions: List any added information not in source (-1 to -2 each)
- Numbers/Names/Dates: Must be exactly correct (-2 each if wrong)

**2. LANGUAGE QUALITY (0-8 marks)**
- Grammar correctness in target language
- Vocabulary appropriateness and precision
- Register/formality matching
- Natural expression (idiomatic, not literal word-for-word)

**3. FLUENCY & DELIVERY (0-6 marks)**
Use Azure data if available:
- Azure Fluency Score > 80 → 5-6 marks
- Azure Fluency Score 60-80 → 3-4 marks
- Azure Fluency Score < 60 → 1-2 marks
Also consider: Speaking pace, hesitations, fillers, flow, confidence

**4. PRONUNCIATION (0-3 marks)** - For English segments with Azure phoneme data
- Azure Accuracy Score > 85 → 3 marks
- Azure Accuracy Score 70-85 → 2 marks
- Azure Accuracy Score < 70 → 1 mark
- If no Azure data: score based on transcript clarity

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

export const runAiExam = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file?.buffer)
      return res
        .status(400)
        .json({ success: false, message: "userAudio file is required" });
    const token = req.headers.authorization;
    const segmentId = toInt(req.body.segmentId);
    const dialogueId = toInt(req.body.dialogueId);
    const language = req.body.language ? String(req.body.language) : null;
    const audioTranscript = req.body.audioTranscript
      ? String(req.body.audioTranscript)
      : null;
    const authUserId = req.body.userId;
    if (!authUserId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    if (!segmentId)
      return res
        .status(400)
        .json({ success: false, message: "segmentId is required" });

    const segment = await Segment.findByPk(segmentId);
    if (!segment)
      return res
        .status(404)
        .json({ success: false, message: "Segment not found" });

    if (dialogueId && segment.dialogueId !== dialogueId) {
      return res.status(400).json({
        success: false,
        message: "segmentId does not belong to dialogueId",
      });
    }

    const effectiveDialogueId = dialogueId || segment.dialogueId;

    const dialogue = await Dialogue.findByPk(effectiveDialogueId);
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

    // --- CCL language handling ---
    // In CCL, segments alternate: odd segments = English source → LOTE target,
    // even segments = LOTE source → English target.
    // Build combined locales so Azure auto-detects the correct language.
    const loteLocales = toAzureLocales(language);     // e.g. ["pa-IN"]
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

    const uploaded = await uploadAudioToS3({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      keyPrefix: `users/${authUserId}/ai-exam/dialogues/${effectiveDialogueId}/segments/${segmentId}`,
    });

    const userAudioUrl = uploaded.url;

    let referenceTranscript = "";
    let suggestedTranscript = "";
    let studentTranscript = "";

    let azureRef = null;
    let azureSug = null;
    let azureStu = null;

    if (referenceAudioUrl) {
      try {
        azureRef = await transcribeWithAzure({
          audioUrl: referenceAudioUrl,
          locales: bothLocales,
        });
        referenceTranscript = azureRef?.text ? String(azureRef.text) : "";
      } catch {
        const refAudio = await fetchAudio(referenceAudioUrl);
        azureRef = await transcribeWithAzure({
          buffer: refAudio.buffer,
          mimetype: refAudio.mimetype,
          locales: bothLocales,
        });
        referenceTranscript = azureRef?.text ? String(azureRef.text) : "";
      }
    }

    if (suggestedAudioUrl) {
      try {
        azureSug = await transcribeWithAzure({
          audioUrl: suggestedAudioUrl,
          locales: bothLocales,
        });
        suggestedTranscript = azureSug?.text ? String(azureSug.text) : "";
      } catch {
        const sugAudio = await fetchAudio(suggestedAudioUrl);
        azureSug = await transcribeWithAzure({
          buffer: sugAudio.buffer,
          mimetype: sugAudio.mimetype,
          locales: bothLocales,
        });
        suggestedTranscript = azureSug?.text ? String(azureSug.text) : "";
      }
    }

    azureStu = await transcribeWithAzure({
      buffer: file.buffer,
      mimetype: file.mimetype,
      locales: stuLocales.length ? stuLocales : bothLocales,
    });
    studentTranscript = azureStu?.text ? String(azureStu.text) : "";

    const combinedTranscript =
      `SEGMENT (Segment ${segOrder}, ${isOddSegment ? "English→" + (language || "LOTE") : (language || "LOTE") + "→English"}):\n` +
      `DIRECTION: Student must translate from ${isOddSegment ? "English" : (language || "LOTE")} into ${studentSpeaksLanguage}\n` +
      `REFERENCE (source audio): ${referenceTranscript || "(empty)"}\n` +
      `SUGGESTED (correct translation): ${suggestedTranscript || "(empty)"}\n` +
      `STUDENT (speaks ${studentSpeaksLanguage}): ${studentTranscript || "(empty)"}`;

    // For pronunciation assessment, use the suggested transcript (correct translation)
    // as the reference text, since that's what the student should match
    const pronRefText =
      (suggestedTranscript && String(suggestedTranscript).trim()) ||
      (segment.textContent && String(segment.textContent).trim()) ||
      (referenceTranscript && String(referenceTranscript).trim()) ||
      "";

    // Use the student's speaking language for pronunciation assessment
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

    // Calculate repeat counts for penalty assessment
    let repeatCount = 1;
    let dialogueRepeatTotal = 0;
    if (SegmentAttempt) {
      const hasExamAttemptId = Boolean(SegmentAttempt?.rawAttributes?.examAttemptId);
      const examAttemptId = toInt(req.body.examAttemptId);
      const whereForCount = { userId: authUserId, segmentId };
      if (hasExamAttemptId && examAttemptId) whereForCount.examAttemptId = examAttemptId;
      const prevMax = await SegmentAttempt.max("repeatCount", { where: whereForCount });
      repeatCount = Number(prevMax || 0) + 1;

      // Count total repeats across this dialogue
      const dialogueWhere = { userId: authUserId };
      if (hasExamAttemptId && examAttemptId) dialogueWhere.examAttemptId = examAttemptId;
      const allAttempts = await SegmentAttempt.findAll({ where: dialogueWhere, attributes: ["repeatCount"] });
      dialogueRepeatTotal = allAttempts.filter((a) => a.repeatCount > 1).length;
    }

    const scores = await scoreWithOpenAI({
      combinedTranscript,
      language,
      referenceText: segment.textContent || null,
      azureInsights,
      segmentRepeatCount: repeatCount - 1,
      dialogueRepeatCount: dialogueRepeatTotal,
    });

    let segmentAttempt = null;

    if (SegmentAttempt) {
      const hasExamAttemptId = Boolean(SegmentAttempt?.rawAttributes?.examAttemptId);
      const examAttemptId = toInt(req.body.examAttemptId);

      const data = {
        userId: authUserId,
        segmentId,
        audioUrl: userAudioUrl,
        userTranscription: studentTranscript,
        referenceTranscript: referenceTranscript || null,
        suggestedTranscript: suggestedTranscript || null,
        questionAudioUrl: referenceAudioUrl || null,
        suggestedAudioUrl: suggestedAudioUrl || null,
        questionTranscript: segment.textContent || audioTranscript || null,
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
      };

      if (hasExamAttemptId) data.examAttemptId = examAttemptId || null;

      segmentAttempt = await SegmentAttempt.create(data);
    }

    return res.json({
      success: true,
      data: {
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
        segmentAttempt,
      },
    });
  } catch (e) {
    return next(e);
  }
};
