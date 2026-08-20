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

  // Which vendor the scoring flows transcribe with: "elevenlabs" (default)
  // or "azure".
  sttProvider: (process.env.STT_PROVIDER || "elevenlabs").toLowerCase(),

  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    sttModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v1",
    ttsModel: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2",
    ttsVoiceId: process.env.ELEVENLABS_TTS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
    ttsFormat: process.env.ELEVENLABS_TTS_FORMAT || "mp3_44100_128",
  },
};
