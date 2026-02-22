import { models } from "../models/index.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateOtp, otpExpiryDate, isOtpValid } from "../utils/otp.js";
import { signJwt } from "../utils/jwt.js";
import { env } from "../config/env.js";
import sendEmailFunc, { sendOtpEmail, sendWelcomeEmail } from "../utils/email.js";

function safeUser(user, language) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    preferredLanguage: language
      ? { id: language.id, name: language.name, langCode: language.langCode }
      : null,
    naatiCclExamDate: user.naatiCclExamDate,
    accountExpiry: user.accountExpiry ?? null,
    subscriptionPlan: user.subscriptionPlan ?? null,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: user.role,
  };
}

async function getLanguageByCode(langCode) {
  if (!langCode) return null;
  return models.Language.findOne({
    where: { langCode },
    attributes: ["id", "name", "langCode"],
  });
}

export async function register(req, res, next) {
  try {
    const { name, email, phone, password, naatiCclExamDate } = req.body;
    const preferredLanguage = req.body.preferredLanguage ?? req.body.langCode;

    if (!name || !email || !phone || !password || !preferredLanguage) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const language = await getLanguageByCode(preferredLanguage);
    if (!language) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid language code" });
    }

    const exists = await models.User.findOne({ where: { email } });
    if (exists)
      return res
        .status(409)
        .json({ success: false, message: "Email already in use" });

    const existsPhone = await models.User.findOne({ where: { phone } });
    if (existsPhone)
      return res
        .status(409)
        .json({ success: false, message: "Phone already in use" });

    const passwordHash = await hashPassword(password);

    const otp = generateOtp();
    const user = await models.User.create({
      name,
      email,
      phone,
      passwordHash,
      preferredLanguage: language.langCode,
      naatiCclExamDate: naatiCclExamDate || null,
      otpCode: otp,
      otpExpiresAt: otpExpiryDate(),
      isVerified: false,
    });

    // Send OTP verification email via Resend
    sendOtpEmail(email, otp, "verify");

    const data = { user: safeUser(user, language) };
    if (env.appEnv === "development") data.otp = otp;

    return res
      .status(201)
      .json({ success: true, message: "Registered. Verify OTP.", data });
  } catch (err) {
    console.log(err);
    return next(err);
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res
        .status(400)
        .json({ success: false, message: "Missing email or otp" });

    const user = await models.User.findOne({ where: { email } });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const ok = isOtpValid(user.otpCode, user.otpExpiresAt, otp);
    if (!ok)
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });

    user.isVerified = true;
    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    // Send welcome email after successful verification via Resend
    sendWelcomeEmail(email, user.name);

    const token = signJwt({ role: "user", userId: user.id });

    return res.json({
      success: true,
      message: "Verified",
      data: { token, user: safeUser(user) },
    });
  } catch (err) {
    return next(err);
  }
}

export async function resendOtp(req, res, next) {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Missing email" });

    const user = await models.User.findOne({ where: { email } });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    if (user.isVerified)
      return res
        .status(400)
        .json({ success: false, message: "Already verified" });

    const otp = generateOtp();
    user.otpCode = otp;
    user.otpExpiresAt = otpExpiryDate();
    await user.save();

    // Send OTP verification email via Resend
    sendOtpEmail(email, otp, "verify");

    const data = {};
    if (env.appEnv === "development") data.otp = otp;

    return res.json({ success: true, message: "OTP resent", data });
  } catch (err) {
    return next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { emailOrPhone, password } = req.body;
    if (!emailOrPhone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Missing credentials" });
    }

    const user = await models.User.findOne({
      where: emailOrPhone.includes("@")
        ? { email: emailOrPhone }
        : { phone: emailOrPhone },
    });

    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const language = await getLanguageByCode(user.preferredLanguage);

    if (!user.isVerified) {
      return res.status(200).json({
        success: false,
        message: "Verify OTP first",
        user: safeUser(user, language),
      });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok)
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });

    const token = signJwt({ role: user.role, userId: user.id });

    return res.json({
      success: true,
      message: "Logged in",
      data: { token, user: safeUser(user, language) },
    });
  } catch (err) {
    return next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Missing email" });

    const user = await models.User.findOne({ where: { email } });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const otp = generateOtp();

    // Send reset OTP email via Resend
    sendOtpEmail(email, otp, "reset");

    user.resetOtpCode = otp;
    user.resetOtpExpiresAt = otpExpiryDate();
    await user.save();

    const data = {};
    if (env.appEnv === "development") data.otp = otp;

    return res.json({ success: true, message: "Reset OTP sent", data });
  } catch (err) {
    return next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const user = await models.User.findOne({ where: { email } });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const ok = isOtpValid(user.resetOtpCode, user.resetOtpExpiresAt, otp);
    if (!ok)
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });

    user.passwordHash = await hashPassword(newPassword);
    user.resetOtpCode = null;
    user.resetOtpExpiresAt = null;
    await user.save();

    return res.json({ success: true, message: "Password updated" });
  } catch (err) {
    return next(err);
  }
}

export async function me(req, res, next) {
  try {
    if (!req.auth || !req.auth.userId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    const user = await models.User.findByPk(req.auth.userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const language = await getLanguageByCode(user.preferredLanguage);
    return res.json({ success: true, data: { user: safeUser(user, language) } });
  } catch (err) {
    return next(err);
  }
}

// Admin impersonation - sign in as any user
export async function adminLoginAsUser(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userId)
      return res.status(400).json({ success: false, message: "userId required" });

    const user = await models.User.findByPk(userId);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    const language = await getLanguageByCode(user.preferredLanguage);
    const token = signJwt({ role: user.role, userId: user.id });

    return res.json({
      success: true,
      message: "Logged in as user",
      data: { token, user: safeUser(user, language) },
    });
  } catch (err) {
    return next(err);
  }
}
