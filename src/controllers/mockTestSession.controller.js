import MockTest from "../models/mocketTest.model.js";
import { Dialogue } from "../models/dialogue.model.js";
import { Segment } from "../models/segment.model.js";
import MockTestAttempts from "../models/mockTestAttempt.js";

const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const startMockTest = async (req, res, next) => {
  try {
    console.log("start");
    const { mockTestId, userId } = req.body;

    const userIdNum = toInt(userId);
    if (!userIdNum) {
      return res.status(400).json({ message: "userId is required" });
    }

    const mockTestIdNum = toInt(mockTestId);
    if (!mockTestIdNum) {
      return res.status(400).json({ message: "mockTestId is required" });
    }

    const mockTest = await MockTest.findByPk(mockTestIdNum);
    if (!mockTest) {
      return res.status(404).json({ message: "MockTest not found" });
    }

    // ✅ use model attribute names (with fallback)
    const d1 = toInt(mockTest.dialogueId ?? mockTest.dialogue_id);
    const d2 = toInt(mockTest.dialogueId2 ?? mockTest.dialogue_id_2);

    if (!d1) {
      return res
        .status(500)
        .json({ message: "MockTest has invalid dialogue_id" });
    }

    // fetch dialogues (1 or 2)
    const dialogueIds = d2 && String(d2) !== String(d1) ? [d1, d2] : [d1];

    const dialogues = await Dialogue.findAll({
      where: { id: dialogueIds },
    });

    if (!dialogues || dialogues.length !== dialogueIds.length) {
      return res
        .status(404)
        .json({ message: "Dialogue not found for this MockTest" });
    }

    // fetch segments for each dialogue, in order, then combine
    const segments1 = await Segment.findAll({
      where: { dialogueId: d1 },
      order: [["segmentOrder", "ASC"]],
    });

    const segments2 =
      dialogueIds.length === 2
        ? await Segment.findAll({
            where: { dialogueId: d2 },
            order: [["segmentOrder", "ASC"]],
          })
        : [];

    const segments = [...segments1, ...segments2];

    if (!segments.length) {
      return res
        .status(404)
        .json({ message: "No segments found for this dialogue" });
    }

    // create attempt for first segment
    const firstSegment = segments[0];

    const attempt = await MockTestAttempts.create({
      userId: userIdNum,
      dialogueId: firstSegment.dialogueId, // keep consistent with segment
      segmentId: firstSegment.id,
      status: "in_progress",
    });

    return res.status(201).json({
      attempt,
      mockTest,
      dialogues,
      segments,
      durationSeconds: mockTest.durationSeconds ?? mockTest.duration_seconds,
    });
  } catch (e) {
    console.error(e);
    next(e);
  }
};
