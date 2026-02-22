import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import MockTestAttempts from "../models/mockTestAttempt.js";
import ExamAttempt from "../models/examAttempt.model.js";
const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const toPosInt = (v) => {
  const n = toInt(v);
  if (!n || n <= 0) return undefined;
  return n;
};

export const getAllDialogueTimeByUser = async (req, res, next) => {
  try {
    const userId = toInt(req.params.userId);
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const rows = await ExamAttempt.findAll({
      where: { userId, dialogueId: { [Op.ne]: null } },
      attributes: [
        "dialogueId",
        [
          sequelize.fn(
            "SUM",
            sequelize.fn("COALESCE", sequelize.col("completedSeconds"), 0)
          ),
          "completedSeconds",
        ],
      ],
      group: ["dialogueId"],
      raw: true,
    });

    const dialogues = rows
      .map((r) => ({
        userId,
        dialogueId: Number(r.dialogueId),
        completedSeconds: Number(r.completedSeconds) || 0,
      }))
      .filter((x) => Number.isFinite(x.dialogueId));

    const totalSeconds = dialogues.reduce(
      (sum, d) => sum + (Number(d.completedSeconds) || 0),
      0
    );

    return res.json({
      success: true,
      data: {
        userId,
        totalSeconds,
        dialogues,
      },
    });
  } catch (e) {
    next(e);
  }
};

export const getOneDialogueTimeByUser = async (req, res, next) => {
  try {
    const userId = toInt(req.params.userId);
    const dialogueId = toInt(req.params.dialogueId);
    const ExamAttemptId = toInt(req.query.examAttemptId);
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    if (!dialogueId)
      return res
        .status(400)
        .json({ success: false, message: "dialogueId is required" });

    const row = await ExamAttempt.findOne({
      where: { id: ExamAttemptId },
      attributes: [
        "dialogueId",
        [
          sequelize.fn(
            "SUM",
            sequelize.fn("COALESCE", sequelize.col("completedSeconds"), 0)
          ),
          "completedSeconds",
        ],
      ],
      group: ["dialogueId"],
      raw: true,
    });

    return res.json({
      success: true,
      data: {
        userId,
        dialogueId,
        completedSeconds: Number(row?.completedSeconds) || 0,
      },
    });
  } catch (e) {
    next(e);
  }
};

export const incrementDialogueSeconds = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const userId = toInt(req.params.userId);
    const dialogueId = toInt(req.params.dialogueId);
    const seconds = toPosInt(
      req.body.seconds ?? req.body.deltaSeconds ?? req.body.by
    );
    const ExamAttemptId = toInt(req.query.examAttemptId);
    if (!userId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }
    if (!dialogueId) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "dialogueId is required" });
    }
    if (!seconds) {
      await t.rollback();
      return res
        .status(400)
        .json({
          success: false,
          message: "seconds must be a positive integer",
        });
    }

    const latest = await ExamAttempt.findOne({
      where: { id: ExamAttemptId },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!latest) {
      await t.rollback();
      return res
        .status(404)
        .json({
          success: false,
          message: "No attempt found for this user/dialogue",
        });
    }

    await ExamAttempt.update(
      {
        completedSeconds: sequelize.literal(
          `COALESCE(completedSeconds,0) + ${seconds}`
        ),
      },
      { where: { id: latest.id }, transaction: t }
    );

    const sumRow = await ExamAttempt.findOne({
      where: { userId, dialogueId },
      attributes: [
        "dialogueId",
        [
          sequelize.fn(
            "SUM",
            sequelize.fn("COALESCE", sequelize.col("completedSeconds"), 0)
          ),
          "completedSeconds",
        ],
      ],
      group: ["dialogueId"],
      raw: true,
      transaction: t,
    });

    await t.commit();

    return res.json({
      success: true,
      data: {
        userId,
        dialogueId,
        completedSeconds: Number(sumRow?.completedSeconds) || 0,
      },
    });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};
