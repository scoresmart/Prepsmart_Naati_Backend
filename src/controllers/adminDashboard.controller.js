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
