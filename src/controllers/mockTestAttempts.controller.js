import MockTest from "../models/mocketTest.model.js";
import MockTestSession from "../models/mockTestSession.model.js";
import { Dialogue } from "../models/dialogue.model.js";
import { Segment } from "../models/segment.model.js";
import MockTestAttempts from "../models/mockTestAttempt.js";
import { sequelize } from "../config/db.js";

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const startMockTest = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { mockTestId, userId } = req.body;

    const userIdNum = toInt(userId);
    if (!userIdNum) {
      await t.rollback();
      return res.status(400).json({ message: "userId is required" });
    }

    const mockTestIdNum = toInt(mockTestId);
    if (!mockTestIdNum) {
      await t.rollback();
      return res.status(400).json({ message: "mockTestId is required" });
    }

    const mockTest = await MockTest.findByPk(mockTestIdNum, { transaction: t });
    if (!mockTest) {
      await t.rollback();
      return res.status(404).json({ message: "MockTest not found" });
    }

    // ✅ use model attributes (camelCase). field mapping handles DB columns.
    const d1 = toInt(mockTest.dialogueId ?? mockTest.dialogue_id);
    const d2 = toInt(mockTest.dialogueId2 ?? mockTest.dialogue_id_2);

    if (!d1) {
      await t.rollback();
      return res
        .status(500)
        .json({ message: "MockTest has invalid dialogue_id" });
    }

    const dialogueIds = d2 && String(d2) !== String(d1) ? [d1, d2] : [d1];

    const dialogues = await Dialogue.findAll({
      where: { id: dialogueIds },
      transaction: t,
    });

    if (!dialogues || dialogues.length !== dialogueIds.length) {
      await t.rollback();
      return res
        .status(404)
        .json({ message: "Dialogue not found for this MockTest" });
    }

    // Fetch segments for dialogue 1
    const segments1 = await Segment.findAll({
      where: { dialogueId: d1 },
      order: [["segmentOrder", "ASC"]],
      transaction: t,
    });

    // Fetch segments for dialogue 2 (if exists)
    const segments2 =
      dialogueIds.length === 2
        ? await Segment.findAll({
            where: { dialogueId: d2 },
            order: [["segmentOrder", "ASC"]],
            transaction: t,
          })
        : [];

    const segments = [...segments1, ...segments2];

    if (!segments.length) {
      await t.rollback();
      return res
        .status(404)
        .json({ message: "No segments found for this mock test" });
    }

    const firstSegment = segments[0];

    // ✅ Create session first (because attempts require mockTestSessionId)
    const session = await MockTestSession.create(
      {
        mockTestId: mockTest.id,
        userId: userIdNum,
        status: "in_progress",
        totalMarks: mockTest.totalMarks ?? 90,
        passMarks: mockTest.passMarks ?? 63,
        totalScore: 0,
        passed: false,
      },
      { transaction: t },
    );

    // ✅ Now create attempt with REQUIRED fields
    // IMPORTANT: do NOT set status to "in_progress" because enum is ("submitted","scored")
    const attempt = await MockTestAttempts.create(
      {
        mockTestSessionId: session.id,
        mockTestId: mockTest.id,
        userId: userIdNum,
        dialogueId: firstSegment.dialogueId,
        segmentId: firstSegment.id,
        // status will default to "submitted"
      },
      { transaction: t },
    );

    await t.commit();

    return res.status(201).json({
      session,
      attempt,
      mockTest,
      dialogues,
      segments,
      durationSeconds:
        mockTest.durationSeconds ?? mockTest.duration_seconds ?? 20,
    });
  } catch (e) {
    await t.rollback();
    console.error(e);
    next(e);
  }
};
