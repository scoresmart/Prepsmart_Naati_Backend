import { env } from "../config/env.js";

export function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function otpExpiryDate() {
  const ms = env.otp.expiresMinutes * 60 * 1000;
  return new Date(Date.now() + ms);
}

export function isOtpValid(storedCode, storedExpiry, providedCode) {
  if (!storedCode || !storedExpiry) return false;
  if (String(storedCode) !== String(providedCode)) return false;
  return new Date(storedExpiry).getTime() > Date.now();
}
