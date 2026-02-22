import { models } from "../models/index.js";
import sendEmailFunc from "../utils/email.js";
import { hashPassword } from "../utils/password.js";

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    preferredLanguage: user.preferredLanguage,
    naatiCclExamDate: user.naatiCclExamDate,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: user.role
  };
}

export async function createUser(req, res, next) {
  try {
    const { name, email, phone, password, preferredLanguage, naatiCclExamDate, isVerified, role } = req.body;

    if (!name || !email || !phone || !password || !preferredLanguage) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const exists = await models.User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ success: false, message: "Email already in use" });

    const existsPhone = await models.User.findOne({ where: { phone } });
    if (existsPhone) return res.status(409).json({ success: false, message: "Phone already in use" });

    const user = await models.User.create({
      name,
      email,
      phone,
      passwordHash: await hashPassword(password),
      preferredLanguage,
      naatiCclExamDate: naatiCclExamDate || null,
      isVerified: Boolean(isVerified),
      role,
    });
    return res.status(201).json({ success: true, data: { user: safeUser(user) } });
  } catch (err) {
    return next(err);
  }
}

export async function listUsers(req, res, next) {
  try {
    const users = await models.User.findAll({ order: [["id", "DESC"]], where: { role: "user" } });
    return res.json({ success: true, data: { users: users.map(safeUser) } });
  } catch (err) {
    return next(err);
  }
}

export async function getUser(req, res, next) {
  try {
    const id = req.params.id;
    const user = await models.User.findByPk(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });


    return res.json({ success: true, data: { user: safeUser(user) } });
  } catch (err) {
    return next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const id = req.params.id;
    const user = await models.User.findByPk(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });


    const { name, phone, preferredLanguage, naatiCclExamDate, password, isVerified, role } = req.body;

    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (preferredLanguage !== undefined) user.preferredLanguage = preferredLanguage;
    if (naatiCclExamDate !== undefined) user.naatiCclExamDate = naatiCclExamDate || null;
    if(role !== undefined) user.role = role;
    if (password !== undefined) user.passwordHash = await hashPassword(password);
    if (isVerified !== undefined ) user.isVerified = Boolean(isVerified);

    await user.save();
    return res.json({ success: true, data: { user: safeUser(user) } });
  } catch (err) {
    return next(err);
  }
}

export async function deleteUser(req, res, next) {
  try {
    const id = req.params.id;
    const user = await models.User.findByPk(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await user.destroy();
    return res.json({ success: true, message: "Deleted" });
  } catch (err) {
    return next(err);
  }
}
