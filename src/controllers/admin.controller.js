import { env } from "../config/env.js";
import { signJwt } from "../utils/jwt.js";

export async function adminLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Missing credentials" });
  }

  if (email !== env.admin.email || password !== env.admin.password) {
    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  }

  const token = signJwt({ role: "admin" });
  return res.json({ success: true, message: "Admin logged in", data: { token } });
}
