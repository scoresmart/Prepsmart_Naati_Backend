import express from "express";
import multer from "multer";
import {
  computeMockTestFinalResult,
  getMockTestProgress,
  startMockTest,
  submitMockTestSegment,
} from "../controllers/mockTestFlow.controller.js";

const router = express.Router();
const upload = multer();

router.post("/start", startMockTest);
router.get("/sessions/:mockTestSessionId/progress", getMockTestProgress);
router.post(
  "/segment/submit",
  upload.single("userAudio"),
  submitMockTestSegment,
);
router.get("/sessions/:mockTestSessionId/result", computeMockTestFinalResult);

export default router;
