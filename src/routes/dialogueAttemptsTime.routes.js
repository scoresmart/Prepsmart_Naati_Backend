import { Router } from "express";
import {
  getAllDialogueTimeByUser,
  getOneDialogueTimeByUser,
  incrementDialogueSeconds,
} from "../controllers/dialogueAttemptsTime.controller.js";

const router = Router();

router.get("/users/:userId/dialogues", getAllDialogueTimeByUser);
router.get("/users/:userId/dialogues/:dialogueId", getOneDialogueTimeByUser);
router.patch("/users/:userId/dialogues/:dialogueId/increment", incrementDialogueSeconds);

export default router;
