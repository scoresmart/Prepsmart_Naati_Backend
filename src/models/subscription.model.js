import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const Subscription = sequelize.define(
  "Subscription",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },

    userId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      field: "user_id"
    },

    stripeSubscriptionId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: "stripe_subscription_id"
    },

    stripePriceId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "stripe_price_id"
    },

    status: {
      type: DataTypes.STRING(30), // active, trialing, past_due, canceled...
      allowNull: false,
      defaultValue: "incomplete"
    },

    currentPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "current_period_end"
    },

    cancelAtPeriodEnd: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "cancel_at_period_end"
    },

    stripeCustomerId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "stripe_customer_id"
    },

    languageId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      field: "language_id"
    },

    planType: {
      type: DataTypes.STRING(30),
      allowNull: true,
      field: "plan_type"
    },
  },
  {
    tableName: "subscriptions",
    timestamps: true,
    underscored: true
  }
);
