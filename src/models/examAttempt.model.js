import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const ExamAttempt = sequelize.define(
  "ExamAttempt",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    dialogueId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    examType: {
      type: DataTypes.ENUM("rapid_review", "complete_dialogue"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("in_progress", "completed"),
      allowNull: false,
      defaultValue: "in_progress",
    },
    completedSeconds: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0,
      field: "completedSeconds",
    },

    accuracyScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "accuracy_score",
    },
    languageQualityScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "language_quality_score",
    },
    fluencyPronunciationScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "fluency_pronunciation_score",
    },
    deliveryCoherenceScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "delivery_coherence_score",
    },
    culturalControlScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "cultural_control_score",
    },
    responseManagementScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "response_management_score",
    },
    finalScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "final_score",
    },
    totalRawScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "total_raw_score",
    },

    overallFeedback: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "overall_feedback",
    },
    computedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "computed_at",
    },
    segmentCount: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "segment_count",
    },
  },
  { tableName: "exam_attempts", underscored: true, timestamps: true }
);

export default ExamAttempt;
