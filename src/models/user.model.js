import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    phone: { type: DataTypes.STRING(40), allowNull: false, unique: true },

    passwordHash: { type: DataTypes.STRING(255), allowNull: false },

    preferredLanguage: { type: DataTypes.STRING(60), allowNull: false },
    naatiCclExamDate: { type: DataTypes.DATEONLY, allowNull: true },

    isVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    stripeCustomerId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      // unique: true,
      field: "stripe_customer_id",
    },
    otpCode: { type: DataTypes.STRING(10), allowNull: true },
    otpExpiresAt: { type: DataTypes.DATE, allowNull: true },
    role: {
      type: DataTypes.ENUM("admin", "user"),
      allowNull: false,
      defaultValue: "user",
    },

    resetOtpCode: { type: DataTypes.STRING(10), allowNull: true },
    resetOtpExpiresAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: "users",
    timestamps: true,
    underscored: true,
  },
);
