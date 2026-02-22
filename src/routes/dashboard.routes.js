import { Router } from "express";
import { getUserDashboardKpis } from "../controllers/dashboardKpi.controller.js";

const router = Router();

router.get("/users/:userId/kpis", getUserDashboardKpis);

export default router;
