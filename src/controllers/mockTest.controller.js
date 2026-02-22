import { Op } from "sequelize";
import MockTest from "../models/mocketTest.model.js";
import { Dialogue } from "../models/dialogue.model.js";
import { Language } from "../models/language.model.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import MockTestSession from "../models/mockTestSession.model.js";

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

const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj?.[k] !== undefined) return obj[k];
  }
  return undefined;
};

export const createMockTest = async (req, res, next) => {
  try {
    const title = pick(req.body, "title");
    const languageRaw = pick(req.body, "language_id", "languageId");
    const d1Raw = pick(req.body, "dialogue_id", "dialogueId");
    const d2Raw = pick(req.body, "dialogue_id_2", "dialogueId2");

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    const languageId = toInt(languageRaw);
    if (!languageId) {
      return res.status(400).json({ message: "language_id is required" });
    }

    const dialogueId = toInt(d1Raw);
    const dialogueId2 = toInt(d2Raw);

    if (!dialogueId || !dialogueId2) {
      return res.status(400).json({
        message:
          "dialogue_id and dialogue_id_2 are required (MockTest needs 2 dialogues)",
      });
    }

    if (String(dialogueId) === String(dialogueId2)) {
      return res
        .status(400)
        .json({ message: "dialogue_id and dialogue_id_2 must be different" });
    }

    // Ensure both dialogues exist
    const dialogues = await Dialogue.findAll({
      where: { id: { [Op.in]: [dialogueId, dialogueId2] } },
    });

    if (!dialogues || dialogues.length !== 2) {
      return res
        .status(404)
        .json({ message: "One or both dialogues not found" });
    }

    // ✅ Use MODEL ATTRIBUTE NAMES (camelCase), not DB column names
    const mockTest = await MockTest.create({
      title: title.trim(),
      languageId,
      dialogueId,
      dialogueId2,
      durationSeconds: 1200,
      totalMarks: 90,
      passMarks: 62,
    });

    const created = await MockTest.findByPk(mockTest.id, {
      include: [
        { model: Dialogue, as: "dialogue1" },
        { model: Dialogue, as: "dialogue2" },
      ],
    });

    return res.status(201).json({ data: created });
  } catch (err) {
    return next(err);
  }
};

export const getMockTestById = async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const mockTest = await MockTest.findByPk(id, {
      include: [
        { model: Language, as: "language" },
        { model: Dialogue, as: "dialogue1" },
        { model: Dialogue, as: "dialogue2" },
      ],
    });

    if (!mockTest)
      return res.status(404).json({ message: "MockTest not found" });

    return res.json({ data: mockTest });
  } catch (err) {
    return next(err);
  }
};

export const updateMockTest = async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const mockTest = await MockTest.findByPk(id);
    if (!mockTest)
      return res.status(404).json({ message: "MockTest not found" });

    const title = pick(req.body, "title");
    const languageRaw = pick(req.body, "language_id", "languageId");
    const d1Raw = pick(req.body, "dialogue_id", "dialogueId");
    const d2Raw = pick(req.body, "dialogue_id_2", "dialogueId2");
    const durationRaw = pick(req.body, "duration_seconds", "durationSeconds");
    const totalMarksRaw = pick(req.body, "total_marks", "totalMarks");
    const passMarksRaw = pick(req.body, "pass_marks", "passMarks");

    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) {
        return res
          .status(400)
          .json({ message: "title must be a non-empty string" });
      }
      mockTest.title = title.trim();
    }

    if (languageRaw !== undefined) {
      const languageId = toInt(languageRaw);
      if (!languageId)
        return res.status(400).json({ message: "Invalid language_id" });
      mockTest.languageId = languageId;
    }

    if (d1Raw !== undefined) {
      const dialogueId = toInt(d1Raw);
      if (!dialogueId)
        return res.status(400).json({ message: "Invalid dialogue_id" });
      mockTest.dialogueId = dialogueId;
    }

    if (d2Raw !== undefined) {
      const dialogueId2 = toInt(d2Raw);
      if (!dialogueId2)
        return res.status(400).json({ message: "Invalid dialogue_id_2" });
      mockTest.dialogueId2 = dialogueId2;
    }

    // if both set, ensure not same
    if (
      mockTest.dialogueId !== undefined &&
      mockTest.dialogueId2 !== undefined &&
      String(mockTest.dialogueId) === String(mockTest.dialogueId2)
    ) {
      return res.status(400).json({
        message: "dialogue_id and dialogue_id_2 must be different",
      });
    }

    if (durationRaw !== undefined) {
      const durationSeconds = toNum(durationRaw);
      if (durationSeconds === undefined || durationSeconds < 0) {
        return res
          .status(400)
          .json({ message: "duration_seconds must be a non-negative number" });
      }
      mockTest.durationSeconds = durationSeconds;
    }

    if (totalMarksRaw !== undefined) {
      const totalMarks = toInt(totalMarksRaw);
      if (!totalMarks || totalMarks < 0) {
        return res
          .status(400)
          .json({ message: "total_marks must be a non-negative integer" });
      }
      mockTest.totalMarks = totalMarks;
    }

    if (passMarksRaw !== undefined) {
      const passMarks = toInt(passMarksRaw);
      if (!passMarks || passMarks < 0) {
        return res
          .status(400)
          .json({ message: "pass_marks must be a non-negative integer" });
      }
      mockTest.passMarks = passMarks;
    }

    await mockTest.save();

    const updated = await MockTest.findByPk(mockTest.id, {
      include: [
        { model: Dialogue, as: "dialogue1" },
        { model: Dialogue, as: "dialogue2" },
      ],
    });

    return res.json({ data: updated });
  } catch (err) {
    return next(err);
  }
};

export const deleteMockTest = async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });

    const mockTest = await MockTest.findByPk(id);
    if (!mockTest)
      return res.status(404).json({ message: "MockTest not found" });

    await mockTest.destroy();
    return res.json({ message: "MockTest deleted successfully" });
  } catch (err) {
    return next(err);
  }
};

const getTimeZoneOffsetMs = (timeZone, date) => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;

  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hh = Number(get("hour"));
  const mm = Number(get("minute"));
  const ss = Number(get("second"));

  const asUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
  return asUTC - date.getTime();
};

const getDayRangeUtcForTimeZone = (timeZone) => {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;

  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));

  let start = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const off = getTimeZoneOffsetMs(timeZone, new Date(start));
    const next = Date.UTC(y, m - 1, d, 0, 0, 0) - off;
    if (Math.abs(next - start) < 1000) {
      start = next;
      break;
    }
    start = next;
  }

  const end = start + 24 * 60 * 60 * 1000;
  return { start: new Date(start), end: new Date(end) };
};

export const getMockTests = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      100
    );
    const offset = (page - 1) * limit;

    const userId = toInt(pick(req.query, "userId", "user_id"));
    const languageId = toInt(pick(req.query, "language_id", "languageId"));

    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const user = await User.findByPk(userId, { attributes: ["id", "role"] });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const where = {};

    const dialogueFilter = toInt(pick(req.query, "dialogue_id", "dialogueId"));
    if (dialogueFilter) {
      where[Op.or] = [
        { dialogueId: dialogueFilter },
        { dialogueId2: dialogueFilter },
      ];
    }

    let isSubscribed = false;

    if (user.role === "admin") {
      isSubscribed = true;
    } else {
      if (!languageId)
        return res
          .status(400)
          .json({ success: false, message: "languageId is required" });

      const sub = await Subscription.findOne({
        where: {
          userId: user.id,
          status: { [Op.in]: ["active", "trialing"] },
          currentPeriodEnd: { [Op.gt]: new Date() },
        },
        order: [["currentPeriodEnd", "DESC"]],
      });

      isSubscribed = !!sub;
      where.languageId = languageId;
    }

    const { rows, count } = await MockTest.findAndCountAll({
      where,
      include: [
        { model: Language, as: "language" },
        { model: Dialogue, as: "dialogue1" },
        { model: Dialogue, as: "dialogue2" },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    if (user.role !== "admin" && !isSubscribed) {
      const maxLimit = 1;
      const mockTestIds = rows
        .map((r) => Number(r.id))
        .filter((x) => Number.isFinite(x));

      const AU_TZ = "Australia/Sydney";
      const { start, end } = getDayRangeUtcForTimeZone(AU_TZ);

      const attemptCount = mockTestIds.length
        ? await MockTestSession.count({
            where: {
              userId: user.id,
              mockTestId: { [Op.in]: mockTestIds },
              startedAt: { [Op.gte]: start, [Op.lt]: end },
            },
            distinct: true,
            col: "mock_test_id",
          })
        : 0;

      const limitRemaining = Math.max(0, maxLimit - Number(attemptCount || 0));

      return res.json({
        success: true,
        isSubscribed: false,
        attemptCount: Number(attemptCount || 0),
        maxLimit,
        limitRemaining,
        data: rows,
        meta: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    }

    return res.json({
      success: true,
      isSubscribed,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    return next(err);
  }
};
