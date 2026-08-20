import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { startExam, listUserExams, getExam, deleteExam, computeResult, getExamAttemptDetails } from "../controllers/exams.controller.js";

const router = Router();

router.post("/", startExam);
router.get("/", requireAuth, listUserExams);
router.get("/:examAttemptId", requireAuth, getExam);
router.get("/computeResult/:examAttemptId", computeResult);
router.post("/:examAttemptId/segments/:segmentId/attempts", requireAuth, deleteExam);
router.get("/exam-attempts/:examAttemptId", getExamAttemptDetails);


export default router;
