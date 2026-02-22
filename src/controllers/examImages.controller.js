import {models} from "../models/index.js";

const { ExamAttempt, ExamImage, Segment } = models;

const ensureOwnerOrAdmin = (req, ownerId) => {
  if (req.user?.role === "admin") return;
  if (!req.user?.id || req.user.id !== ownerId) {
    const err = new Error("Forbidden");
    err.status = 403;
    throw err;
  }
};

const normalizeBase64 = (s) => {
  if (!s) return null;
  const idx = s.indexOf("base64,");
  if (idx !== -1) return s.slice(idx + 7);
  return s;
};

export const createExamImage = async (req, res, next) => {
  try {
    const { examAttemptId } = req.params;
    const { segmentId, mimeType, fileName, dataBase64 } = req.body;

    if (!mimeType) return res.status(400).json({ message: "mimeType is required" });
    if (!dataBase64) return res.status(400).json({ message: "dataBase64 is required" });

    const attempt = await ExamAttempt.findByPk(examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam attempt not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    if (segmentId) {
      const seg = await Segment.findByPk(segmentId);
      if (!seg) return res.status(404).json({ message: "Segment not found" });
      if (seg.dialogueId !== attempt.dialogueId) return res.status(400).json({ message: "Segment not in this dialogue" });
    }

    const raw = normalizeBase64(dataBase64);
    const buf = Buffer.from(raw, "base64");

    const img = await ExamImage.create({
      userId: attempt.userId,
      examAttemptId,
      segmentId: segmentId || null,
      mimeType,
      fileName: fileName || null,
      imageData: buf
    });

    res.status(201).json({
      image: { id: img.id, examAttemptId: img.examAttemptId, segmentId: img.segmentId, mimeType: img.mimeType, fileName: img.fileName, createdAt: img.createdAt }
    });
  } catch (e) {
    next(e);
  }
};

export const listExamImages = async (req, res, next) => {
  try {
    const { examAttemptId } = req.params;

    const attempt = await ExamAttempt.findByPk(examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam attempt not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    const images = await ExamImage.findAll({
      where: { examAttemptId },
      order: [["createdAt", "DESC"]],
      attributes: ["id", "examAttemptId", "segmentId", "mimeType", "fileName", "createdAt", "updatedAt"]
    });

    res.json({ images });
  } catch (e) {
    next(e);
  }
};

export const getExamImage = async (req, res, next) => {
  try {
    const { imageId } = req.params;

    const img = await ExamImage.findByPk(imageId);
    if (!img) return res.status(404).json({ message: "Image not found" });

    const attempt = await ExamAttempt.findByPk(img.examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam attempt not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    const includeData = String(req.query.includeData || "0") === "1";
    const out = {
      id: img.id,
      examAttemptId: img.examAttemptId,
      segmentId: img.segmentId,
      mimeType: img.mimeType,
      fileName: img.fileName,
      createdAt: img.createdAt,
      updatedAt: img.updatedAt
    };

    if (includeData) out.dataBase64 = Buffer.from(img.imageData).toString("base64");

    res.json({ image: out });
  } catch (e) {
    next(e);
  }
};

export const updateExamImage = async (req, res, next) => {
  try {
    const { imageId } = req.params;
    const { mimeType, fileName, dataBase64 } = req.body;

    const img = await ExamImage.findByPk(imageId);
    if (!img) return res.status(404).json({ message: "Image not found" });

    const attempt = await ExamAttempt.findByPk(img.examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam attempt not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    const patch = {};
    if (mimeType) patch.mimeType = mimeType;
    if (fileName !== undefined) patch.fileName = fileName;

    if (dataBase64) {
      const raw = normalizeBase64(dataBase64);
      patch.imageData = Buffer.from(raw, "base64");
    }

    await img.update(patch);

    res.json({
      image: { id: img.id, examAttemptId: img.examAttemptId, segmentId: img.segmentId, mimeType: img.mimeType, fileName: img.fileName, createdAt: img.createdAt, updatedAt: img.updatedAt }
    });
  } catch (e) {
    next(e);
  }
};

export const deleteExamImage = async (req, res, next) => {
  try {
    const { imageId } = req.params;

    const img = await ExamImage.findByPk(imageId);
    if (!img) return res.status(404).json({ message: "Image not found" });

    const attempt = await ExamAttempt.findByPk(img.examAttemptId);
    if (!attempt) return res.status(404).json({ message: "Exam attempt not found" });

    ensureOwnerOrAdmin(req, attempt.userId);

    await img.destroy();
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
};
