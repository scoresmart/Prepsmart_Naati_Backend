import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const SegmentAttempt = sequelize.define(
  "SegmentAttempt",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },

    examAttemptId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "exam_attempt_id",
    },

    userId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "user_id",
    },

    segmentId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "segment_id",
    },

    audioUrl: { type: DataTypes.TEXT, allowNull: true, field: "audio_url" },
    userTranscription: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "user_transcription",
    },

    aiScores: { type: DataTypes.JSON, allowNull: true, field: "ai_scores" },

    accuracyScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "accuracy_score",
    },
    overallScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "overall_score",
    },
    feedback: { type: DataTypes.TEXT, allowNull: true },

    languageQualityScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "language_quality_score",
    },
    languageQualityText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "language_quality_text",
    },

    fluencyPronunciationScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "fluency_pronunciation_score",
    },
    fluencyPronunciationText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "fluency_pronunciation_text",
    },

    deliveryCoherenceScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "delivery_coherence_score",
    },
    deliveryCoherenceText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "delivery_coherence_text",
    },

    culturalControlScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "cultural_control_score",
    },
    culturalControlText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "cultural_control_text",
    },

    responseManagementScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "response_management_score",
    },
    responseManagementText: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "response_management_text",
    },

    totalRawScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "total_raw_score",
    },
    finalScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "final_score",
    },

    oneLineFeedback: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "one_line_feedback",
    },
    language: { type: DataTypes.TEXT, allowNull: true },

    repeatCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      field: "repeat_count",
    },
  },
  {
    tableName: "segment_attempts",
    underscored: true,
    timestamps: true,
    indexes: [
      {
        name: "uq_segment_attempts_attempt_segment_repeat",
        unique: true,
        fields: ["exam_attempt_id", "segment_id", "repeat_count"], // ✅ real DB columns
      },
    ],
  },
);

export default SegmentAttempt;
