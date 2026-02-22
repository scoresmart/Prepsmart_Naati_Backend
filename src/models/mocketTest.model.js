import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const MockTest = sequelize.define(
  "MockTest",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    title: { type: DataTypes.STRING(600), allowNull: false },

    languageId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "language_id",
    },

    dialogueId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "dialogue_id",
    },
    dialogueId2: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      field: "dialogue_id_2",
    },

    durationSeconds: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 1200,
      field: "duration_seconds",
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
  },
  {
    tableName: "mockTest",
    underscored: true,
    timestamps: true,
  }
);

export default MockTest;
