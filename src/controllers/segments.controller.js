import { models } from "../models/index.js";
import { uploadAudioToS3 } from "../utils/aws.js";

function toInt(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/* ─── Language-name → Google-Translate code mapping ─── */
const LANG_NAME_TO_GOOGLE_CODE = {
  hindi: "hi", punjabi: "pa", nepali: "ne", mandarin: "zh-CN", chinese: "zh-CN",
  cantonese: "zh-TW", spanish: "es", english: "en", urdu: "ur", tamil: "ta",
  telugu: "te", bengali: "bn", bangla: "bn", gujarati: "gu", kannada: "kn",
  malayalam: "ml", marathi: "mr", arabic: "ar", persian: "fa", farsi: "fa",
  turkish: "tr", korean: "ko", japanese: "ja", vietnamese: "vi", thai: "th",
  indonesian: "id", malay: "ms", russian: "ru", french: "fr", german: "de",
  italian: "it", portuguese: "pt", dutch: "nl", greek: "el", polish: "pl",
  czech: "cs", romanian: "ro", hungarian: "hu", swedish: "sv", danish: "da",
  finnish: "fi", norwegian: "no", ukrainian: "uk", serbian: "sr", croatian: "hr",
  bosnian: "bs", bulgarian: "bg", filipino: "tl", tagalog: "tl",
  sinhalese: "si", sinhala: "si", khmer: "km", burmese: "my", lao: "lo", swahili: "sw",
};

function toLangCode(nameOrCode) {
  const s = String(nameOrCode || "").trim().toLowerCase();
  if (!s) return null;
  if (/^[a-z]{2}(-[a-z]{2,})?$/i.test(s)) return s;
  return LANG_NAME_TO_GOOGLE_CODE[s] || null;
}

/* ─── Google Translate v2 helper ─── */
async function googleTranslate(text, targetLang, sourceLang = null) {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_TRANSLATE_API_KEY is not configured");

  const body = { q: text, target: targetLang, format: "text" };
  if (sourceLang) body.source = sourceLang;

  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Translate error (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const translated = json?.data?.translations?.[0]?.translatedText;
  const detectedSource = json?.data?.translations?.[0]?.detectedSourceLanguage || sourceLang;
  if (!translated) throw new Error("No translation returned from Google");

  return { translatedText: translated, detectedSource };
}

/* ─── Translate endpoint ─── */
export async function translateSegment(req, res, next) {
  try {
    const { text, targetLanguage, sourceLanguage, segmentId, dialogueId } = req.body;

    // Resolve the text to translate — either explicit or from a segment
    let inputText = text;
    if (!inputText && segmentId) {
      const seg = await models.Segment.findByPk(segmentId);
      if (!seg) return res.status(404).json({ success: false, message: "Segment not found" });
      inputText = seg.textContent;
    }
    if (!inputText) return res.status(400).json({ success: false, message: "text or segmentId is required" });

    // Resolve LOTE language — from param, or from dialogueId → Language.langCode
    let loteCode = toLangCode(targetLanguage);
    if (!loteCode && dialogueId) {
      const dlg = await models.Dialogue.findByPk(dialogueId, {
        include: [{ model: models.Language, as: "Language" }],
      });
      if (dlg?.Language) loteCode = toLangCode(dlg.Language.langCode) || toLangCode(dlg.Language.name);
    }
    if (!loteCode) return res.status(400).json({ success: false, message: "Could not determine target language" });

    const source = toLangCode(sourceLanguage) || null; // auto-detect if not provided

    // Bidirectional: first translate to LOTE, then check if source was already LOTE
    const result = await googleTranslate(inputText, loteCode, source);
    const detectedBase = (result.detectedSource || "").toLowerCase().split("-")[0];
    const loteBase = loteCode.toLowerCase().split("-")[0];

    // If the detected source language matches the LOTE target, the text is already
    // in LOTE — translate to English instead
    if (detectedBase === loteBase) {
      const enResult = await googleTranslate(inputText, "en", loteCode);
      return res.json({
        success: true,
        data: {
          originalText: inputText,
          translatedText: enResult.translatedText,
          sourceLang: loteCode,
          targetLang: "en",
        },
      });
    }

    return res.json({
      success: true,
      data: {
        originalText: inputText,
        translatedText: result.translatedText,
        sourceLang: result.detectedSource,
        targetLang: loteCode,
      },
    });
  } catch (e) {
    console.error("Translate error:", e.message);
    return next(e);
  }
}

export async function createSegment(req, res, next) {
  try {
    const {
      dialogueId,
      textContent,
      audioUrl,
      suggestedAudioUrl,
      segmentOrder,
      translation,
    } = req.body;

    const dialogueIdNum = toInt(dialogueId);
    const segmentOrderNum = toInt(segmentOrder);
    console.log(req.body);
    if (!dialogueIdNum || !textContent || segmentOrderNum === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const dialogue = await models.Dialogue.findByPk(dialogueIdNum);
    if (!dialogue)
      return res
        .status(400)
        .json({ success: false, message: "Invalid dialogueId" });

    const audioFile = req.files?.audioUrl?.[0];
    const suggestedFile = req.files?.suggestedAudioUrl?.[0];

    let finalAudioUrl = audioUrl || null;
    let finalSuggestedAudioUrl = suggestedAudioUrl || null;

    if (audioFile) {
      const up = await uploadAudioToS3({
        buffer: audioFile.buffer,
        mimetype: audioFile.mimetype,
        originalname: audioFile.originalname,
        keyPrefix: `dialogues/${dialogueIdNum}/segments/audio`,
      });
      finalAudioUrl = up.url;
    }

    if (suggestedFile) {
      const up = await uploadAudioToS3({
        buffer: suggestedFile.buffer,
        mimetype: suggestedFile.mimetype,
        originalname: suggestedFile.originalname,
        keyPrefix: `dialogues/${dialogueIdNum}/segments/suggested`,
      });
      finalSuggestedAudioUrl = up.url;
    }

    const segment = await models.Segment.create({
      dialogueId: dialogueIdNum,
      textContent,
      audioUrl: finalAudioUrl,
      suggestedAudioUrl: finalSuggestedAudioUrl,
      segmentOrder: segmentOrderNum,
      translation: translation || null,
    });

    return res.status(201).json({ success: true, data: { segment } });
  } catch (e) {
    console.log(e);
    return next(e);
  }
}

export async function listSegments(req, res, next) {
  try {
    const where = {};
    if (req.query.dialogueId) where.dialogueId = Number(req.query.dialogueId);

    const segments = await models.Segment.findAll({
      where,
      order: [["segmentOrder", "ASC"]],
    });

    return res.json({ success: true, data: { segments } });
  } catch (e) {
    return next(e);
  }
}

export async function getSegment(req, res, next) {
  try {
    const segment = await models.Segment.findByPk(req.params.id);
    if (!segment)
      return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: { segment } });
  } catch (e) {
    return next(e);
  }
}

export async function updateSegment(req, res, next) {
  try {
    const segment = await models.Segment.findByPk(req.params.id);
    if (!segment)
      return res.status(404).json({ success: false, message: "Not found" });

    const { textContent, audioUrl, suggestedAudioUrl, segmentOrder, translation } = req.body;

    const audioFile = req.files?.audio?.[0];
    const suggestedFile = req.files?.suggestedAudio?.[0];

    if (textContent !== undefined) segment.textContent = textContent;
    if (translation !== undefined) segment.translation = translation || null;

    const segmentOrderNum = toInt(segmentOrder);
    if (segmentOrder !== undefined) {
      if (segmentOrderNum === undefined)
        return res
          .status(400)
          .json({ success: false, message: "Invalid segmentOrder" });
      segment.segmentOrder = segmentOrderNum;
    }

    if (audioFile) {
      const up = await uploadAudioToS3({
        buffer: audioFile.buffer,
        mimetype: audioFile.mimetype,
        originalname: audioFile.originalname,
        keyPrefix: `dialogues/${segment.dialogueId}/segments/audio`,
      });
      segment.audioUrl = up.url;
    } else if (audioUrl !== undefined) {
      segment.audioUrl = audioUrl || null;
    }

    if (suggestedFile) {
      const up = await uploadAudioToS3({
        buffer: suggestedFile.buffer,
        mimetype: suggestedFile.mimetype,
        originalname: suggestedFile.originalname,
        keyPrefix: `dialogues/${segment.dialogueId}/segments/suggested`,
      });
      segment.suggestedAudioUrl = up.url;
    } else if (suggestedAudioUrl !== undefined) {
      segment.suggestedAudioUrl = suggestedAudioUrl || null;
    }

    await segment.save();
    return res.json({ success: true, data: { segment } });
  } catch (e) {
    return next(e);
  }
}

export async function deleteSegment(req, res, next) {
  try {
    const segment = await models.Segment.findByPk(req.params.id);
    if (!segment)
      return res.status(404).json({ success: false, message: "Not found" });
    await segment.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (e) {
    return next(e);
  }
}
