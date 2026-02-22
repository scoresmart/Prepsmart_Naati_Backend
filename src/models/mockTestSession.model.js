import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const MockTestSession = sequelize.define(
  "MockTestSession",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
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

    status: {
      type: DataTypes.ENUM("in_progress", "completed"),
      allowNull: false,
      defaultValue: "in_progress",
    },

    totalMarks: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 90,
      field: "total_marks",
    },
    passMarks: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 63,
      field: "pass_marks",
    },

    totalScore: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      field: "total_score",
    },
    passed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "started_at",
    },
    completedSeconds: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      field: "completedSeconds",
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "completed_at",
    },
  },
  {
    tableName: "mock_test_sessions",
    underscored: true,
    timestamps: true,
    indexes: [
      { fields: ["mock_test_id", "user_id"] },
      { fields: ["user_id", "status"] },
    ],
  }
);

export default MockTestSession;
