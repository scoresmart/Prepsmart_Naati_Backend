import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../config/db.js";
import { models } from "../models/index.js";

function parseRange(query) {
  const hasRange = Boolean(query.from || query.to);
  if (!hasRange) return { hasRange: false };

  const now = new Date();
  const toDate = query.to ? new Date(query.to) : now;
  const fromDate = query.from
    ? new Date(query.from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  toDate.setHours(23, 59, 59, 999);
  return { hasRange: true, fromDate, toDate };
}

function tableName(Model) {
  const t = Model.getTableName();
  return typeof t === "string" ? t : t.tableName;
}

function qn(name) {
  return `\`${name}\``;
}

export default async function getAdminSummary(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit || 10), 50);
    const minAttempts = Math.max(Number(req.query.minAttempts || 3), 1);

    const range = parseRange(req.query);

    const usersTable = qn(tableName(models.User));
    const txTable = qn(tableName(models.Transaction));
    const subsTable = qn(tableName(models.Subscription));
    const dialoguesTable = qn(tableName(models.Dialogue));
    const languagesTable = qn(tableName(models.Language));
    const examAttemptsTable = qn(tableName(models.ExamAttempt));
    const segAttemptsTable = qn(tableName(models.SegmentAttempt));

    const txWhere = range.hasRange
      ? { paidAt: { [Op.between]: [range.fromDate, range.toDate] } }
      : {};

    const [
      totalUsers,
      totalDialogues,
      totalLanguages,
      totalTransactionsCount,
      paidTransactionsCount,
      paidMoneyCents,
      activeSubscriptions,
    ] = await Promise.all([
      models.User.count(),
      models.Dialogue.count(),
      models.Language.count(),
      models.Transaction.count(),
      models.Transaction.count({ where: { status: "paid", ...txWhere } }),
      models.Transaction.sum("amount", {
        where: { status: "paid", ...txWhere },
      }),
      models.Subscription.count({
        where: { status: { [Op.in]: ["active", "trialing"] } },
      }),
    ]);

    const examWhereSql = range.hasRange
      ? "WHERE ea.created_at BETWEEN :from AND :to"
      : "";
    const segWhereSql = range.hasRange
      ? "AND sa.created_at BETWEEN :from AND :to"
      : "";
    const repl = range.hasRange
      ? { from: range.fromDate, to: range.toDate }
      : {};

    const topDialoguesCounts = await sequelize.query(
      `SELECT ea.dialogue_id AS dialogueId, COUNT(*) AS attempts
       FROM ${examAttemptsTable} ea
       ${examWhereSql}
       GROUP BY ea.dialogue_id
       ORDER BY attempts DESC
       LIMIT ${Number(limit)}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const topDialogueIds = topDialoguesCounts.map((x) => x.dialogueId);
    const dialogues = topDialogueIds.length
      ? await models.Dialogue.findAll({
          where: { id: topDialogueIds },
          attributes: ["id", "title"],
          raw: true,
        })
      : [];
    const dialogueMap = new Map(dialogues.map((d) => [String(d.id), d]));

    const topDialogues = topDialoguesCounts.map((x) => ({
      dialogueId: Number(x.dialogueId),
      attempts: Number(x.attempts),
      title: dialogueMap.get(String(x.dialogueId))?.title || null,
    }));

    const topLanguagesCounts = await sequelize.query(
      `SELECT d.language_id AS languageId, COUNT(*) AS attempts
       FROM ${examAttemptsTable} ea
       INNER JOIN ${dialoguesTable} d ON d.id = ea.dialogue_id
       ${examWhereSql}
       GROUP BY d.language_id
       ORDER BY attempts DESC
       LIMIT ${Number(limit)}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const topLanguageIds = topLanguagesCounts.map((x) => x.languageId);
    const langs = topLanguageIds.length
      ? await models.Language.findAll({
          where: { id: topLanguageIds },
          attributes: ["id", "name", "langCode"],
          raw: true,
        })
      : [];
    const langMap = new Map(langs.map((l) => [String(l.id), l]));

    const topLanguages = topLanguagesCounts.map((x) => ({
      languageId: Number(x.languageId),
      attempts: Number(x.attempts),
      name: langMap.get(String(x.languageId))?.name || null,
      langCode: langMap.get(String(x.languageId))?.langCode || null,
    }));

    const topPerformers = await sequelize.query(
      `SELECT sa.user_id AS userId, COUNT(*) AS attempts, AVG(sa.final_score) AS avgFinalScore
       FROM ${segAttemptsTable} sa
       WHERE sa.final_score IS NOT NULL ${segWhereSql}
       GROUP BY sa.user_id
       HAVING attempts >= ${Number(minAttempts)}
       ORDER BY avgFinalScore DESC, attempts DESC
       LIMIT ${Number(limit)}`,
      { replacements: repl, type: QueryTypes.SELECT }
    );

    const moneyCents = Number(paidMoneyCents || 0);

    return res.json({
      success: true,
      range: range.hasRange
        ? { from: range.fromDate.toISOString(), to: range.toDate.toISOString() }
        : null,
      totals: {
        users: totalUsers - 1,
        dialogues: totalDialogues,
        languages: totalLanguages,
        activeSubscriptions,
        transactions: {
          totalCount: totalTransactionsCount,
          paidCount: paidTransactionsCount,
          paidMoneyCents: moneyCents,
          paidMoney: moneyCents / 100,
        },
      },
      top: {
        usedDialogues: topDialogues,
        usedLanguages: topLanguages,
        performerUsers: topPerformers.map((r) => ({
          userId: Number(r.userId),
          attempts: Number(r.attempts),
          avgFinalScore: Number(r.avgFinalScore || 0),
        })),
      },
    });
  } catch (e) {
    return res
      .status(500)
      .json({
        success: false,
        message: "Admin summary failed",
        error: e?.message || "Unknown",
      });
  }
}
