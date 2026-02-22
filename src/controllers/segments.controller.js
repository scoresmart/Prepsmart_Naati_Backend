import { models } from "../models/index.js";
import { uploadAudioToS3 } from "../utils/aws.js";

function toInt(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function createSegment(req, res, next) {
  try {
    const {
      dialogueId,
      textContent,
      audioUrl,
      suggestedAudioUrl,
      segmentOrder,
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

    const { textContent, audioUrl, suggestedAudioUrl, segmentOrder } = req.body;

    const audioFile = req.files?.audio?.[0];
    const suggestedFile = req.files?.suggestedAudio?.[0];

    if (textContent !== undefined) segment.textContent = textContent;

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
