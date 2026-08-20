import { Router } from "express";
import multer from "multer";
import { runAiExam } from "../controllers/mockTest.js";
import { requireAuth } from "../middleware/auth.js";
import { runAiRapidReview } from "../controllers/rapidReviewTest.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/ai-exam", upload.single("userAudio"), runAiExam);
router.post("/rapid-review/ai", upload.single("userAudio"), runAiRapidReview);

export default router;
