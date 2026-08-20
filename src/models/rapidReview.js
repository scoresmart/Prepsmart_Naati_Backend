import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const RapidReview = sequelize.define(
  "RapidReview",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    title: {
      type: DataTypes.STRING(600),
      allowNull: false,
    },

    segments: {
      type: DataTypes.JSON,
      allowNull: false,
      field: "segments",
    },

    languageId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "language_id",
    },
  },
  {
    tableName: "rapidReview",
    underscored: true,
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

export default RapidReview;
