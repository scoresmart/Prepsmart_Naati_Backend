import { Router } from "express";
import multer from "multer";
import {
  createVocabulary,
  getVocabularies,
  getVocabularyById,
  updateVocabulary,
  deleteVocabulary,
} from "../controllers/vocabulary.controller.js";

const router = Router();
const upload = multer();

router.post(
  "/",
  upload.fields([
    { name: "originalAudio", maxCount: 1 },
    { name: "convertedAudio", maxCount: 1 },
  ]),
  createVocabulary,
);

router.get("/", getVocabularies);
router.get("/:id", getVocabularyById);

router.put(
  "/:id",
  upload.fields([
    { name: "originalAudio", maxCount: 1 },
    { name: "convertedAudio", maxCount: 1 },
  ]),
  updateVocabulary,
);

router.patch(
  "/:id",
  upload.fields([
    { name: "originalAudio", maxCount: 1 },
    { name: "convertedAudio", maxCount: 1 },
  ]),
  updateVocabulary,
);

router.delete("/:id", deleteVocabulary);

export default router;
