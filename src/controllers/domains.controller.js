import { models } from "../models/index.js";

export async function createDomain(req, res, next) {
  try {
    const { title, description, difficulty, colorCode, languageId } = req.body;
    if (!title || !languageId) return res.status(400).json({ success: false, message: "Missing fields" });

    const lang = await models.Language.findByPk(languageId);
    if (!lang) return res.status(400).json({ success: false, message: "Invalid languageId" });

    const domain = await models.Domain.create({
      title,
      description: description || null,
      difficulty: difficulty || "easy",
      colorCode: colorCode || null,
      languageId
    });

    return res.status(201).json({ success: true, data: { domain } });
  } catch (e) {
    return next(e);
  }
}

export async function listDomains(req, res, next) {
  try {
    const where = {};
    if (req.query.languageId) where.languageId = req.query.languageId;

    const domains = await models.Domain.findAll({
      where,
      order: [["id", "DESC"]],
      include: [{ model: models.Language }]
    });

    return res.json({ success: true, data: { domains } });
  } catch (e) {
    return next(e);
  }
}

export async function getDomain(req, res, next) {
  try {
    const domain = await models.Domain.findByPk(req.params.id, { include: [{ model: models.Language }] });
    if (!domain) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: { domain } });
  } catch (e) {
    return next(e);
  }
}

export async function updateDomain(req, res, next) {
  try {
    const domain = await models.Domain.findByPk(req.params.id);
    if (!domain) return res.status(404).json({ success: false, message: "Not found" });

    const { title, description, difficulty, colorCode, languageId } = req.body;

    if (languageId !== undefined && String(languageId) !== String(domain.languageId)) {
      const lang = await models.Language.findByPk(languageId);
      if (!lang) return res.status(400).json({ success: false, message: "Invalid languageId" });
      domain.languageId = languageId;
    }

    if (title !== undefined) domain.title = title;
    if (description !== undefined) domain.description = description || null;
    if (difficulty !== undefined) domain.difficulty = difficulty;
    if (colorCode !== undefined) domain.colorCode = colorCode || null;

    await domain.save();
    return res.json({ success: true, data: { domain } });
  } catch (e) {
    return next(e);
  }
}

export async function deleteDomain(req, res, next) {
  try {
    const domain = await models.Domain.findByPk(req.params.id);
    if (!domain) return res.status(404).json({ success: false, message: "Not found" });
    await domain.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (e) {
    return next(e);
  }
}
