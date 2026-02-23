import { models } from "../models/index.js";
import OpenAI from "openai";
import { Op } from "sequelize";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
import { sequelize } from "../config/db.js";
const { ExamAttempt, Dialogue, Segment, SegmentAttempt } = models;

const ensureOwnerOrAdmin = (req, ownerId) => {
  if (req.user?.role === "admin") return;
  if (!req.user?.id || req.user.id !== ownerId) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
};

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const createExam = async (req, res, next) => {
  try {
    return res.status(501).json({ message: "Not implemented" });
  } catch (e) {
    next(e);
  }
};



export const listUserExams = async (req, res, next) => {
  try {
    const where = {};

    if (req.user?.role === "admin") {
      const userIdNum = toInt(req.query.userId);
      if (userIdNum) where.userId = userIdNum;
    } else {
      where.userId = req.user.id;
    }

    const dialogueIdNum = toInt(req.query.dialogueId);
    if (dialogueIdNum) where.dialogueId = dialogueIdNum;

    if (req.query.status) where.status = req.query.status;

    const attempts = await ExamAttempt.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return res.json({ attempts });
  } catch (e) {
    next(e);
  }
};

export const getExam = async (req, res, next) => {
  try {
    const examAttemptId = toInt(req.params.id);
    if (!examAttemptId)
      return res.status(400).json({ message: "Invalid exam id" });

    const attempt = await ExamAttempt.findByPk(examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    const dialogue = await Dialogue.findByPk(attempt.dialogueId);
    const segments = await Segment.findAll({
      where: { dialogueId: attempt.dialogueId },
      order: [["segmentOrder", "ASC"]],
    });

    const segmentAttempts = await SegmentAttempt.findAll({
      where: { examAttemptId: attempt.id },
      order: [["createdAt", "ASC"]],
    });

    return res.json({ attempt, dialogue, segments, segmentAttempts });
  } catch (e) {
    next(e);
  }
};

export const deleteExam = async (req, res, next) => {
  try {
    const examAttemptId = toInt(req.params.id);
    if (!examAttemptId)
      return res.status(400).json({ message: "Invalid exam id" });

    const attempt = await ExamAttempt.findByPk(examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    const sequelize = ExamAttempt.sequelize;

    await sequelize.transaction(async (t) => {
      await SegmentAttempt.destroy({
        where: { examAttemptId },
        transaction: t,
      });
      await attempt.destroy({ transaction: t });
    });

    return res.json({ success: true, message: "Deleted" });
  } catch (e) {
    next(e);
  }
};

const toNumberOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const avgOfField = (segments, field) => {
  let sum = 0;
  let count = 0;

  for (const seg of segments) {
    const s = typeof seg.get === "function" ? seg.get() : seg;
    const val = toNumberOrNull(s[field]);
    if (val !== null) {
      sum += val;
      count++;
    }
  }

  return count ? Number((sum / count).toFixed(2)) : null;
};

const buildFeedbackNotes = (segments) => {
  return segments
    .map((seg, i) => {
      const s = typeof seg.get === "function" ? seg.get() : seg;

      const texts = [
        s.accuracyText && `Accuracy: ${s.accuracyText}`,
        s.languageQualityText && `Language: ${s.languageQualityText}`,
        s.fluencyPronunciationText && `Fluency: ${s.fluencyPronunciationText}`,
        s.deliveryCoherenceText && `Delivery: ${s.deliveryCoherenceText}`,
        s.culturalControlText && `Culture: ${s.culturalControlText}`,
        s.responseManagementText &&
          `Response mgmt: ${s.responseManagementText}`,
        s.oneLineFeedback && `One-line: ${s.oneLineFeedback}`,
      ].filter(Boolean);

      return texts.length ? `Segment ${i + 1}: ${texts.join(" | ")}` : null;
    })
    .filter(Boolean)
    .join("\n");
};

export const computeResult = async (req, res, next) => {
  try {
    const examAttemptId = toInt(req.params.examAttemptId);
    if (!examAttemptId)
      return res
        .status(400)
        .json({ success: false, message: "examAttemptId is required" });

    const attempt = await ExamAttempt.findByPk(examAttemptId);
    if (!attempt)
      return res
        .status(404)
        .json({ success: false, message: "ExamAttempt not found" });

    let segmentAttempts = await SegmentAttempt.findAll({
      where: { examAttemptId: examAttemptId },
      order: [["createdAt", "ASC"]],
    });

    // If this attempt has no segments, try to find the latest attempt
    // for the same user+dialogue that HAS submitted segments (fallback)
    let usedAttempt = attempt;
    if (!segmentAttempts.length) {
      // Find the latest segment_attempt for this user+dialogue regardless of exam attempt
      const latestSA = await SegmentAttempt.findOne({
        where: { userId: attempt.userId },
        order: [["id", "DESC"]],
        attributes: ["examAttemptId"],
      });

      if (latestSA && latestSA.examAttemptId !== attempt.id) {
        // Verify this exam attempt belongs to the same dialogue
        const fallback = await ExamAttempt.findOne({
          where: {
            id: latestSA.examAttemptId,
            userId: attempt.userId,
            dialogueId: attempt.dialogueId,
          },
        });

        if (fallback) {
          const fallbackSegments = await SegmentAttempt.findAll({
            where: { examAttemptId: fallback.id },
            order: [["createdAt", "ASC"]],
          });
          if (fallbackSegments.length) {
            segmentAttempts = fallbackSegments;
            usedAttempt = fallback;
            console.log(`[computeResult] Falling back from attempt ${attempt.id} (0 segments) to ${fallback.id} (${fallbackSegments.length} segments)`);
          }
        }
      }
    }

    // Enrich each SegmentAttempt with original Segment data
    const segmentIds = segmentAttempts.map(sa => sa.segmentId).filter(Boolean);
    const originalSegments = segmentIds.length
      ? await Segment.findAll({ where: { id: { [Op.in]: segmentIds } } })
      : [];
    const segmentMap = new Map(originalSegments.map(s => [Number(s.id), s]));

    const segments = segmentAttempts.map(sa => {
      const plain = typeof sa.get === "function" ? sa.get({ plain: true }) : sa;
      const origSeg = segmentMap.get(Number(sa.segmentId));
      if (origSeg) {
        plain.questionAudioUrl = plain.questionAudioUrl || origSeg.audioUrl || null;
        plain.suggestedAudioUrl = plain.suggestedAudioUrl || origSeg.suggestedAudioUrl || null;
        plain.questionTranscript = plain.questionTranscript || origSeg.textContent || null;
      }
      return plain;
    });

    const averages = {
      accuracyScore: avgOfField(segments, "accuracyScore"),
      languageQualityScore: avgOfField(segments, "languageQualityScore"),
      fluencyPronunciationScore: avgOfField(
        segments,
        "fluencyPronunciationScore"
      ),
      deliveryCoherenceScore: avgOfField(segments, "deliveryCoherenceScore"),
      culturalControlScore: avgOfField(segments, "culturalControlScore"),
      responseManagementScore: avgOfField(segments, "responseManagementScore"),
      finalScore: avgOfField(segments, "finalScore"),
      totalRawScore: avgOfField(segments, "totalRawScore"),
    };

    if (!segments.length) {
      await attempt.update({
        accuracyScore: null,
        languageQualityScore: null,
        fluencyPronunciationScore: null,
        deliveryCoherenceScore: null,
        culturalControlScore: null,
        responseManagementScore: null,
        finalScore: null,
        totalRawScore: null,
        overallFeedback: null,
        computedAt: new Date(),
        segmentCount: 0,
      });

      return res.json({
        success: true,
        summary: { segmentCount: 0, averages, overallFeedback: null },
        segments,
      });
    }

    let overallFeedback = null;
    try {
      let notes = buildFeedbackNotes(segments);
      const MAX_CHARS = 12000;
      if (notes.length > MAX_CHARS)
        notes = notes.slice(0, MAX_CHARS) + "\n...(truncated)";

      const prompt = [
        `Averages (0–?? scale depending on your rubric): ${JSON.stringify(
          averages
        )}`,
        `Per-segment feedback notes:`,
        notes,
      ].join("\n\n");

      const feedbackModel = process.env.OPENAI_SCORE_MODEL || "gpt-4o-mini";
      const ai = await openai.responses.create({
        model: feedbackModel,
        instructions:
          "You are an English speaking exam evaluator. Read the per-segment feedback notes and averages, then write overall feedback in 5 to 7 short lines. Mention patterns across segments, 2 strengths, 2 improvement areas, and 1 specific actionable next step. Do not repeat the notes verbatim. No headings.",
        input: prompt,
      });

      overallFeedback = (ai.output_text || "").trim() || null;
    } catch (feedbackErr) {
      console.error("Failed to generate overall feedback:", feedbackErr.message);
    }

    const updated = await usedAttempt.update({
      accuracyScore: averages.accuracyScore,
      languageQualityScore: averages.languageQualityScore,
      fluencyPronunciationScore: averages.fluencyPronunciationScore,
      deliveryCoherenceScore: averages.deliveryCoherenceScore,
      culturalControlScore: averages.culturalControlScore,
      responseManagementScore: averages.responseManagementScore,
      finalScore: averages.finalScore,
      totalRawScore: averages.totalRawScore,
      overallFeedback,
      computedAt: new Date(),
      segmentCount: segments.length,
      status: "completed",
    });
    // console.log("updated", updated);
    return res.json({
      success: true,
      summary: {
        segmentCount: segments.length,
        averages,
        overallFeedback,
      },
      segments,
    });
  } catch (e) {
    next(e);
  }
};

export const getExamAttemptDetails = async (req, res, next) => {
  try {
    const examAttemptId = toInt(
      req.params.examAttemptId ?? req.query.examAttemptId
    );
    if (!examAttemptId)
      return res
        .status(400)
        .json({ success: false, message: "examAttemptId is required" });

    const attempt = await ExamAttempt.findByPk(examAttemptId);
    if (!attempt)
      return res
        .status(404)
        .json({ success: false, message: "ExamAttempt not found" });

    const dialogue = await Dialogue.findByPk(attempt.dialogueId);
    if (!dialogue)
      return res
        .status(404)
        .json({ success: false, message: "Dialogue not found" });

    const segments = await Segment.findAll({
      where: { dialogueId: attempt.dialogueId },
      order: [["segmentOrder", "ASC"]],
    });

    const segmentIds = segments
      .map((s) => Number(s.id))
      .filter((x) => Number.isFinite(x));

    const doneRows = segmentIds.length
      ? await SegmentAttempt.findAll({
          where: {
            userId: attempt.userId,
            examAttemptId: attempt.id,
            segmentId: { [Op.in]: segmentIds },
          },
          attributes: ["segmentId"],
          group: ["segmentId"],
          raw: true,
        })
      : [];

    const doneSet = new Set(doneRows.map((r) => String(r.segmentId)));

    const segmentsWithStatus = segments.map((s) => ({
      ...s.toJSON(),
      isDone: doneSet.has(String(s.id)),
    }));

    return res.json({
      success: true,
      attempt,
      dialogue,
      segments: segmentsWithStatus,
    });
  } catch (e) {
    next(e);
  }
};
export const startExam = async (req, res, next) => {
  try {
    const examType = req.body.examType;
    const dialogueIdNum = toInt(req.body.dialogueId);
    const userId = toInt(req.body.userId ?? req.query.userId);

    const forceNew =
      String(req.query.new ?? req.query.isNew ?? "false").toLowerCase() === "true" ||
      String(req.query.new ?? req.query.isNew ?? "0") === "1";

    if (!userId) return res.status(400).json({ message: "userId is required" });

    if (!examType || !["rapid_review", "complete_dialogue"].includes(examType)) {
      return res.status(400).json({ message: "Invalid examType" });
    }

    if (!dialogueIdNum) return res.status(400).json({ message: "dialogueId is required" });

    const dialogue = await Dialogue.findByPk(dialogueIdNum);
    if (!dialogue) return res.status(404).json({ message: "Dialogue not found" });

    let attempt = null;

    if (forceNew) {
      attempt = await ExamAttempt.create({
        userId,
        dialogueId: dialogueIdNum,
        examType,
        status: "in_progress",
      });
    } else {
      attempt = await ExamAttempt.findOne({
        where: { userId, dialogueId: dialogueIdNum, examType, status: "in_progress" },
        order: [["updatedAt", "DESC"], ["id", "DESC"]],
      });

      if (!attempt) {
        attempt = await ExamAttempt.findOne({
          where: { userId, dialogueId: dialogueIdNum, examType },
          order: [["updatedAt", "DESC"], ["id", "DESC"]],
        });
      }

      if (!attempt) {
        attempt = await ExamAttempt.create({
          userId,
          dialogueId: dialogueIdNum,
          examType,
          status: "in_progress",
        });
      }
    }

    const segments = await Segment.findAll({
      where: { dialogueId: dialogueIdNum },
      order: [["segmentOrder", "ASC"]],
    });

    if (forceNew) {
      return res.status(200).json({
        attempt,
        dialogue,
        segments: segments.map((s) => ({ ...s.toJSON(), isDone: false })),
      });
    }

    const segmentIds = segments.map((s) => Number(s.id)).filter((x) => Number.isFinite(x));

    const doneRows = segmentIds.length
      ? await SegmentAttempt.findAll({
          where: {
            userId,
            examAttemptId: attempt.id,
            segmentId: { [Op.in]: segmentIds },
            [Op.or]: [
              { audioUrl: { [Op.ne]: null } },
              { finalScore: { [Op.ne]: null } },
              { overallScore: { [Op.ne]: null } },
              { userTranscription: { [Op.ne]: null } },
            ],
          },
          attributes: ["segmentId"],
          group: ["segmentId"],
          raw: true,
        })
      : [];

    const doneSet = new Set(doneRows.map((r) => String(r.segmentId)));

    return res.status(200).json({
      attempt,
      dialogue,
      segments: segments.map((s) => ({
        ...s.toJSON(),
        isDone: doneSet.has(String(s.id)),
      })),
    });
  } catch (e) {
    next(e);
  }
};