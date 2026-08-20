/**
 * Transcription Comparison Controller
 *
 * Fetches 10 user recordings for a given LOTE language (default: punjabi)
 * and runs 3 transcription services IN PARALLEL for each audio:
 *   1. Azure Speech STT  (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION)
 *   2. OpenAI Whisper    (OPENAI_API_KEY)
 *   3. ElevenLabs Scribe (ELEVENLABS_API_KEY)
 *
 * Audio is fetched directly from AWS S3 using the SDK (works for private buckets).
 * Returns a best-model summary based on success rate + output completeness.
 *
 * GET /api/v1/transcription-comparison?language=hindi&limit=10
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { models } from "../models/index.js";
import { Op } from "sequelize";

// ─── Language config ─────────────────────────────────────────────────────────

const LANGUAGE_CONFIG = {
  punjabi: {
    dbNames: ["punjabi"],
    dbCodes: ["pa", "pa-IN"],
    azureLocale: "pa-IN",
    whisperLang: "pa",
    elevenlabsLang: "pa",
    label: "Punjabi (ਪੰਜਾਬੀ)",
  },
  hindi: {
    dbNames: ["hindi"],
    dbCodes: ["hi", "hi-IN"],
    azureLocale: "hi-IN",
    whisperLang: "hi",
    elevenlabsLang: "hi",
    label: "Hindi (हिन्दी)",
  },
};

// ─── AWS S3 client (fetch audio buffer directly) ─────────────────────────────

const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-2" });

const extractS3Key = (url) => {
  try {
    const u = new URL(url);
    // https://bucket.s3.region.amazonaws.com/key  OR  https://s3.region.amazonaws.com/bucket/key
    const host = u.hostname;
    if (host.endsWith(".amazonaws.com")) {
      const path = u.pathname.replace(/^\//, "");
      // path-style: /bucket/key  vs virtual-hosted: /key
      if (host.startsWith("s3")) {
        // path-style: first segment is bucket
        const parts = path.split("/");
        return { bucket: parts[0], key: parts.slice(1).join("/") };
      }
      // virtual-hosted style: bucket is subdomain
      const bucket = host.split(".")[0];
      return { bucket, key: path };
    }
  } catch (_) {}
  return null;
};

const fetchAudioFromS3 = async (audioUrl) => {
  const parsed = extractS3Key(audioUrl);
  const bucket = parsed?.bucket || process.env.AWS_S3_BUCKET_NAME;
  const key = parsed?.key;

  if (!key) {
    // Fall back to HTTP fetch for non-S3 URLs
    const resp = await fetch(audioUrl);
    if (!resp.ok) throw new Error(`HTTP fetch failed: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const result = await s3.send(cmd);
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

// ─── Azure Speech STT ─────────────────────────────────────────────────────────

const azureTranscribe = async ({ audioBuffer, mimetype, locale }) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const endpoint = process.env.AZURE_SPEECH_ENDPOINT;

  if (!key || (!region && !endpoint)) {
    return { text: "", error: "AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured" };
  }

  const base = endpoint
    ? endpoint.replace(/\/+$/, "")
    : `https://${region}.api.cognitive.microsoft.com`;

  const apiVersion = process.env.AZURE_SPEECH_API_VERSION || "2025-10-15";
  const url = `${base}/speechtotext/transcriptions:transcribe?api-version=${encodeURIComponent(apiVersion)}`;

  const definition = { locales: [locale] };
  const ext =
    mimetype === "audio/wav" ? ".wav"
    : mimetype === "audio/mpeg" ? ".mp3"
    : mimetype === "audio/mp4" ? ".mp4"
    : mimetype === "audio/ogg" ? ".ogg"
    : mimetype === "audio/aac" ? ".aac"
    : mimetype === "audio/flac" ? ".flac"
    : ".webm";

  const form = new FormData();
  form.append("audio", new Blob([audioBuffer], { type: mimetype || "application/octet-stream" }), `audio${ext}`);
  form.append("definition", JSON.stringify(definition));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      return { text: "", error: `Azure ${res.status}: ${err.substring(0, 200)}` };
    }
    const json = await res.json();
    const fullText =
      (Array.isArray(json?.combinedPhrases) && json.combinedPhrases[0]?.text) ||
      json?.combinedPhrases?.text || "";

    const phrases = Array.isArray(json?.phrases) ? json.phrases : [];
    const confs = phrases.map((p) => p?.confidence).filter((v) => typeof v === "number");
    const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

    return { text: String(fullText).trim(), confidence: avgConfidence };
  } catch (err) {
    return { text: "", error: err.message };
  }
};

// ─── OpenAI Whisper ───────────────────────────────────────────────────────────

const whisperTranscribe = async ({ audioBuffer, whisperLang }) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: "", error: "OPENAI_API_KEY not configured" };
  if (!audioBuffer?.length) return { text: "", error: "No audio data" };

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav");
  form.append("model", "whisper-1");
  form.append("language", whisperLang);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      // Retry without language hint
      const form2 = new FormData();
      form2.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav");
      form2.append("model", "whisper-1");
      const res2 = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form2,
      });
      if (res2.ok) {
        const j2 = await res2.json();
        return { text: j2.text || "", note: "auto-detect (lang hint failed)" };
      }
      const err = await res.text();
      return { text: "", error: `Whisper ${res.status}: ${err.substring(0, 200)}` };
    }
    const json = await res.json();
    return { text: json.text || "" };
  } catch (err) {
    return { text: "", error: err.message };
  }
};

// ─── ElevenLabs Scribe ────────────────────────────────────────────────────────

const elevenlabsTranscribe = async ({ audioBuffer, elevenlabsLang }) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { text: "", error: "ELEVENLABS_API_KEY not configured" };
  if (!audioBuffer?.length) return { text: "", error: "No audio data" };

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav");
  form.append("model_id", "scribe_v1");
  form.append("language_code", elevenlabsLang);

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      return { text: "", error: `ElevenLabs ${res.status}: ${err.substring(0, 200)}` };
    }
    const json = await res.json();
    return { text: json.text || "", detectedLanguage: json.language_code || null };
  } catch (err) {
    return { text: "", error: err.message };
  }
};

// ─── Best-model scoring ───────────────────────────────────────────────────────

const scoreBestModel = (results) => {
  const scores = { azure: 0, whisper: 0, elevenlabs: 0 };
  const stats = {
    azure:       { successes: 0, totalChars: 0, errors: 0 },
    whisper:     { successes: 0, totalChars: 0, errors: 0 },
    elevenlabs:  { successes: 0, totalChars: 0, errors: 0 },
  };

  for (const item of results) {
    for (const [key, stat] of Object.entries(stats)) {
      const t = item.transcriptions[key];
      if (t?.error) {
        stat.errors++;
      } else if (t?.text?.trim().length > 0) {
        stat.successes++;
        stat.totalChars += t.text.trim().length;
        // +2 points for successful transcription
        scores[key] += 2;
        // +1 bonus if confidence is high (Azure only)
        if (key === "azure" && t.confidence != null && t.confidence > 0.8) scores[key] += 1;
      }
    }
  }

  // Normalize char count bonus (up to +1 per item relative to others)
  for (const item of results) {
    const lengths = {
      azure:      item.transcriptions.azure?.text?.trim().length || 0,
      whisper:    item.transcriptions.whisper?.text?.trim().length || 0,
      elevenlabs: item.transcriptions.elevenlabs?.text?.trim().length || 0,
    };
    const maxLen = Math.max(...Object.values(lengths));
    if (maxLen > 0) {
      for (const [key, len] of Object.entries(lengths)) {
        scores[key] += len / maxLen; // fractional bonus
      }
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const winner = sorted[0][0];

  return {
    winner,
    scores: Object.fromEntries(
      sorted.map(([k, v]) => [k, { score: Math.round(v * 10) / 10, ...stats[k] }])
    ),
    summary: `Best model: ${
      winner === "azure" ? "Azure Speech STT"
      : winner === "whisper" ? "OpenAI Whisper"
      : "ElevenLabs Scribe"
    } (${stats[winner].successes}/${results.length} successful, avg ${
      stats[winner].successes > 0
        ? Math.round(stats[winner].totalChars / stats[winner].successes)
        : 0
    } chars/transcript)`,
  };
};

// ─── Main endpoint ────────────────────────────────────────────────────────────

export const getTranscriptionComparison = async (req, res, next) => {
  try {
    const langKey = (req.query.language || "punjabi").toLowerCase();
    const limit   = Math.min(Number(req.query.limit) || 10, 20);
    const config  = LANGUAGE_CONFIG[langKey] || LANGUAGE_CONFIG.punjabi;

    console.log(`[transcription-comparison] language=${langKey} limit=${limit}`);

    // Query segment attempts with audio from the target language dialogues
    const attempts = await models.SegmentAttempt.findAll({
      where: { audioUrl: { [Op.not]: null, [Op.ne]: "" } },
      include: [
        {
          model: models.Segment,
          as: "segment",
          required: true,
          include: [
            {
              model: models.Dialogue,
              as: "dialogue",
              required: true,
              include: [
                {
                  model: models.Language,
                  required: true,
                  where: {
                    [Op.or]: [
                      ...config.dbNames.map((n) => ({ name: { [Op.like]: `%${n}%` } })),
                      ...config.dbCodes.map((c) => ({ langCode: c })),
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
    });

    if (attempts.length === 0) {
      return res.json({
        success: true,
        message: `No ${config.label} segment attempts with audio found`,
        data: [],
        bestModel: null,
      });
    }

    console.log(`[transcription-comparison] Found ${attempts.length} ${langKey} recordings — fetching from S3 & transcribing...`);

    // Fetch all audio buffers from S3 first
    const audioBuffers = await Promise.all(
      attempts.map(async (attempt) => {
        try {
          const buf = await fetchAudioFromS3(attempt.audioUrl);
          const ext = attempt.audioUrl.split("?")[0].split(".").pop()?.toLowerCase() || "wav";
          const mimetype =
            ext === "mp3" ? "audio/mpeg"
            : ext === "mp4" ? "audio/mp4"
            : ext === "ogg" ? "audio/ogg"
            : ext === "aac" ? "audio/aac"
            : ext === "flac" ? "audio/flac"
            : ext === "webm" ? "audio/webm"
            : "audio/wav";
          return { buffer: buf, mimetype };
        } catch (err) {
          console.error(`[transcription-comparison] S3 fetch failed for ${attempt.audioUrl}: ${err.message}`);
          return { buffer: null, mimetype: "audio/wav", fetchError: err.message };
        }
      })
    );

    // Run all 3 transcriptions in parallel for every audio simultaneously
    const results = await Promise.all(
      attempts.map(async (attempt, idx) => {
        const { buffer, mimetype, fetchError } = audioBuffers[idx];
        const segment  = attempt.segment;
        const dialogue = segment?.dialogue;
        const language = dialogue?.Language;

        if (!buffer) {
          const errResult = { text: "", error: fetchError || "S3 fetch failed" };
          return {
            attemptId: attempt.id,
            segmentId: attempt.segmentId,
            dialogueTitle: dialogue?.title || null,
            language: language?.name || config.label,
            langCode: language?.langCode || config.dbCodes[0],
            audioUrl: attempt.audioUrl,
            referenceText: attempt.referenceTranscript || segment?.textContent || null,
            transcriptions: {
              azure: errResult,
              whisper: errResult,
              elevenlabs: errResult,
            },
          };
        }

        console.log(`[transcription-comparison] [${idx + 1}/${attempts.length}] Transcribing ${(buffer.length / 1024).toFixed(0)}KB...`);

        const [azureResult, whisperResult, elevenlabsResult] = await Promise.all([
          azureTranscribe({ audioBuffer: buffer, mimetype, locale: config.azureLocale }),
          whisperTranscribe({ audioBuffer: buffer, whisperLang: config.whisperLang }),
          elevenlabsTranscribe({ audioBuffer: buffer, elevenlabsLang: config.elevenlabsLang }),
        ]);

        return {
          attemptId: attempt.id,
          segmentId: attempt.segmentId,
          dialogueTitle: dialogue?.title || null,
          language: language?.name || config.label,
          langCode: language?.langCode || config.dbCodes[0],
          audioUrl: attempt.audioUrl,
          referenceText: attempt.referenceTranscript || segment?.textContent || null,
          transcriptions: {
            azure:      { label: "Azure Speech STT",   ...azureResult },
            whisper:    { label: "OpenAI Whisper",      ...whisperResult },
            elevenlabs: { label: "ElevenLabs Scribe",   ...elevenlabsResult },
          },
        };
      })
    );

    const bestModel = scoreBestModel(results);
    console.log(`[transcription-comparison] Done. ${bestModel.summary}`);

    return res.json({
      success: true,
      total: results.length,
      language: config.label,
      langKey,
      description: `3-model STT comparison on ${config.label} NAATI dialogue recordings`,
      services: [
        `Azure Speech STT (${config.azureLocale})`,
        `OpenAI Whisper (${config.whisperLang})`,
        `ElevenLabs Scribe (${config.elevenlabsLang})`,
      ],
      bestModel,
      data: results,
    });
  } catch (err) {
    next(err);
  }
};
