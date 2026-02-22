import { Op } from "sequelize";
import Vocabulary from "../models/vocabulary.model.js";
import { uploadAudioToS3 } from "../utils/aws.js";
import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.model.js";
const toInt = (v) => {
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

const getFile = (files, key) => {
  const arr = files?.[key];
  if (!arr || !arr.length) return null;
  return arr[0];
};

export const createVocabulary = async (req, res, next) => {
  try {
    const languageId = toInt(pick(req.body, "language_id", "languageId"));
    const originalWord = pick(req.body, "originalWord", "original_word");
    const convertedWord = pick(req.body, "convertedWord", "converted_word");
    const description = pick(req.body, "description");

    if (!languageId) {
      return res
        .status(400)
        .json({ success: false, message: "languageId is required" });
    }
    if (
      !originalWord ||
      typeof originalWord !== "string" ||
      !originalWord.trim()
    ) {
      return res
        .status(400)
        .json({ success: false, message: "originalWord is required" });
    }
    if (
      !convertedWord ||
      typeof convertedWord !== "string" ||
      !convertedWord.trim()
    ) {
      return res
        .status(400)
        .json({ success: false, message: "convertedWord is required" });
    }

    const row = await Vocabulary.create({
      languageId,
      originalWord: originalWord.trim(),
      convertedWord: convertedWord.trim(),
      description: typeof description === "string" ? description.trim() : null,
      originalAudioUrl: null,
      convertedAudioUrl: null,
    });

    const originalAudio = getFile(req.files, "originalAudio");
    const convertedAudio = getFile(req.files, "convertedAudio");

    let originalAudioUrl = row.originalAudioUrl;
    let convertedAudioUrl = row.convertedAudioUrl;

    if (originalAudio?.buffer) {
      const uploaded = await uploadAudioToS3({
        buffer: originalAudio.buffer,
        mimetype: originalAudio.mimetype,
        originalname: originalAudio.originalname,
        keyPrefix: `vocabulary/${row.id}/original`,
      });
      originalAudioUrl = uploaded.url;
    }

    if (convertedAudio?.buffer) {
      const uploaded = await uploadAudioToS3({
        buffer: convertedAudio.buffer,
        mimetype: convertedAudio.mimetype,
        originalname: convertedAudio.originalname,
        keyPrefix: `vocabulary/${row.id}/converted`,
      });
      convertedAudioUrl = uploaded.url;
    }

    if (
      originalAudioUrl !== row.originalAudioUrl ||
      convertedAudioUrl !== row.convertedAudioUrl
    ) {
      await row.update({ originalAudioUrl, convertedAudioUrl });
    }

    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    next(e);
  }
};

export const getVocabularies = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      100
    );
    const offset = (page - 1) * limit;

    const userId = toInt(pick(req.query, "userId", "user_id"));
    const languageId = toInt(
      pick(req.query, "languageId", "language_id", "languageId")
    );

    const where = {};
    if (languageId) where.languageId = languageId;

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q) {
      where[Op.or] = [
        { originalWord: { [Op.like]: `%${q}%` } },
        { convertedWord: { [Op.like]: `%${q}%` } },
      ];
    }

    let isSubscribed = false;

    if (userId) {
      const user = await User.findByPk(userId, { attributes: ["id", "role"] });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.role === "admin") {
        isSubscribed = true;
      } else {
        if (languageId) {
          const sub = await Subscription.findOne({
            where: {
              userId: user.id,
              languageId,
              status: { [Op.in]: ["active", "trialing"] },
              currentPeriodEnd: { [Op.gt]: new Date() },
            },
            order: [["currentPeriodEnd", "DESC"]],
          });

          isSubscribed = !!sub;
        } else {
          isSubscribed = false;
        }
      }
    }

    const { rows, count } = await Vocabulary.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

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
  } catch (e) {
    next(e);
  }
};

export const getVocabularyById = async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id)
      return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Vocabulary.findByPk(id);
    if (!row)
      return res
        .status(404)
        .json({ success: false, message: "Vocabulary not found" });

    return res.json({ success: true, data: row });
  } catch (e) {
    next(e);
  }
};

export const updateVocabulary = async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id)
      return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Vocabulary.findByPk(id);
    if (!row)
      return res
        .status(404)
        .json({ success: false, message: "Vocabulary not found" });

    const languageIdRaw = pick(req.body, "language_id", "languageId");
    const originalWordRaw = pick(req.body, "originalWord", "original_word");
    const convertedWordRaw = pick(req.body, "convertedWord", "converted_word");
    const descriptionRaw = pick(req.body, "description");

    if (languageIdRaw !== undefined) {
      const languageId = toInt(languageIdRaw);
      if (!languageId)
        return res
          .status(400)
          .json({ success: false, message: "Invalid languageId" });
      row.languageId = languageId;
    }

    if (originalWordRaw !== undefined) {
      if (typeof originalWordRaw !== "string" || !originalWordRaw.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "originalWord must be non-empty" });
      }
      row.originalWord = originalWordRaw.trim();
    }

    if (convertedWordRaw !== undefined) {
      if (typeof convertedWordRaw !== "string" || !convertedWordRaw.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "convertedWord must be non-empty" });
      }
      row.convertedWord = convertedWordRaw.trim();
    }

    if (descriptionRaw !== undefined) {
      row.description =
        typeof descriptionRaw === "string" ? descriptionRaw.trim() : null;
    }

    const originalAudio = getFile(req.files, "originalAudio");
    const convertedAudio = getFile(req.files, "convertedAudio");

    if (originalAudio?.buffer) {
      const uploaded = await uploadAudioToS3({
        buffer: originalAudio.buffer,
        mimetype: originalAudio.mimetype,
        originalname: originalAudio.originalname,
        keyPrefix: `vocabulary/${row.id}/original`,
      });
      row.originalAudioUrl = uploaded.url;
    }

    if (convertedAudio?.buffer) {
      const uploaded = await uploadAudioToS3({
        buffer: convertedAudio.buffer,
        mimetype: convertedAudio.mimetype,
        originalname: convertedAudio.originalname,
        keyPrefix: `vocabulary/${row.id}/converted`,
      });
      row.convertedAudioUrl = uploaded.url;
    }

    await row.save();

    return res.json({ success: true, data: row });
  } catch (e) {
    next(e);
  }
};

export const deleteVocabulary = async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id)
      return res.status(400).json({ success: false, message: "Invalid id" });

    const row = await Vocabulary.findByPk(id);
    if (!row)
      return res
        .status(404)
        .json({ success: false, message: "Vocabulary not found" });

    await row.destroy();
    return res.json({
      success: true,
      message: "Vocabulary deleted successfully",
    });
  } catch (e) {
    next(e);
  }
};
