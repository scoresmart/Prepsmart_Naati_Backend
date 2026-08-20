import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  listLanguages,
  listDomainsByLanguage,
  listDialoguesByLanguage,
  getDialogueWithSegments
} from "../controllers/contentBrowse.controller.js";

export const contentRouter = Router();

contentRouter.use(requireAuth);

contentRouter.get("/languages", listLanguages);
contentRouter.get("/languages/:languageId/domains", listDomainsByLanguage);
contentRouter.get("/languages/:languageId/dialogues", listDialoguesByLanguage);
contentRouter.get("/dialogues/:dialogueId", getDialogueWithSegments);
