import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import RapidReview from "../models/rapidReview.js";
import RapidReviewAttempt from "../models/rapidReviewAttempt.js";
import { Language } from "../models/language.model.js";
import { Segment } from "../models/segment.model.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Dialogue } from "../models/dialogue.model.js";
const toInt = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeSegmentIds = (v) => {
  if (Array.isArray(v)) return v.map(toInt).filter((x) => Number.isFinite(x));
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed))
        return parsed.map(toInt).filter((x) => Number.isFinite(x));
    } catch {}
  }
  return [];
};

const getReviewSegmentIds = (rr) => {
  const segs = normalizeSegmentIds(rr?.segments);
  if (segs.length) return segs;
  const legacy = toInt(rr?.segmentId);
  return legacy ? [legacy] : [];
};
function safeDialogue(d) {
  if (!d) return null;
  const plain = d.get ? d.get({ plain: true }) : d;
  return {
    id: plain.id,
    title: plain.title,
    description: plain.description,
  };
}

const fetchSegmentsByIds = async (ids) => {
  const clean = Array.from(new Set(ids.map(toInt).filter(Boolean)));
  if (!clean.length) return [];
  const rows = await Segment.findAll({ where: { id: { [Op.in]: clean } } });
  const map = new Map(rows.map((s) => [s.id, s.get({ plain: true })]));
  return clean.map((id) => map.get(id)).filter(Boolean);
};

const safeRapidReview = (rr, language, segments) => {
  const plain = rr.get({ plain: true });
  const segIds = getReviewSegmentIds(plain);
  return {
    id: plain.id,
    title: plain.title,
    languageId: plain.languageId,
    segments: segIds,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    language: language ? language.get({ plain: true }) : plain.language || null,
    segmentObjects: segments || [],
  };
};
const getPakistanDayRangeUtc = () => {
  const now = new Date();
  const offsetMs = 5 * 60 * 60 * 1000;
  const pk = new Date(now.getTime() + offsetMs);
  const y = pk.getUTCFullYear();
  const m = pk.getUTCMonth();
  const d = pk.getUTCDate();
  const startUtcMs = Date.UTC(y, m, d, 0, 0, 0) - offsetMs;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { start: new Date(startUtcMs), end: new Date(endUtcMs) };
};
export async function createRapidReview(req, res, next) {
  try {
    const { title, languageId } = req.body;
    const segments = normalizeSegmentIds(req.body.segments);

    if (!title || !languageId || !segments.length) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (title, languageId, segments[])",
      });
    }

    const lang = await Language.findByPk(languageId);
    if (!lang)
      return res
        .status(400)
        .json({ success: false, message: "Invalid languageId" });

    const segRows = await Segment.findAll({
      where: { id: { [Op.in]: segments } },
      attributes: ["id"],
    });

    const foundIds = new Set(segRows.map((s) => s.id));
    console.log(foundIds);
    const missing = segments.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid segment ids",
        data: { missing },
      });
    }

    const created = await RapidReview.create({
      title,
      languageId,
      segments,
    });

    const segmentObjects = await fetchSegmentsByIds(segments);

    return res.status(201).json({
      success: true,
      data: { rapidReview: safeRapidReview(created, lang, segmentObjects) },
    });
  } catch (err) {
    return next(err);
  }
}

export async function listRapidReviews(req, res, next) {
  try {
    const { languageId, segmentId, userId: userIdRaw } = req.query;
    const userId = toInt(userIdRaw);

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const where = {};
    if (languageId !== undefined) where.languageId = languageId;

    const segFilter = toInt(segmentId);
    if (segFilter) {
      where[Op.and] = [
        sequelize.literal(
          `JSON_CONTAINS(segments, CAST(${sequelize.escape(
            String(segFilter)
          )} AS JSON))`
        ),
      ];
    }

    const reviews = await RapidReview.findAll({
      where,
      include: [{ model: Language, as: "language" }],
      order: [["id", "DESC"]],
    });

    const allSegIds = [];
    for (const rr of reviews) allSegIds.push(...getReviewSegmentIds(rr));
    const segRows = await Segment.findAll({
      where: { id: { [Op.in]: Array.from(new Set(allSegIds)) } },
    });
    const segMap = new Map(
      segRows.map((s) => [toInt(s.id), s.get({ plain: true })])
    );

    const rapidReviews = reviews.map((rr) => {
      const ids = getReviewSegmentIds(rr);
      const segmentObjects = ids.map((id) => segMap.get(id)).filter(Boolean);
      return safeRapidReview(rr, null, segmentObjects);
    });

    if (user.role === "admin") {
      return res.json({
        success: true,
        data: {
          rapidReviews,
          isSubscribed: true,
          dailyLimit: null,
          dailyDone: null,
          dailyRemaining: null,
        },
      });
    }

    const now = new Date();
    const sub = await Subscription.findOne({
      where: {
        userId,
        status: { [Op.in]: ["active", "trialing"] },
        currentPeriodEnd: { [Op.gt]: now },
      },
      order: [["currentPeriodEnd", "DESC"]],
    });

    if (sub) {
      return res.json({
        success: true,
        data: {
          rapidReviews,
          isSubscribed: true,
          dailyLimit: null,
          dailyDone: null,
          dailyRemaining: null,
        },
      });
    }

    const { start, end } = getPakistanDayRangeUtc();
    const dailyLimit = 5;

    const dailyDone = await RapidReviewAttempt.count({
      where: {
        userId,
        createdAt: { [Op.gte]: start, [Op.lt]: end },
      },
      distinct: true,
      col: "segmentId",
    });

    const dailyRemaining = Math.max(0, dailyLimit - Number(dailyDone || 0));

    return res.json({
      success: true,
      data: {
        rapidReviews,
        isSubscribed: false,
        dailyLimit,
        dailyDone: Number(dailyDone || 0),
        dailyRemaining,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function getRapidReview(req, res, next) {
  try {
    const id = req.params.id;

    const rr = await RapidReview.findByPk(id, {
      include: [{ model: Language, as: "language" }],
    });

    if (!rr)
      return res
        .status(404)
        .json({ success: false, message: "RapidReview not found" });

    const segIds = getReviewSegmentIds(rr);
    const segmentObjects = await fetchSegmentsByIds(segIds);

    return res.json({
      success: true,
      data: { rapidReview: safeRapidReview(rr, null, segmentObjects) },
    });
  } catch (err) {
    return next(err);
  }
}

export async function updateRapidReview(req, res, next) {
  try {
    const id = req.params.id;

    const rr = await RapidReview.findByPk(id);
    if (!rr)
      return res
        .status(404)
        .json({ success: false, message: "RapidReview not found" });

    const { title, languageId } = req.body;
    const segmentsProvided = req.body.segments !== undefined;
    const segments = segmentsProvided
      ? normalizeSegmentIds(req.body.segments)
      : null;

    if (title !== undefined) rr.title = title;

    if (languageId !== undefined) {
      const lang = await Language.findByPk(languageId);
      if (!lang)
        return res
          .status(400)
          .json({ success: false, message: "Invalid languageId" });
      rr.languageId = languageId;
    }

    if (segmentsProvided) {
      if (!segments.length) {
        return res.status(400).json({
          success: false,
          message: "segments[] must be a non-empty array",
        });
      }

      const segRows = await Segment.findAll({
        where: { id: { [Op.in]: segments } },
        attributes: ["id"],
      });

      const foundIds = new Set(segRows.map((s) => s.id));
      const missing = segments.filter((sid) => !foundIds.has(sid));
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: "Invalid segment ids",
          data: { missing },
        });
      }

      rr.segments = segments;
    }

    await rr.save();

    const rrFull = await RapidReview.findByPk(id, {
      include: [{ model: Language, as: "language" }],
    });

    const segIds = getReviewSegmentIds(rrFull);
    const segmentObjects = await fetchSegmentsByIds(segIds);

    return res.json({
      success: true,
      data: { rapidReview: safeRapidReview(rrFull, null, segmentObjects) },
    });
  } catch (err) {
    return next(err);
  }
}

export async function deleteRapidReview(req, res, next) {
  try {
    const id = req.params.id;

    const rr = await RapidReview.findByPk(id);
    if (!rr)
      return res
        .status(404)
        .json({ success: false, message: "RapidReview not found" });

    await rr.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (err) {
    return next(err);
  }
}

const getRapidReviewSegmentIds = (rr) => {
  const segs = normalizeSegmentIds(rr?.segments);
  if (segs.length) return segs;
  const legacy = toInt(rr?.segmentId);
  return legacy ? [legacy] : [];
};

export async function getRapidReviewAttemptsByUser(req, res, next) {
  try {
    const userId = toInt(req.params.userId);
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });

    const attempts = await RapidReviewAttempt.findAll({
      where: { userId },
      attributes: ["rapidReviewId", "segmentId", "createdAt"],
      order: [["id", "DESC"]],
    });

    if (!attempts.length) {
      return res.json({ success: true, data: { rapidReviews: [] } });
    }

    const rapidReviewIds = Array.from(
      new Set(attempts.map((a) => toInt(a.rapidReviewId)).filter(Boolean))
    );

    const rapidReviews = await RapidReview.findAll({
      where: { id: { [Op.in]: rapidReviewIds } },
      order: [["id", "DESC"]],
    });

    const rrMap = new Map(
      rapidReviews.map((r) => [toInt(r.id), r.get({ plain: true })])
    );

    const doneByRR = new Map();
    const lastAttemptAtByRR = new Map();

    for (const a of attempts) {
      const rrId = toInt(a.rapidReviewId);
      const segId = toInt(a.segmentId);
      if (!rrId || !segId) continue;

      if (!doneByRR.has(rrId)) doneByRR.set(rrId, new Set());
      doneByRR.get(rrId).add(segId);

      if (!lastAttemptAtByRR.has(rrId) && a.createdAt) {
        lastAttemptAtByRR.set(rrId, new Date(a.createdAt).toISOString());
      }
    }

    const allSegmentIds = new Set();
    for (const rrId of rapidReviewIds) {
      const rr = rrMap.get(rrId);
      if (!rr) continue;
      const rrSegIds = getRapidReviewSegmentIds(rr);
      for (const sid of rrSegIds) allSegmentIds.add(sid);
    }

    const segments = await Segment.findAll({
      where: { id: { [Op.in]: Array.from(allSegmentIds) } },
    });

    const segMap = new Map(
      segments.map((s) => [toInt(s.id), s.get({ plain: true })])
    );

    const rapidReviewsWithProgress = rapidReviewIds
      .map((rrId) => {
        const rr = rrMap.get(rrId);
        if (!rr) return null;

        const rrSegIds = getRapidReviewSegmentIds(rr);
        const rrSegSet = new Set(rrSegIds);

        const doneSet = doneByRR.get(rrId) || new Set();
        const doneSegmentIds = rrSegIds.filter(
          (sid) => doneSet.has(sid) && rrSegSet.has(sid)
        );
        const remainingSegmentIds = rrSegIds.filter((sid) => !doneSet.has(sid));

        const orderedSegments = rrSegIds
          .map((sid) => segMap.get(sid))
          .filter(Boolean);

        const totalSegments = rrSegIds.length;
        const doneSegments = new Set(doneSegmentIds).size;
        const remainingSegments = Math.max(0, totalSegments - doneSegments);

        return {
          rapidReview: {
            id: rr.id,
            title: rr.title,
            languageId: rr.languageId,
            segments: rrSegIds,
            createdAt: rr.createdAt,
            updatedAt: rr.updatedAt,
          },
          progress: {
            totalSegments,
            doneSegments,
            remainingSegments,
            doneSegmentIds: Array.from(new Set(doneSegmentIds)),
            remainingSegmentIds,
            percent: totalSegments
              ? Math.round((doneSegments / totalSegments) * 100)
              : 0,
            lastAttemptAt: lastAttemptAtByRR.get(rrId) || null,
          },
          segments: orderedSegments,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ta = a.progress.lastAttemptAt
          ? Date.parse(a.progress.lastAttemptAt)
          : 0;
        const tb = b.progress.lastAttemptAt
          ? Date.parse(b.progress.lastAttemptAt)
          : 0;
        return tb - ta;
      });

    return res.json({
      success: true,
      data: {
        rapidReviews: rapidReviewsWithProgress,
      },
    });
  } catch (err) {
    return next(err);
  }
}
export async function getSegmentsByLanguage(req, res, next) {
  try {
    const { languageId } = req.params;

    if (!languageId) {
      return res.status(400).json({ success: false, message: "languageId is required" });
    }

    const lang = await Language.findByPk(languageId);
    if (!lang) {
      return res.status(404).json({ success: false, message: "Language not found" });
    }

    const dialogues = await Dialogue.findAll({
      where: { languageId },
      order: [["id", "DESC"]],
    });

    if (!dialogues.length) {
      return res.json({
        success: true,
        data: { language: lang.get({ plain: true }), dialogues: [], segments: [] },
      });
    }

    const dialogueIds = dialogues.map((d) => d.id);

    const segments = await Segment.findAll({
      where: { dialogueId: { [Op.in]: dialogueIds } },
      order: [
        ["dialogueId", "ASC"],
        ["segmentOrder", "ASC"],
        ["id", "ASC"],
      ],
    });

    const segMap = new Map();
    for (const s of segments) {
      const did = s.dialogueId;
      if (!segMap.has(did)) segMap.set(did, []);
      segMap.get(did).push(s.get({ plain: true }));
    }

    const result = dialogues.map((d) => ({
      ...safeDialogue(d),
      segments: segMap.get(d.id) || [],
    }));

    return res.json({
      success: true,
      data: {
        language: lang.get({ plain: true }),
        dialogues: result,
        segments: segments.map((s) => s.get({ plain: true })),
      },
    });
  } catch (err) {
    return next(err);
  }
}
