import { models } from "../models/index.js";

export async function createLanguage(req, res, next) {
  try {
    const { name, langCode } = req.body;
    if (!name || !langCode) return res.status(400).json({ success: false, message: "Missing fields" });

    const exists = await models.Language.findOne({ where: { langCode } });
    if (exists) return res.status(409).json({ success: false, message: "langCode already exists" });

    const language = await models.Language.create({ name, langCode });
    return res.status(201).json({ success: true, data: { language } });
  } catch (e) {
    return next(e);
  }
}

export async function listLanguages(req, res, next) {
  try {
    const languages = await models.Language.findAll({ order: [["id", "DESC"]] });
    return res.json({ success: true, data: { languages } });
  } catch (e) {
    return next(e);
  }
}

export async function getLanguage(req, res, next) {
  try {
    const language = await models.Language.findByPk(req.params.id);
    if (!language) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: { language } });
  } catch (e) {
    return next(e);
  }
}

export async function updateLanguage(req, res, next) {
  try {
    const { name, langCode } = req.body;
    const language = await models.Language.findByPk(req.params.id);
    if (!language) return res.status(404).json({ success: false, message: "Not found" });

    if (langCode && langCode !== language.langCode) {
      const exists = await models.Language.findOne({ where: { langCode } });
      if (exists) return res.status(409).json({ success: false, message: "langCode already exists" });
      language.langCode = langCode;
    }

    if (name !== undefined) language.name = name;

    await language.save();
    return res.json({ success: true, data: { language } });
  } catch (e) {
    return next(e);
  }
}

export async function deleteLanguage(req, res, next) {
  try {
    const language = await models.Language.findByPk(req.params.id);
    if (!language) return res.status(404).json({ success: false, message: "Not found" });
    await language.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (e) {
    return next(e);
  }
}
