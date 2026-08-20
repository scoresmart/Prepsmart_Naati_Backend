import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const MockTestResult = sequelize.define(
  "MockTestResult",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },

    mockTestSessionId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "mock_test_session_id",
    },

    mockTestId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "mock_test_id",
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

    status: {
      type: DataTypes.ENUM("pending", "completed"),
      allowNull: false,
      defaultValue: "pending",
    },

    maxMarks: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      field: "max_marks",
    },
    obtainedMarks: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      field: "obtained_marks",
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
      allowNull: true,
      defaultValue: 1,
      field: "repeat_count",
    },
  },
  {
    tableName: "mockTest_result",
    underscored: true,
    timestamps: true,
    indexes: [
      { unique: true, fields: ["mock_test_session_id", "segment_id"] },
      { fields: ["mock_test_id", "user_id"] },
      { fields: ["mock_test_session_id", "status"] },
    ],
  },
);

export default MockTestResult;
