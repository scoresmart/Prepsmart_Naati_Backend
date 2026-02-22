import { Router } from "express";
import {
  getUserCompletedSeconds,
  getSessionCompletedSeconds,
  incrementSessionCompletedSeconds,
} from "../controllers/mockTestSessionTime.controller.js";

const router = Router();

router.get("/users/:userId/completed-seconds", getUserCompletedSeconds);
router.get("/sessions/:mockTestSessionId/completed-seconds", getSessionCompletedSeconds);
router.patch("/sessions/:mockTestSessionId/completed-seconds/increment", incrementSessionCompletedSeconds);

export default router;
