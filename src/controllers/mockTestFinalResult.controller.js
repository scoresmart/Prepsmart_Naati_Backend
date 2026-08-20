import MockTestFinalResult from "../models/mockTestFinalResult.model.js";
import MockTestResult from "../models/mockTestResult.js";
import MockTestSession from "../models/mockTestSession.model.js";
import MockTest from "../models/mocketTest.model.js";
const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// GET by session id (optionally include segment rows)
export const getMockTestFinalResultBySession = async (req, res, next) => {
  try {
    const mockTestSessionId = toInt(req.params.mockTestSessionId);
    const userId = toInt(req.query.userId ?? req.body?.userId);
    const includeSegments = String(req.query.includeSegments || "0") === "1";

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

    const final = await MockTestFinalResult.findOne({
      where: { mockTestSessionId },
      include: [{ model: MockTestSession }, { model: MockTest }],
    });

    if (!final) {
      return res.status(404).json({
        success: false,
        message: "Final result not found (not computed yet)",
      });
    }

    if (Number(final.userId) !== Number(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    let segments = [];
    if (includeSegments) {
      segments = await MockTestResult.findAll({
        where: { mockTestSessionId, userId },
        order: [["segmentId", "ASC"]],
      });
    }

    return res.json({
      success: true,
      final,
      segments: includeSegments ? segments : undefined,
    });
  } catch (e) {
    next(e);
  }
};

// LIST final results for a user (paginated)
export const listUserMockTestFinalResults = async (req, res, next) => {
  try {
    const userId = toInt(req.params.userId);
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      100,
    );
    const offset = (page - 1) * limit;

    const where = { userId };
    if (req.query.passed === "1") where.passed = true;
    if (req.query.passed === "0") where.passed = false;

    const { rows, count } = await MockTestFinalResult.findAndCountAll({
      where,
      include: [{ model: MockTestSession }, { model: MockTest }],
      order: [["computedAt", "DESC"]],
      limit,
      offset,
    });

    return res.json({
      success: true,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (e) {
    next(e);
  }
};
