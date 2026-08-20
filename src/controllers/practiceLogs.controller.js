import { models } from "../models/index.js";
import { Op } from "sequelize";

/**
 * GET /api/v1/admin/practice-logs
 * Returns paginated list of all ExamAttempts with user, dialogue, and
 * per-segment answers (audio URL + transcription + AI scores).
 *
 * Query params:
 *   page        - page number (default 1)
 *   limit       - rows per page (default 20)
 *   userId      - filter by user ID
 *   dialogueId  - filter by dialogue ID
 *   examType    - "rapid_review" | "complete_dialogue"
 *   status      - "in_progress" | "completed"
 *   search      - partial match on user name/email
 */
export async function getPracticeLogs(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.dialogueId) where.dialogueId = req.query.dialogueId;
    if (req.query.examType) where.examType = req.query.examType;
    if (req.query.status) where.status = req.query.status;

    const userWhere = {};
    if (req.query.search) {
      userWhere[Op.or] = [
        { name: { [Op.like]: `%${req.query.search}%` } },
        { email: { [Op.like]: `%${req.query.search}%` } },
      ];
    }

    const { count, rows } = await models.ExamAttempt.findAndCountAll({
      where,
      include: [
        {
          model: models.User,
          attributes: ["id", "name", "email"],
          where: Object.keys(userWhere).length ? userWhere : undefined,
          required: Object.keys(userWhere).length > 0,
        },
        {
          model: models.Dialogue,
          attributes: ["id", "title"],
          include: [
            {
              model: models.Domain,
              attributes: ["id", "title"],
              include: [
                {
                  model: models.Language,
                  attributes: ["id", "name"],
                },
              ],
            },
          ],
        },
        {
          model: models.SegmentAttempt,
          include: [
            {
              model: models.Segment,
              attributes: ["id", ["segment_order", "order"], ["text_content", "text"]],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
    });

    return res.json({
      success: true,
      data: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        logs: rows,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/practice-logs/:id
 * Returns a single ExamAttempt with all segment answers.
 */
export async function getPracticeLogDetail(req, res, next) {
  try {
    const attempt = await models.ExamAttempt.findByPk(req.params.id, {
      include: [
        {
          model: models.User,
          attributes: ["id", "name", "email"],
        },
        {
          model: models.Dialogue,
          attributes: ["id", "title"],
          include: [
            {
              model: models.Domain,
              attributes: ["id", "title"],
              include: [
                {
                  model: models.Language,
                  attributes: ["id", "name"],
                },
              ],
            },
          ],
        },
        {
          model: models.SegmentAttempt,
          include: [
            {
              model: models.Segment,
              attributes: ["id", ["segment_order", "order"], ["text_content", "text"]],
            },
          ],
          order: [["id", "ASC"]],
        },
      ],
    });

    if (!attempt) {
      return res.status(404).json({ success: false, message: "Practice log not found" });
    }

    return res.json({ success: true, data: attempt });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/practice-logs/stats
 * Returns aggregate counts for the practice log summary cards.
 */
export async function getPracticeLogStats(req, res, next) {
  try {
    const [totalAttempts, completedAttempts, uniqueUsers, uniqueDialogues] =
      await Promise.all([
        models.ExamAttempt.count(),
        models.ExamAttempt.count({ where: { status: "completed" } }),
        models.ExamAttempt.count({ distinct: true, col: "userId" }),
        models.ExamAttempt.count({ distinct: true, col: "dialogueId" }),
      ]);

    return res.json({
      success: true,
      data: {
        totalAttempts,
        completedAttempts,
        inProgressAttempts: totalAttempts - completedAttempts,
        uniqueUsers,
        uniqueDialogues,
      },
    });
  } catch (err) {
    return next(err);
  }
}
