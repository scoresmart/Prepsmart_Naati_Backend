import { sequelize } from "../config/db.js";
import MockTestSession from "../models/mockTestSession.model.js";

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

export const getUserCompletedSeconds = async (req, res, next) => {
  try {
    const userId = toInt(req.params.userId ?? req.query.userId);
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    const sessions = await MockTestSession.findAll({
      where: { userId },
      attributes: ["id", "mockTestId", "status", "completedSeconds", "createdAt", "completedAt"],
      order: [["createdAt", "DESC"]],
    });

    const totalCompletedSeconds = sessions.reduce((sum, s) => {
      const v = Number(s.completedSeconds);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    return res.json({
      success: true,
      data: {
        userId,
        totalCompletedSeconds,
        sessions,
      },
    });
  } catch (e) {
    next(e);
  }
};

export const getSessionCompletedSeconds = async (req, res, next) => {
  try {
    const userId = toInt(req.query.userId ?? req.body?.userId);
    const mockTestSessionId = toInt(req.params.mockTestSessionId);

    if (!mockTestSessionId) {
      return res.status(400).json({ success: false, message: "mockTestSessionId is required" });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const session = await MockTestSession.findByPk(mockTestSessionId, {
      attributes: ["id", "userId", "mockTestId", "status", "completedSeconds", "createdAt", "completedAt"],
    });

    if (!session) return res.status(404).json({ success: false, message: "Session not found" });
    if (Number(session.userId) !== Number(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({
      success: true,
      data: {
        mockTestSessionId: session.id,
        userId: session.userId,
        mockTestId: session.mockTestId,
        status: session.status,
        completedSeconds: Number(session.completedSeconds) || 0,
        createdAt: session.createdAt,
        completedAt: session.completedAt,
      },
    });
  } catch (e) {
    next(e);
  }
};

export const incrementSessionCompletedSeconds = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const mockTestSessionId = toInt(req.params.mockTestSessionId);
    const userId = toInt(req.body.userId ?? req.query.userId);
    const seconds = toPosInt(req.body.seconds ?? req.body.deltaSeconds ?? req.body.by);

    if (!mockTestSessionId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "mockTestSessionId is required" });
    }
    if (!userId) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "userId is required" });
    }
    if (!seconds) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "seconds must be a positive integer" });
    }

    const session = await MockTestSession.findByPk(mockTestSessionId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!session) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Session not found" });
    }
    if (Number(session.userId) !== Number(userId)) {
      await t.rollback();
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await MockTestSession.update(
      { completedSeconds: sequelize.literal(`COALESCE(completedSeconds,0) + ${seconds}`) },
      { where: { id: mockTestSessionId, userId }, transaction: t }
    );

    const updated = await MockTestSession.findByPk(mockTestSessionId, {
      transaction: t,
      attributes: ["id", "userId", "mockTestId", "status", "completedSeconds"],
      lock: t.LOCK.UPDATE,
    });

    await t.commit();

    return res.json({
      success: true,
      data: {
        mockTestSessionId: updated.id,
        userId: updated.userId,
        mockTestId: updated.mockTestId,
        status: updated.status,
        completedSeconds: Number(updated.completedSeconds) || 0,
        addedSeconds: seconds,
      },
    });
  } catch (e) {
    await t.rollback();
    next(e);
  }
};
