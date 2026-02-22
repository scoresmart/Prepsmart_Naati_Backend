import { models } from "../models/index.js";
import { Op } from "sequelize";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Dialogue } from "../models/dialogue.model.js";
import { Segment } from "../models/segment.model.js";
import { Domain } from "../models/domain.model.js";
import { Language } from "../models/language.model.js";
import MockTestAttempts from "../models/mockTestAttempt.js";
import ExamAttempt from "../models/examAttempt.model.js";
import { sequelize } from "../config/db.js";
const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
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
const round2 = (n) => Number((Math.round(Number(n) * 100) / 100).toFixed(2));

const clamp = (num, min, max) => {
  const n = typeof num === "number" ? num : Number(num);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

const getUserAllowedLanguageIds = async (userId) => {
  const subs = await Subscription.findAll({
    where: {
      userId,
      status: { [Op.in]: ["active", "trialing", "past_due"] },
      languageId: { [Op.ne]: null },
    },
    attributes: ["languageId"],
  });

  const ids = Array.from(
    new Set(
      subs.map((s) => Number(s.languageId)).filter((x) => Number.isFinite(x))
    )
  );

  return ids;
};

const buildDialogueUserProgress = async ({ userId, dialogueId, segments }) => {
  const segs = Array.isArray(segments) ? segments : [];
  const segmentIds = segs
    .map((s) => Number(s.id))
    .filter((x) => Number.isFinite(x));

  if (!segmentIds.length) {
    return {
      attemptedBefore: false,
      totalSegments: 0,
      attemptedSegments: 0,
      pendingSegments: 0,
      pendingSegmentIds: [],
      lastAttemptAt: null,
      avgScoreOutOf45: null,
      segments: [],
    };
  }

  const attempts = await MockTestAttempts.findAll({
    where: {
      userId,
      dialogueId,
      segmentId: { [Op.in]: segmentIds },
      mockTestSessionId: { [Op.is]: null },
    },
    attributes: [
      "id",
      "segmentId",
      "repeatCount",
      "finalScore",
      "overallScore",
      "createdAt",
      "status",
    ],
    order: [
      ["segmentId", "ASC"],
      ["createdAt", "DESC"],
    ],
  });

  const latestBySegment = new Map();
  let lastAttemptAt = null;

  for (const a of attempts) {
    const sid = String(a.segmentId);
    if (!latestBySegment.has(sid)) latestBySegment.set(sid, a);
    const ca = new Date(a.createdAt);
    if (!lastAttemptAt || ca > lastAttemptAt) lastAttemptAt = ca;
  }

  const segmentRows = segs
    .slice()
    .sort((a, b) => Number(a.segmentOrder) - Number(b.segmentOrder))
    .map((s) => {
      const last = latestBySegment.get(String(s.id)) || null;
      const score = last ? Number(last.finalScore ?? last.overallScore) : null;

      return {
        id: s.id,
        segmentOrder: s.segmentOrder,
        attempted: !!last,
        lastAttempt: last
          ? {
              attemptId: last.id,
              repeatCount: last.repeatCount ?? null,
              scoreOutOf45: Number.isFinite(score)
                ? round2(clamp(score, 0, 45))
                : null,
              status: last.status ?? null,
              attemptedAt: last.createdAt,
            }
          : null,
      };
    });

  const attemptedSegments = segmentRows.filter((x) => x.attempted).length;
  const totalSegments = segmentRows.length;
  const pendingSegments = totalSegments - attemptedSegments;
  const pendingSegmentIds = segmentRows
    .filter((x) => !x.attempted)
    .map((x) => x.id);

  const scores = segmentRows
    .map((x) => x.lastAttempt?.scoreOutOf45)
    .filter((n) => Number.isFinite(n));

  const avgScoreOutOf45 = scores.length
    ? round2(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  return {
    attemptedBefore: attempts.length > 0,
    totalSegments,
    attemptedSegments,
    pendingSegments,
    pendingSegmentIds,
    lastAttemptAt,
    avgScoreOutOf45,
    segments: segmentRows,
  };
};

export async function createDialogue(req, res, next) {
  try {
    const { domainId, languageId, title, description, duration, difficulty } =
      req.body;
    if (!domainId || !languageId || !title)
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });

    const domain = await models.Domain.findByPk(domainId);
    if (!domain)
      return res
        .status(400)
        .json({ success: false, message: "Invalid domainId" });

    const lang = await models.Language.findByPk(languageId);
    if (!lang)
      return res
        .status(400)
        .json({ success: false, message: "Invalid languageId" });

    const dialogue = await models.Dialogue.create({
      domainId,
      languageId,
      title,
      description: description || null,
      duration: duration ?? null,
      difficulty: difficulty || "easy",
    });

    return res.status(201).json({ success: true, data: { dialogue } });
  } catch (e) {
    return next(e);
  }
}

export async function getDialogue(req, res, next) {
  try {
    const userId = toInt(req.query.userId);
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const user = await User.findByPk(userId, { attributes: ["id", "role"] });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const dialogue = await Dialogue.findByPk(req.params.id, {
      include: [{ model: Domain }, { model: Language }, { model: Segment }],
      order: [[Segment, "segmentOrder", "ASC"]],
    });

    if (!dialogue)
      return res.status(404).json({ success: false, message: "Not found" });

    if (user.role !== "admin") {
      const allowedLanguageIds = await getUserAllowedLanguageIds(userId);
      if (
        allowedLanguageIds.length &&
        !allowedLanguageIds.includes(Number(dialogue.languageId))
      ) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    const segments = Array.isArray(dialogue.Segments)
      ? dialogue.Segments
      : Array.isArray(dialogue.segments)
      ? dialogue.segments
      : [];

    const userProgress = await buildDialogueUserProgress({
      userId,
      dialogueId: Number(dialogue.id),
      segments,
    });

    return res.json({ success: true, data: { dialogue, userProgress } });
  } catch (e) {
    return next(e);
  }
}

export async function updateDialogue(req, res, next) {
  try {
    const dialogue = await models.Dialogue.findByPk(req.params.id);
    if (!dialogue)
      return res.status(404).json({ success: false, message: "Not found" });

    const { domainId, languageId, title, description, duration, difficulty } =
      req.body;

    if (
      domainId !== undefined &&
      String(domainId) !== String(dialogue.domainId)
    ) {
      const domain = await models.Domain.findByPk(domainId);
      if (!domain)
        return res
          .status(400)
          .json({ success: false, message: "Invalid domainId" });
      dialogue.domainId = domainId;
    }

    if (
      languageId !== undefined &&
      String(languageId) !== String(dialogue.languageId)
    ) {
      const lang = await models.Language.findByPk(languageId);
      if (!lang)
        return res
          .status(400)
          .json({ success: false, message: "Invalid languageId" });
      dialogue.languageId = languageId;
    }

    if (title !== undefined) dialogue.title = title;
    if (description !== undefined) dialogue.description = description || null;
    if (duration !== undefined) dialogue.duration = duration ?? null;
    if (difficulty !== undefined) dialogue.difficulty = difficulty;

    await dialogue.save();
    return res.json({ success: true, data: { dialogue } });
  } catch (e) {
    return next(e);
  }
}

export async function deleteDialogue(req, res, next) {
  try {
    const dialogue = await models.Dialogue.findByPk(req.params.id);
    if (!dialogue)
      return res.status(404).json({ success: false, message: "Not found" });
    await dialogue.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (e) {
    return next(e);
  }
}

export async function listDialogues(req, res, next) {
  try {
    const userId = toInt(req.query.userId);
    const languageId = toInt(req.query.languageId);

    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const includeUserStats =
      String(
        req.query.includeUserStats ?? req.query.include_user_stats ?? "0"
      ) === "1";

    const user = await User.findByPk(userId, { attributes: ["id", "role", "subscriptionPlan"] });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    let isSubscribed = false;

    if (user.role === "admin") {
      isSubscribed = true;
    } else if (user.subscriptionPlan) {
      // Admin-assigned plan — treat as subscribed
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
    }

    const where = {};
    if (user.role !== "admin") where.languageId = languageId;

    const dialogues = await Dialogue.findAll({
      where,
      include: [{ model: Domain }, { model: Language }],
      order: [["createdAt", "DESC"]],
    });

    const dialogueIds = dialogues
      .map((d) => Number(d.id))
      .filter((x) => Number.isFinite(x));

    const buildLimits = async () => {
      const maxRapidReview = 0;
      const maxCompleteDialogue = 1;

      const AU_TZ = "Australia/Sydney";
      const { start, end } = getDayRangeUtcForTimeZone(AU_TZ);

      const completeDialogueCount = dialogueIds.length
        ? await ExamAttempt.count({
            where: {
              userId: user.id,
              dialogueId: { [Op.in]: dialogueIds },
              examType: "complete_dialogue",
              createdAt: { [Op.gte]: start, [Op.lt]: end },
            },
          })
        : 0;

      return {
        limits: {
          rapid_review: {
            maxLimit: maxRapidReview,
            attemptCount: 0,
            limitRemaining: 0,
          },
          complete_dialogue: {
            maxLimit: maxCompleteDialogue,
            attemptCount: Number(completeDialogueCount || 0),
            limitRemaining: Math.max(
              0,
              maxCompleteDialogue - Number(completeDialogueCount || 0)
            ),
          },
        },
      };
    };

    const attemptRows = dialogueIds.length
      ? await ExamAttempt.findAll({
          where: { userId: user.id, dialogueId: { [Op.in]: dialogueIds } },
          attributes: ["id", "dialogueId", "status", "updatedAt"],
          order: [
            ["updatedAt", "DESC"],
            ["id", "DESC"],
          ],
          raw: true,
        })
      : [];

    const latestStatusByDialogue = new Map();
    for (const r of attemptRows) {
      const dk = String(r.dialogueId);
      if (!latestStatusByDialogue.has(dk))
        latestStatusByDialogue.set(dk, r.status);
    }

    const dialoguesWithStatus = dialogues.map((d) => {
      const st = latestStatusByDialogue.get(String(d.id));
      const status =
        st === "completed" || st === "in_progress" ? st : "not_started";
      return { ...d.toJSON(), status };
    });

    if (!includeUserStats) {
      if (user.role !== "admin" && !isSubscribed) {
        const limitsPayload = await buildLimits();
        return res.json({
          success: true,
          isSubscribed: false,
          ...limitsPayload,
          data: { dialogues: dialoguesWithStatus },
        });
      }

      return res.json({
        success: true,
        isSubscribed,
        data: { dialogues: dialoguesWithStatus },
      });
    }

    if (user.role !== "admin" && !isSubscribed) {
      const limitsPayload = await buildLimits();
      return res.json({
        success: true,
        isSubscribed: false,
        ...limitsPayload,
        data: { dialogues: dialoguesWithStatus },
      });
    }

    return res.json({
      success: true,
      isSubscribed,
      data: { dialogues: dialoguesWithStatus },
    });
  } catch (e) {
    return next(e);
  }
}
