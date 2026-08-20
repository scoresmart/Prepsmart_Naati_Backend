import path from "node:path";
import { Op } from "sequelize";
import { sequelize } from "../config/db.js";

import MockTest from "../models/mocketTest.model.js";
import MockTestSession from "../models/mockTestSession.model.js";
import MockTestResult from "../models/mockTestResult.js";
import MockTestAttempts from "../models/mockTestAttempt.js";

import { Dialogue } from "../models/dialogue.model.js";
import { Segment } from "../models/segment.model.js";

import { uploadAudioToS3 } from "../utils/aws.js";
import MockTestFinalResult from "../models/mockTestFinalResult.model.js";

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const toNum = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const round2 = (n) => Number((Math.round(Number(n) * 100) / 100).toFixed(2));

const clamp = (num, min, max) => {
  const n = typeof num === "number" ? num : Number(num);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const avgOfField = (items, field) => {
  const vals = (items || [])
    .map((x) => toNum(x?.[field]))
    .filter((n) => Number.isFinite(n));
  if (!vals.length) return 0;
  return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
};

const distributeMarks = (totalMarks, count) => {
  if (!count || count <= 0) return [];
  const total = round2(totalMarks);
  const base = round2(Math.floor((total / count) * 100) / 100);
  const arr = Array(count).fill(base);
  const current = round2(base * count);
  let rem = round2(total - current);
  let pennies = Math.round(rem * 100);
  let i = 0;
  while (pennies > 0) {
    arr[i] = round2(arr[i] + 0.01);
    pennies -= 1;
    i += 1;
    if (i >= arr.length) i = 0;
  }
  return arr;
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

const toAzureLocale = (lang) => {
  if (!lang) return null;
  const s = String(lang).trim();
  if (!s) return null;
  if (s.includes("-")) return s;
  const code = s.toLowerCase();
  const map = {
    af: "af-ZA",
    ar: "ar-SA",
    hy: "hy-AM",
    az: "az-AZ",
    be: "be-BY",
    bs: "bs-BA",
    bg: "bg-BG",
    ca: "ca-ES",
    zh: "zh-CN",
    hr: "hr-HR",
    cs: "cs-CZ",
    da: "da-DK",
    nl: "nl-NL",
    en: "en-US",
    et: "et-EE",
    fi: "fi-FI",
    fr: "fr-FR",
    gl: "gl-ES",
    de: "de-DE",
    el: "el-GR",
    he: "he-IL",
    hi: "hi-IN",
    hu: "hu-HU",
    is: "is-IS",
    id: "id-ID",
    it: "it-IT",
    ja: "ja-JP",
    kn: "kn-IN",
    kk: "kk-KZ",
    ko: "ko-KR",
    lv: "lv-LV",
    lt: "lt-LT",
    mk: "mk-MK",
    ms: "ms-MY",
    mr: "mr-IN",
    mi: "mi-NZ",
    ne: "ne-NP",
    no: "nb-NO",
    fa: "fa-IR",
    pl: "pl-PL",
    pt: "pt-PT",
    ro: "ro-RO",
    ru: "ru-RU",
    sr: "sr-RS",
    sk: "sk-SK",
    sl: "sl-SI",
    es: "es-ES",
    sw: "sw-KE",
    sv: "sv-SE",
    tl: "fil-PH",
    ta: "ta-IN",
    th: "th-TH",
    tr: "tr-TR",
    uk: "uk-UA",
    ur: "ur-PK",
    vi: "vi-VN",
    cy: "cy-GB",
  };
  return map[code] || null;
};

const transcribeWithOpenAI = async ({ buffer, mimetype, language }) => {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key) throw new Error("AZURE_SPEECH_KEY is required");
  const region = process.env.AZURE_SPEECH_REGION;
  if (!region) throw new Error("AZURE_SPEECH_REGION is required");
  const apiVersion = process.env.AZURE_SPEECH_API_VERSION || "2025-10-15";
  const endpointBase =
    process.env.AZURE_SPEECH_ENDPOINT ||
    `https://${region}.api.cognitive.microsoft.com`;
  const url = `${endpointBase}/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(
    apiVersion
  )}`;

  const locale = toAzureLocale(language);
  const definition = {};
  if (locale) definition.locales = [locale];

  const form = new FormData();
  const filename = `audio${
    mimetype === "audio/wav"
      ? ".wav"
      : mimetype === "audio/mpeg"
      ? ".mp3"
      : ".webm"
  }`;
  form.append("audio", new Blob([buffer], { type: mimetype }), filename);
  if (Object.keys(definition).length)
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
  const combined = Array.isArray(json?.combinedPhrases)
    ? json.combinedPhrases
    : [];
  const text = combined
    .map((x) => (x?.text ? String(x.text) : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (text) return text;

  const phrases = Array.isArray(json?.phrases) ? json.phrases : [];
  return phrases
    .map((p) => (p?.text ? String(p.text) : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
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

const scoreWithOpenAI = async ({
  combinedTranscript,
  language,
  referenceText,
}) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required");

  const model = process.env.OPENAI_SCORE_MODEL || "gpt-4o-mini";

  const prompt = `
You are an expert NAATI speaking examiner for PrepSmart.

Task: Score ONE dialogue attempt (or one segment attempt) out of 45 marks using six parameters. Each parameter MUST be scored independently within its exact range and include a short feedback note.

Inputs:
- REFERENCE: what the audio said (ground truth ASR for the source dialogue)
- SUGGESTED: an ideal version (if present)
- STUDENT: what the student said (student ASR)

Language (optional): ${language || "unspecified"}.

REFERENCE SCRIPT (optional):
${referenceText || "Not provided. Use ASR transcripts as reference."}

FULL TRANSCRIPT:
${combinedTranscript}

Scoring (TOTAL = 45):
1) Accuracy & Meaning Transfer (0–15): meaning, tone, intent, omissions/distortions
2) Language Quality (0–10): grammar, vocab, register/formality
3) Fluency & Pronunciation (0–8): smoothness, clarity, pacing, pauses/fillers
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

const generateOverallFeedback = async ({ averages, notes }) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required");

  const model = process.env.OPENAI_OVERALL_MODEL || "gpt-4o-mini";

  const prompt = [
    `Averages: ${JSON.stringify(averages)}`,
    `Per-segment notes:`,
    notes,
  ].join("\n\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions:
        "You are an English speaking exam evaluator. Read the per-segment feedback notes and averages, then write overall feedback in 5 to 7 short lines. Mention patterns across segments, 2 strengths, 2 improvement areas, and 1 specific actionable next step. Do not repeat the notes verbatim. No headings.",
      input: prompt,
      temperature: 0.4,
      max_output_tokens: 400,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Overall feedback error: ${text}`);
  }

  const json = await res.json();
  return (json?.output_text || extractResponseText(json) || "").trim();
};

const buildNotesFromResults = (results, segMap) => {
  return (results || [])
    .map((r) => {
      const seg = segMap.get(String(r.segmentId));
      const prompt = seg?.textContent
        ? String(seg.textContent).slice(0, 80)
        : "";
      const line = r.oneLineFeedback || r.feedback || "";
      return [
        `SegmentId=${r.segmentId} order=${
          seg?.segmentOrder ?? "?"
        } dialogueId=${seg?.dialogueId ?? "?"}`,
        prompt ? `Prompt: ${prompt}${prompt.length >= 80 ? "..." : ""}` : "",
        `Feedback: ${line || "(none)"}`,
        `Marks: max=${r.maxMarks ?? "-"} obtained=${r.obtainedMarks ?? "-"}`,
        `Scores: accuracy=${r.accuracyScore ?? "-"} language=${
          r.languageQualityScore ?? "-"
        } fluency=${r.fluencyPronunciationScore ?? "-"} delivery=${
          r.deliveryCoherenceScore ?? "-"
        } cultural=${r.culturalControlScore ?? "-"} response=${
          r.responseManagementScore ?? "-"
        } final=${r.finalScore ?? "-"}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
};

const calcProgressFromResults = (results) => {
  const total = results.length;
  const completed = results.filter((r) => r.status === "completed").length;
  const pending = total - completed;
  return {
    totalSegments: total,
    completedSegments: completed,
    pendingSegments: pending,
  };
};

export const startMockTest = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const userId = toInt(req.body.userId);
    const mockTestId = toInt(req.body.mockTestId);

    if (!userId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }
    if (!mockTestId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "mockTestId is required" });
    }

    const mockTest = await MockTest.findByPk(mockTestId, { transaction: t });
    if (!mockTest) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "MockTest not found" });
    }

    const d1 = toInt(mockTest.dialogueId ?? mockTest.dialogue_id);
    const d2 = toInt(mockTest.dialogueId2 ?? mockTest.dialogue_id_2);

    if (!d1 || !d2 || String(d1) === String(d2)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message:
          "MockTest must have 2 different dialogues (dialogueId and dialogueId2)",
      });
    }

    const dialogues = await Dialogue.findAll({
      where: { id: { [Op.in]: [d1, d2] } },
      transaction: t,
    });

    if (!dialogues || dialogues.length !== 2) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "One or both dialogues not found" });
    }

    const segments1 = await Segment.findAll({
      where: { dialogueId: d1 },
      order: [["segmentOrder", "ASC"]],
      transaction: t,
    });

    const segments2 = await Segment.findAll({
      where: { dialogueId: d2 },
      order: [["segmentOrder", "ASC"]],
      transaction: t,
    });

    if (!segments1.length || !segments2.length) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Segments missing: each dialogue must have segments",
      });
    }

    const totalMarks = Number(mockTest.totalMarks ?? 90);
    const passMarks = Number(mockTest.passMarks ?? 63);

    const session = await MockTestSession.create(
      {
        mockTestId: mockTest.id,
        userId,
        status: "in_progress",
        totalMarks: Number.isFinite(totalMarks) ? totalMarks : 90,
        passMarks: Number.isFinite(passMarks) ? passMarks : 63,
        totalScore: 0,
        passed: false,
      },
      { transaction: t }
    );

    const d1Marks = distributeMarks(45, segments1.length);
    const d2Marks = distributeMarks(45, segments2.length);

    const allRows = [
      ...segments1.map((s, idx) => ({
        mockTestSessionId: session.id,
        mockTestId: mockTest.id,
        userId,
        segmentId: s.id,
        status: "pending",
        maxMarks: d1Marks[idx],
        obtainedMarks: 0,
        repeatCount: 0,
      })),
      ...segments2.map((s, idx) => ({
        mockTestSessionId: session.id,
        mockTestId: mockTest.id,
        userId,
        segmentId: s.id,
        status: "pending",
        maxMarks: d2Marks[idx],
        obtainedMarks: 0,
        repeatCount: 0,
      })),
    ];

    await MockTestResult.bulkCreate(allRows, { transaction: t });

    const results = await MockTestResult.findAll({
      where: { mockTestSessionId: session.id },
      order: [["segmentId", "ASC"]],
      transaction: t,
    });

    await t.commit();

    return res.status(201).json({
      success: true,
      session,
      mockTest,
      dialogues,
      segments: [...segments1, ...segments2],
      results,
      progress: calcProgressFromResults(results),
      passRule: {
        total: { outOf: 90, passAtLeast: passMarks },
        perDialogue: { outOf: 45, passAtLeast: 31 },
      },
      durationSeconds: mockTest.durationSeconds ?? 1200,
    });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

export const getMockTestProgress = async (req, res, next) => {
  try {
    const mockTestSessionId = toInt(req.params.mockTestSessionId);
    const userId = toInt(req.query.userId ?? req.body?.userId);

    if (!mockTestSessionId) {
      return res
        .status(400)
        .json({ success: false, message: "mockTestSessionId is required" });
    }
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }

    const session = await MockTestSession.findByPk(mockTestSessionId);
    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: "MockTestSession not found" });
    }
    if (Number(session.userId) !== Number(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const results = await MockTestResult.findAll({
      where: { mockTestSessionId, userId },
      include: [
        {
          model: Segment,
          as: "segment",
          include: [{ model: Dialogue, as: "dialogue" }],
        },
      ],
      order: [
        [{ model: Segment, as: "segment" }, "dialogueId", "ASC"],
        [{ model: Segment, as: "segment" }, "segmentOrder", "ASC"],
      ],
    });

    const progress = calcProgressFromResults(results);

    const completedSegments = results.filter((r) => r.status === "completed");
    const pendingSegments = results.filter((r) => r.status !== "completed");
    const nextSegment = pendingSegments.length ? pendingSegments[0] : null;

    return res.json({
      success: true,
      session: {
        id: session.id,
        status: session.status,
        userId: session.userId,
        mockTestId: session.mockTestId,
        totalMarks: session.totalMarks,
        passMarks: session.passMarks,
        totalScore: session.totalScore,
        passed: session.passed,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      progress,
      completedSegments,
      pendingSegments,
      nextSegment,
    });
  } catch (e) {
    next(e);
  }
};

export const submitMockTestSegment = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const file = req.file;
    if (!file?.buffer) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "userAudio file is required" });
    }

    const userId = toInt(req.body.userId);
    const mockTestSessionId = toInt(req.body.mockTestSessionId);
    const segmentId = toInt(req.body.segmentId);
    const language = req.body.language ? String(req.body.language) : null;

    if (!userId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }
    if (!mockTestSessionId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "mockTestSessionId is required" });
    }
    if (!segmentId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "segmentId is required" });
    }

    const session = await MockTestSession.findByPk(mockTestSessionId, {
      transaction: t,
    });
    if (!session) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "MockTestSession not found" });
    }
    if (session.userId !== userId) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    if (session.status !== "in_progress") {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Session is not in_progress" });
    }

    const mockTest = await MockTest.findByPk(session.mockTestId, {
      transaction: t,
    });
    if (!mockTest) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "MockTest not found" });
    }

    const d1 = toInt(mockTest.dialogueId ?? mockTest.dialogue_id);
    const d2 = toInt(mockTest.dialogueId2 ?? mockTest.dialogue_id_2);

    const segment = await Segment.findByPk(segmentId, { transaction: t });
    if (!segment) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Segment not found" });
    }

    const segDialogueId = segment.dialogueId;
    const allowed =
      (d1 && segDialogueId === d1) || (d2 && segDialogueId === d2);
    if (!allowed) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "segmentId does not belong to mock test dialogues",
      });
    }

    const resultRow = await MockTestResult.findOne({
      where: { mockTestSessionId, userId, segmentId },
      transaction: t,
    });

    if (!resultRow) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message:
          "This segment was not initialized for this session. Start mock test again.",
      });
    }

    const referenceAudioUrl = req.body.audioUrl
      ? String(req.body.audioUrl)
      : segment.audioUrl || null;
    const suggestedAudioUrl = req.body.suggestedAudioUrl
      ? String(req.body.suggestedAudioUrl)
      : segment.suggestedAudioUrl || null;

    if (!referenceAudioUrl && !suggestedAudioUrl) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message:
          "No reference audio found (audioUrl/suggestedAudioUrl missing)",
      });
    }

    const prevMax = await MockTestAttempts.max("repeatCount", {
      where: { mockTestSessionId, userId, segmentId },
      transaction: t,
    });
    const repeatCount = Number(prevMax || 0) + 1;

    const uploaded = await uploadAudioToS3({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      keyPrefix: `users/${userId}/mock-tests/sessions/${mockTestSessionId}/segments/${segmentId}/attempt-${repeatCount}`,
    });
    const userAudioUrl = uploaded.url;

    const refAudio = referenceAudioUrl
      ? await fetchAudio(referenceAudioUrl)
      : null;
    const sugAudio = suggestedAudioUrl
      ? await fetchAudio(suggestedAudioUrl)
      : null;

    const referenceTranscript = refAudio
      ? await transcribeWithOpenAI({
          buffer: refAudio.buffer,
          mimetype: refAudio.mimetype,
          language,
        })
      : "";
    const suggestedTranscript = sugAudio
      ? await transcribeWithOpenAI({
          buffer: sugAudio.buffer,
          mimetype: sugAudio.mimetype,
          language,
        })
      : "";
    const studentTranscript = await transcribeWithOpenAI({
      buffer: file.buffer,
      mimetype: file.mimetype,
      language,
    });

    const combinedTranscript =
      `SEGMENT:\n` +
      `REFERENCE: ${referenceTranscript || "(empty)"}\n` +
      `SUGGESTED: ${suggestedTranscript || "(empty)"}\n` +
      `STUDENT: ${studentTranscript || "(empty)"}`;

    const scores = await scoreWithOpenAI({
      combinedTranscript,
      language,
      referenceText: segment.textContent || null,
    });

    const attempt = await MockTestAttempts.create(
      {
        mockTestSessionId,
        mockTestId: mockTest.id,
        userId,
        dialogueId: segDialogueId,
        segmentId,
        status: "scored",
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
        language,
        repeatCount,
      },
      { transaction: t }
    );

    const maxMarks = Number(resultRow.maxMarks ?? 0);
    const finalScore = clamp(scores.final_score, 0, 45);
    const obtainedMarks = round2((finalScore / 45) * maxMarks);

    await resultRow.update(
      {
        status: "completed",
        obtainedMarks,
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
        language,
        repeatCount,
      },
      { transaction: t }
    );

    const allResults = await MockTestResult.findAll({
      where: { mockTestSessionId, userId },
      transaction: t,
    });

    const progress = calcProgressFromResults(allResults);
    const pendingIds = allResults
      .filter((r) => r.status !== "completed")
      .map((r) => r.segmentId);

    await t.commit();

    return res.json({
      success: true,
      data: {
        attempt,
        result: resultRow,
        obtainedMarks,
        maxMarks,
        segmentId,
        mockTestSessionId,
        transcripts: {
          referenceTranscript,
          suggestedTranscript,
          studentTranscript,
          combinedTranscript,
        },
        scores,
        progress,
        nextSegmentId: pendingIds.length ? pendingIds[0] : null,
      },
    });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};

export const computeMockTestFinalResult = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const mockTestSessionId = toInt(req.params.mockTestSessionId);
    const userId = toInt(req.query.userId ?? req.body?.userId);

    if (!mockTestSessionId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "mockTestSessionId is required" });
    }
    if (!userId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }

    const session = await MockTestSession.findByPk(mockTestSessionId, {
      transaction: t,
    });
    if (!session) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "MockTestSession not found" });
    }
    if (Number(session.userId) !== Number(userId)) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const mockTest = await MockTest.findByPk(session.mockTestId, {
      transaction: t,
    });
    if (!mockTest) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "MockTest not found" });
    }

    const d1 = toInt(mockTest.dialogueId ?? mockTest.dialogue_id);
    const d2 = toInt(mockTest.dialogueId2 ?? mockTest.dialogue_id_2);

    if (!d1 || !d2) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "MockTest must have 2 dialogues" });
    }

    const results = await MockTestResult.findAll({
      where: { mockTestSessionId, userId },
      transaction: t,
    });

    const progress = calcProgressFromResults(results);
    if (progress.pendingSegments > 0) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Complete all segments before computing final result",
        progress,
        pendingSegmentIds: results
          .filter((r) => r.status !== "completed")
          .map((r) => r.segmentId),
      });
    }

    const segments = await Segment.findAll({
      where: { id: { [Op.in]: results.map((r) => r.segmentId) } },
      transaction: t,
    });
    const segMap = new Map(segments.map((s) => [String(s.id), s]));

    const dialogue1Score = round2(
      results
        .filter((r) => segMap.get(String(r.segmentId))?.dialogueId === d1)
        .reduce((sum, r) => sum + Number(r.obtainedMarks ?? 0), 0)
    );

    const dialogue2Score = round2(
      results
        .filter((r) => segMap.get(String(r.segmentId))?.dialogueId === d2)
        .reduce((sum, r) => sum + Number(r.obtainedMarks ?? 0), 0)
    );

    const totalScore = round2(dialogue1Score + dialogue2Score);
    const passMarks = Number(session.passMarks ?? 63);
    const perDialoguePass = 31;

    const passed =
      totalScore >= passMarks &&
      dialogue1Score >= perDialoguePass &&
      dialogue2Score >= perDialoguePass;

    const averages = {
      accuracyScore: avgOfField(results, "accuracyScore"),
      languageQualityScore: avgOfField(results, "languageQualityScore"),
      fluencyPronunciationScore: avgOfField(
        results,
        "fluencyPronunciationScore"
      ),
      deliveryCoherenceScore: avgOfField(results, "deliveryCoherenceScore"),
      culturalControlScore: avgOfField(results, "culturalControlScore"),
      responseManagementScore: avgOfField(results, "responseManagementScore"),
      finalScore: avgOfField(results, "finalScore"),
      totalRawScore: avgOfField(results, "totalRawScore"),
    };

    let notes = buildNotesFromResults(results, segMap);
    const MAX_CHARS = 12000;
    if (notes.length > MAX_CHARS)
      notes = notes.slice(0, MAX_CHARS) + "\n...(truncated)";

    const overallFeedback = await generateOverallFeedback({ averages, notes });

    session.totalScore = totalScore;
    session.passed = passed;
    session.status = "completed";
    session.completedAt = new Date();
    await session.save({ transaction: t });

    const payload = {
      mockTestSessionId: session.id,
      mockTestId: mockTest.id,
      userId,
      totalScore,
      dialogue1Score,
      dialogue2Score,
      outOf: 90,
      passMarks,
      perDialogueOutOf: 45,
      perDialoguePass,
      passed,
      averages,
      overallFeedback,
      computedAt: new Date(),
    };

    const existing = await MockTestFinalResult.findOne({
      where: { mockTestSessionId: session.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let savedFinalResult;
    if (existing) {
      savedFinalResult = await existing.update(payload, { transaction: t });
    } else {
      savedFinalResult = await MockTestFinalResult.create(payload, {
        transaction: t,
      });
    }

    await t.commit();

    return res.json({
      success: true,
      session,
      finalResult: savedFinalResult,
      summary: {
        totalScore,
        outOf: 90,
        passMarks,
        perDialogue: {
          outOf: 45,
          passAtLeast: perDialoguePass,
          dialogue1Score,
          dialogue2Score,
        },
        passed,
        averages,
        overallFeedback,
      },
      results,
    });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};
