import { Router } from "express";
import { getTranscriptionComparison } from "../controllers/transcriptionComparison.controller.js";

const router = Router();

// GET /api/v1/transcription-comparison?limit=10
// Returns 3-way transcription comparison (Azure, Whisper, ElevenLabs) for Punjabi audio
router.get("/", getTranscriptionComparison);

export default router;
