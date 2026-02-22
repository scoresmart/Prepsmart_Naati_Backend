import express from "express";
import {
  getMockTestFinalResultBySession,
  listUserMockTestFinalResults,
} from "../controllers/mockTestFinalResult.controller.js";

const router = express.Router();

router.get(
  "/mock-tests/sessions/:mockTestSessionId/final-result",
  getMockTestFinalResultBySession,
);
router.get(
  "/mock-tests/users/:userId/final-results",
  listUserMockTestFinalResults,
);

export default router;
