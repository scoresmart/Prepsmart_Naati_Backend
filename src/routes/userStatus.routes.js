import { Router } from "express";
import { getUserStatus } from "../controllers/userStatus.controller.js";

const router = Router();

router.get("/", getUserStatus);

export default router;
