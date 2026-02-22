import express from "express";
import {
  createRapidReview,
  getRapidReview,
  listRapidReviews,
  updateRapidReview,
  deleteRapidReview,
  getSegmentsByLanguage,
  getRapidReviewAttemptsByUser
} from "../controllers//rapidReview.js";

const router = express.Router();

router.post("/", createRapidReview);
router.get("/", listRapidReviews);
router.get("/:id", getRapidReview);
router.put("/:id", updateRapidReview);
router.get("/segments/:languageId", getSegmentsByLanguage);
router.delete("/:id", deleteRapidReview);
router.get("/attempts/user/:userId", getRapidReviewAttemptsByUser);

export default router;
