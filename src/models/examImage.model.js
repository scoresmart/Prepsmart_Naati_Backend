import { DataTypes } from "sequelize";
import {sequelize} from "../config/db.js";

const ExamImage = sequelize.define(
  "ExamImage",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    examAttemptId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    segmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    fileName: { type: DataTypes.STRING(255), allowNull: true },
    mimeType: { type: DataTypes.STRING(100), allowNull: false },
    imageData: { type: DataTypes.BLOB("long"), allowNull: false }
  },
  { tableName: "exam_images", underscored: true, timestamps: true }
);

export default ExamImage;
