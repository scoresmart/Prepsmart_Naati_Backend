import { Router } from "express";
import { createUser, listUsers, getUser, updateUser, deleteUser } from "../controllers/users.controller.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.post("/", requireAuth, requireAdmin, createUser);
usersRouter.get("/", requireAuth, requireAdmin, listUsers);
usersRouter.get("/:id", requireAuth, getUser);
usersRouter.put("/:id", requireAuth, updateUser);
usersRouter.delete("/:id", requireAuth, requireAdmin, deleteUser);
