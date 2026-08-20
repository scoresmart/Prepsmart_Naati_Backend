import { models } from "../models/index.js";

export async function listLanguages(req, res, next) {
  try {
    const languages = await models.Language.findAll({
      order: [["id", "DESC"]],
    });
    return res.json({ success: true, data: { languages } });
  } catch (e) {
    return next(e);
  }
}

export async function listDomainsByLanguage(req, res, next) {
  try {
    const languageId = req.params.languageId;
    const language = await models.Language.findByPk(languageId);
    if (!language)
      return res
        .status(404)
        .json({ success: false, message: "Language not found" });

    const domains = await models.Domain.findAll({
      where: { languageId },
      order: [["id", "DESC"]],
    });

    return res.json({ success: true, data: { language, domains } });
  } catch (e) {
    return next(e);
  }
}

export async function listDialoguesByLanguage(req, res, next) {
  try {
    const languageId = req.params.languageId;
    const domainId = req.query.domainId;

    const language = await models.Language.findByPk(languageId);
    if (!language)
      return res
        .status(404)
        .json({ success: false, message: "Language not found" });

    const where = { languageId };
    if (domainId) where.domainId = domainId;

    const dialogues = await models.Dialogue.findAll({
      where,
      order: [["id", "DESC"]],
      include: [{ model: models.Domain }, { model: models.Language }],
    });

    return res.json({ success: true, data: { dialogues } });
  } catch (e) {
    return next(e);
  }
}

export async function getDialogueWithSegments(req, res, next) {
  try {
    const dialogueId = req.params.dialogueId;

    const dialogue = await models.Dialogue.findByPk(dialogueId, {
      include: [
        { model: models.Domain },
        { model: models.Language },
        {
          model: models.Segment,
          separate: true,
          order: [["segmentOrder", "ASC"]],
        },
      ],
    });

    if (!dialogue)
      return res
        .status(404)
        .json({ success: false, message: "Dialogue not found" });

    return res.json({ success: true, data: { dialogue } });
  } catch (e) {
    return next(e);
  }
}
