import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { createLanguage, listLanguages, getLanguage, updateLanguage, deleteLanguage } from "../controllers/languages.controller.js";
import { createDomain, listDomains, getDomain, updateDomain, deleteDomain } from "../controllers/domains.controller.js";
import { createDialogue, listDialogues, getDialogue, updateDialogue, deleteDialogue } from "../controllers/dialogues.controller.js";
import { createSegment, listSegments, getSegment, updateSegment, deleteSegment } from "../controllers/segments.controller.js";
import { getDashboardCounts } from "../controllers/adminDashboard.controller.js";
import multer from "multer";
const upload = multer({
    storage: multer.memoryStorage()
  });
export const adminContentRouter = Router();
import getDashboardStats from "../controllers/dashboard.controller.js";
adminContentRouter.use(requireAuth, requireAdmin);

adminContentRouter.get("/dashboard", getDashboardStats);

adminContentRouter.post("/languages", createLanguage);
adminContentRouter.get("/languages", listLanguages);
adminContentRouter.get("/languages/:id", getLanguage);
adminContentRouter.put("/languages/:id", updateLanguage);
adminContentRouter.delete("/languages/:id", deleteLanguage);

adminContentRouter.post("/domains", createDomain);
adminContentRouter.get("/domains", listDomains);
adminContentRouter.get("/domains/:id", getDomain);
adminContentRouter.put("/domains/:id", updateDomain);
adminContentRouter.delete("/domains/:id", deleteDomain);

adminContentRouter.post("/dialogues", createDialogue);
adminContentRouter.get("/dialogues", listDialogues);
adminContentRouter.get("/dialogues/:id", getDialogue);
adminContentRouter.put("/dialogues/:id", updateDialogue);
adminContentRouter.delete("/dialogues/:id", deleteDialogue);

// adminContentRouter.post("/segments", createSegment);
adminContentRouter.get("/segments", listSegments);
adminContentRouter.get("/segments/:id", getSegment);
adminContentRouter.put("/segments/:id", updateSegment);
adminContentRouter.delete("/segments/:id", deleteSegment);

adminContentRouter.post(
    "/segments",
    upload.fields([
      { name: "audioUrl", maxCount: 1 },
      { name: "suggestedAudioUrl", maxCount: 1 }
    ]),
    createSegment
  );