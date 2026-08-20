import dotenv from "dotenv";

dotenv.config();

export const env = {
  appEnv: process.env.APP_ENV || "development",
  port: Number(process.env.PORT || 4000),

  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || "prepsmart",
    user: process.env.DB_USER || "root",
    pass: process.env.DB_PASS || "",
  },

  jwt: {
    secret: process.env.JWT_SECRET || "secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  admin: {
    email: process.env.ADMIN_EMAIL || "",
    password: process.env.ADMIN_PASSWORD || "",
  },

  otp: {
    expiresMinutes: Number(process.env.OTP_EXPIRES_MINUTES || 10),
  },
};
