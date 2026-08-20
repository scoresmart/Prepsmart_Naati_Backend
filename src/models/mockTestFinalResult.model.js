import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const MockTestFinalResult = sequelize.define(
  "MockTestFinalResult",
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
      unique: true,
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

    totalScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      field: "total_score",
    },

    dialogue1Score: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      field: "dialogue1_score",
    },

    dialogue2Score: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      field: "dialogue2_score",
    },

    outOf: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 90,
      field: "out_of",
    },

    passMarks: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 63,
      field: "pass_marks",
    },

    perDialogueOutOf: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 45,
      field: "per_dialogue_out_of",
    },

    perDialoguePass: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 31,
      field: "per_dialogue_pass",
    },

    passed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    averages: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    overallFeedback: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "overall_feedback",
    },

    computedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "computed_at",
    },
  },
  {
    tableName: "mock_test_final_results",
    underscored: true,
    timestamps: true,
    indexes: [
      { unique: true, fields: ["mock_test_session_id"] },
      { fields: ["user_id"] },
      { fields: ["mock_test_id"] },
      { fields: ["user_id", "passed"] },
    ],
  },
);

export default MockTestFinalResult;
