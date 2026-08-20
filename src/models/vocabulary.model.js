import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

const Vocabulary = sequelize.define(
  "Vocabulary",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    languageId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "language_id",
    },

    originalWord: {
      type: DataTypes.STRING(600),
      allowNull: false,
      field: "original_word",
    },

    convertedWord: {
      type: DataTypes.STRING(600),
      allowNull: false,
      field: "converted_word",
    },

    originalAudioUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "original_audio_url",
    },

    convertedAudioUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "converted_audio_url",
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "description",
    },
  },
  {
    tableName: "vocabulary",
    underscored: true,
    timestamps: true,
  },
);

export default Vocabulary;
