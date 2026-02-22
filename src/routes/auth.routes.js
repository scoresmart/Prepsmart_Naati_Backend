import { Router } from "express";
import { register, verifyOtp, resendOtp, login, forgotPassword, resetPassword, me, adminLoginAsUser } from "../controllers/auth.controller.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/verify-otp", verifyOtp);
authRouter.post("/resend-otp", resendOtp);
authRouter.post("/login", login);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.get("/me", requireAuth, me);
authRouter.post("/login-as-user", requireAuth, requireAdmin, adminLoginAsUser);
