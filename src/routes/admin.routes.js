import { Router } from "express";
import { adminLogin } from "../controllers/admin.controller.js";
import { adminContentRouter } from "./admin.content.routes.js";

export const adminRouter = Router();

adminRouter.post("/login", adminLogin);
adminRouter.use("/", adminContentRouter);
