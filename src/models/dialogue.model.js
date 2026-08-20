import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const Dialogue = sequelize.define(
  "Dialogue",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    domainId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    languageId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    duration: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 1200,
    },
    difficulty: {
      type: DataTypes.ENUM("easy", "medium", "hard"),
      allowNull: false,
      defaultValue: "easy",
    },
  },
  {
    tableName: "dialogues",
    timestamps: true,
    underscored: true,
  }
);
