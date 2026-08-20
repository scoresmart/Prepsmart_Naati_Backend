import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const ContactMessage = sequelize.define(
  "ContactMessage",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    firstName: { type: DataTypes.STRING(80), allowNull: false },
    lastName: { type: DataTypes.STRING(80), allowNull: true },

    email: { type: DataTypes.STRING(160), allowNull: false },
    phoneNumber: { type: DataTypes.STRING(30), allowNull: true },

    subject: { type: DataTypes.STRING(200), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
  },
  {
    tableName: "contact_messages",
    timestamps: true, // creates createdAt, updatedAt
    underscored: true, // created_at, updated_at + snake_case columns
  }
);
