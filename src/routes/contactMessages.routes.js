// routes/contactMessages.routes.js
import { Router } from "express";
import {
  createContactMessage,
  getAllContactMessages,
  getContactMessageById,
  updateContactMessage,
  deleteContactMessage,
} from "../controllers/contactus.controller.js";

const router = Router();

router.post("/", createContactMessage);
router.get("/", getAllContactMessages);
router.get("/:id", getContactMessageById);
router.put("/:id", updateContactMessage);
router.patch("/:id", updateContactMessage);
router.delete("/:id", deleteContactMessage);

export default router;
