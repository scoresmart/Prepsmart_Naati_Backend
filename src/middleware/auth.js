import { env } from "../config/env.js";
import { verifyJwt } from "../utils/jwt.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    if (env.appEnv === "development") return next();
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    req.auth = verifyJwt(token);
    // Controllers read req.user; expose the JWT identity there too.
    req.user = { id: req.auth.userId, role: req.auth.role };
    return next();
  } catch {
    if (env.appEnv === "development") return next();
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

export function requireAdmin(req, res, next) {
  if (env.appEnv === "development") return next();

  if (!req.auth || req.auth.role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  return next();
}
