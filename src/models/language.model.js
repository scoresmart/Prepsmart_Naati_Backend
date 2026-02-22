import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const Language = sequelize.define(
  "Language",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    langCode: { type: DataTypes.STRING(10), allowNull: false, unique: true }
  },
  {
    tableName: "languages",
    timestamps: true,
    underscored: true
  }
);
