// routes/mockTest.routes.js
import { Router } from "express";
import {
  createMockTest,
  getMockTests,
  getMockTestById,
  updateMockTest,
  deleteMockTest,
} from "../controllers/mockTest.controller.js";

const router = Router();

// CRUD
router.post("/", createMockTest);
router.get("/", getMockTests);
router.get("/:id", getMockTestById);
router.put("/:id", updateMockTest);
router.patch("/:id", updateMockTest);
router.delete("/:id", deleteMockTest);

export default router;
