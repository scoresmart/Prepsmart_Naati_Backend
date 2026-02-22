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
  const accuracy_score = clamp(raw.accuracy_score, 0, 15);
  const language_quality_score = clamp(raw.language_quality_score, 0, 10);
  const fluency_pronunciation_score = clamp(
    raw.fluency_pronunciation_score,
    0,
    8
  );
  const delivery_coherence_score = clamp(raw.delivery_coherence_score, 0, 5);
  const cultural_context_score = clamp(raw.cultural_context_score, 0, 4);
  const response_management_score = clamp(raw.response_management_score, 0, 3);

  const total_raw_score =
    accuracy_score +
    language_quality_score +
    fluency_pronunciation_score +
    delivery_coherence_score +
    cultural_context_score +
    response_management_score;

  const final_score = Math.max(5, total_raw_score);

  return {
    accuracy_score,
    accuracy_feedback: raw.accuracy_feedback ?? "",
    language_quality_score,
    language_quality_feedback: raw.language_quality_feedback ?? "",
    fluency_pronunciation_score,
    fluency_pronunciation_feedback: raw.fluency_pronunciation_feedback ?? "",
    delivery_coherence_score,
    delivery_coherence_feedback: raw.delivery_coherence_feedback ?? "",
    cultural_context_score,
    cultural_context_feedback: raw.cultural_context_feedback ?? "",
    response_management_score,
    response_management_feedback: raw.response_management_feedback ?? "",
    total_raw_score,
    final_score,
    one_line_feedback: raw.one_line_feedback ?? "",
  };
};

const scoreSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "accuracy_score",
    "accuracy_feedback",
    "language_quality_score",
    "language_quality_feedback",
    "fluency_pronunciation_score",
    "fluency_pronunciation_feedback",
    "delivery_coherence_score",
    "delivery_coherence_feedback",
    "cultural_context_score",
    "cultural_context_feedback",
    "response_management_score",
    "response_management_feedback",
    "one_line_feedback",
  ],
  properties: {
    accuracy_score: { type: "number" },
    accuracy_feedback: { type: "string" },
    language_quality_score: { type: "number" },
    language_quality_feedback: { type: "string" },
    fluency_pronunciation_score: { type: "number" },
    fluency_pronunciation_feedback: { type: "string" },
    delivery_coherence_score: { type: "number" },
    delivery_coherence_feedback: { type: "string" },
    cultural_context_score: { type: "number" },
    cultural_context_feedback: { type: "string" },
    response_management_score: { type: "number" },
    response_management_feedback: { type: "string" },
    one_line_feedback: { type: "string" },
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
  };
  return (map[s.toLowerCase()] || []).map(normalizeLocale).filter(Boolean);
};

const toLanguageCode = (language) => {
  const s = String(language || "").trim();
  if (!s) return null;
  return s.split("-")[0] || null;
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

  const locales = toAzureLocales(language);
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
    Granularity: "Word",
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
  for (const ww of wordList) {
    const t = ww?.ErrorType;
    if (typeof t === "string" && t in errorCounts) errorCounts[t] += 1;
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
}) => {
  return azureFastTranscribe({ buffer, mimetype, audioUrl, language });
};

const scoreWithOpenAI = async ({
  combinedTranscript,
  language,
  referenceText,
  azureInsights,
}) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required");

  const model = process.env.OPENAI_SCORE_MODEL || "gpt-4o-mini";
  console.log("azureInsights",  JSON.stringify(azureInsights));
  const prompt = `
  You are an expert NAATI speaking examiner for PrepSmart.
  
  Task: Score ONE dialogue attempt (or one segment attempt) out of 45 marks using six parameters. 
  Each parameter MUST be scored independently within its exact range and include a short feedback note.
  
  Inputs:
  - REFERENCE: what the audio said (ground truth ASR for the source dialogue)
  - SUGGESTED: an ideal version (if present)
  - STUDENT: what the student said (student ASR)
  
  Language (optional): ${language || "unspecified"}.
  
  REFERENCE SCRIPT (optional):
  ${referenceText || "Not provided. Use ASR transcripts as reference."}
  
  AZURE ASR / PRONUNCIATION / SENTIMENT INSIGHTS (optional JSON):
  ${azureInsights ? JSON.stringify(azureInsights) : "Not provided."}
  
  FULL TRANSCRIPT:
  ${combinedTranscript}
  
  Scoring (TOTAL = 45):
  1) Accuracy & Meaning Transfer (0–15): meaning, tone, intent, omissions/distortions
  2) Language Quality (0–10): grammar, vocab, register/formality
  3) Fluency & Pronunciation (0–8): smoothness, clarity, pacing, pauses/fillers (use Azure pronunciation/confidence if provided)
  4) Delivery & Coherence (0–5): flow, confidence, organization
  5) Cultural & Contextual Appropriateness (0–4): idioms, cultural meaning, respectful address
  6) Response Management (0–3): turn-taking, timing, completion
  
  Rules:
  - Use the provided reference script if available; otherwise use REFERENCE ASR as the reference.
  - Score each category strictly within its range.
  - Provide concise, actionable feedback for each category.
  - Do NOT include any extra keys, totals, or explanations outside the required JSON schema.
  - The backend applies a NAATI grace fallback where the final total cannot be less than 5.
  
  Return only JSON that matches the schema.
  `;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "You are an expert NAATI speaking examiner.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.25,
      max_output_tokens: 900,
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
          language,
        });
        referenceTranscript = azureRef?.text ? String(azureRef.text) : "";
      } catch {
        const refAudio = await fetchAudio(referenceAudioUrl);
        azureRef = await transcribeWithAzure({
          buffer: refAudio.buffer,
          mimetype: refAudio.mimetype,
          language,
        });
        referenceTranscript = azureRef?.text ? String(azureRef.text) : "";
      }
    }

    if (suggestedAudioUrl) {
      try {
        azureSug = await transcribeWithAzure({
          audioUrl: suggestedAudioUrl,
          language,
        });
        suggestedTranscript = azureSug?.text ? String(azureSug.text) : "";
      } catch {
        const sugAudio = await fetchAudio(suggestedAudioUrl);
        azureSug = await transcribeWithAzure({
          buffer: sugAudio.buffer,
          mimetype: sugAudio.mimetype,
          language,
        });
        suggestedTranscript = azureSug?.text ? String(azureSug.text) : "";
      }
    }

    azureStu = await transcribeWithAzure({
      buffer: file.buffer,
      mimetype: file.mimetype,
      language,
    });
    studentTranscript = azureStu?.text ? String(azureStu.text) : "";

    const combinedTranscript =
      `SEGMENT:\n` +
      `REFERENCE: ${referenceTranscript || "(empty)"}\n` +
      `SUGGESTED: ${suggestedTranscript || "(empty)"}\n` +
      `STUDENT: ${studentTranscript || "(empty)"}`;

    const pronRefText =
      (segment.textContent && String(segment.textContent).trim()) ||
      (referenceTranscript && String(referenceTranscript).trim()) ||
      (suggestedTranscript && String(suggestedTranscript).trim()) ||
      "";

    const studentPron = await azurePronunciationAssessmentShort({
      buffer: file.buffer,
      mimetype: file.mimetype,
      language,
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

    const scores = await scoreWithOpenAI({
      combinedTranscript,
      language,
      referenceText: segment.textContent || null,
      azureInsights,
    });

    let segmentAttempt = null;

    if (SegmentAttempt) {
      const hasExamAttemptId = Boolean(
        SegmentAttempt?.rawAttributes?.examAttemptId
      );
      const examAttemptId = toInt(req.body.examAttemptId);
      const whereForCount = { userId: authUserId, segmentId };
      if (hasExamAttemptId && examAttemptId)
        whereForCount.examAttemptId = examAttemptId;

      const prevMax = await SegmentAttempt.max("repeatCount", {
        where: whereForCount,
      });
      const repeatCount = Number(prevMax || 0) + 1;

      const data = {
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
        totalRawScore: scores.total_raw_score,
        finalScore: scores.final_score,
        oneLineFeedback: scores.one_line_feedback,
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
