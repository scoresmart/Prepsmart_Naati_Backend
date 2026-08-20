import { Op } from "sequelize";
import { models } from "../models/index.js";

export async function getDashboardCounts(req, res, next) {
  try {
    const [languagesCount, domainsCount, dialoguesCount] = await Promise.all([
      models.Language.count(),
      models.Domain.count(),
      models.Dialogue.count()
    ]);

    return res.json({
      success: true,
      data: { languagesCount, domainsCount, dialoguesCount }
    });
  } catch (e) {
    return next(e);
  }
}

export async function getPracticeLogs(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim() || "";
    const language = req.query.language?.trim() || "";
    const scoreFilter = req.query.score || "";
    const examType = req.query.examType || "";

    const attemptWhere = {};
    const userWhere = {};

    if (search) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    if (language) {
      attemptWhere.language = language;
    }

    if (scoreFilter === "high") {
      attemptWhere.finalScore = { [Op.gte]: 36 };
    } else if (scoreFilter === "medium") {
      attemptWhere.finalScore = { [Op.between]: [22.5, 35.9] };
    } else if (scoreFilter === "low") {
      attemptWhere.finalScore = { [Op.lt]: 22.5 };
    } else if (scoreFilter === "unscored") {
      attemptWhere.finalScore = null;
    }

    const examAttemptWhere = {};
    if (examType) {
      examAttemptWhere.examType = examType;
    }

    const { count, rows } = await models.SegmentAttempt.findAndCountAll({
      where: attemptWhere,
      include: [
        {
          model: models.User,
          attributes: ["id", "name", "email"],
          where: Object.keys(userWhere).length ? userWhere : undefined,
          required: Object.keys(userWhere).length > 0,
        },
        {
          model: models.Segment,
          as: "segment",
          attributes: ["id", "textContent", "segmentOrder"],
          include: [
            {
              model: models.Dialogue,
              attributes: ["id", "title"],
            },
          ],
        },
        {
          model: models.ExamAttempt,
          attributes: ["id", "examType"],
          where: Object.keys(examAttemptWhere).length ? examAttemptWhere : undefined,
          required: Object.keys(examAttemptWhere).length > 0,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    const logs = rows.map((sa) => {
      const plain = sa.get({ plain: true });
      return {
        id: plain.id,
        userId: plain.userId,
        userName: plain.User?.name || "Unknown",
        userEmail: plain.User?.email || "",
        segmentId: plain.segmentId,
        segmentText: plain.segment?.textContent || "",
        segmentOrder: plain.segment?.segmentOrder || null,
        dialogueId: plain.segment?.Dialogue?.id || null,
        dialogueTitle: plain.segment?.Dialogue?.title || "—",
        examAttemptId: plain.examAttemptId,
        examType: plain.ExamAttempt?.examType || null,
        language: plain.language || "—",
        finalScore: plain.finalScore,
        totalRawScore: plain.totalRawScore,
        accuracyScore: plain.accuracyScore,
        languageQualityScore: plain.languageQualityScore,
        fluencyPronunciationScore: plain.fluencyPronunciationScore,
        deliveryCoherenceScore: plain.deliveryCoherenceScore,
        culturalControlScore: plain.culturalControlScore,
        responseManagementScore: plain.responseManagementScore,
        userTranscription: plain.userTranscription,
        oneLineFeedback: plain.oneLineFeedback,
        repeatCount: plain.repeatCount,
        audioUrl: plain.audioUrl,
        createdAt: plain.createdAt,
      };
    });

    return res.json({
      success: true,
      data: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        logs,
      },
    });
  } catch (e) {
    return next(e);
  }
}
