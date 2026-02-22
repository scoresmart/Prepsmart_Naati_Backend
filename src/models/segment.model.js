import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const Segment = sequelize.define(
  "Segment",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    dialogueId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    textContent: { type: DataTypes.TEXT, allowNull: false },
    audioUrl: { type: DataTypes.STRING(600), allowNull: true },
    suggestedAudioUrl: { type: DataTypes.STRING(600), allowNull: true },
    segmentOrder: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }
  },
  {
    tableName: "segments",
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ["dialogue_id", "segment_order"] }]
  }
);
