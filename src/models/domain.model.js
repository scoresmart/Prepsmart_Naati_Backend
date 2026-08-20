import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const Domain = sequelize.define(
  "Domain",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(160), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    difficulty: { type: DataTypes.ENUM("easy", "medium", "hard"), allowNull: false, defaultValue: "easy" },
    colorCode: { type: DataTypes.STRING(20), allowNull: true },
    languageId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false }
  },
  {
    tableName: "domains",
    timestamps: true,
    underscored: true
  }
);
