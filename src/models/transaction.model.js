import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const Transaction = sequelize.define(
  "Transaction",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },

    userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, field: "user_id" },

    stripeInvoiceId: { type: DataTypes.STRING(64), allowNull: true, unique: true, field: "stripe_invoice_id" },
    stripeCustomerId: { type: DataTypes.STRING(64), allowNull: true, field: "stripe_customer_id" },
    stripeSubscriptionId: { type: DataTypes.STRING(64), allowNull: true, field: "stripe_subscription_id" },

    stripePriceId: { type: DataTypes.STRING(64), allowNull: true, field: "stripe_price_id" },

    amount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, // in cents
    currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "usd" },

    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "pending" }, // paid/failed/pending
    paidAt: { type: DataTypes.DATE, allowNull: true, field: "paid_at" }
  },
  {
    tableName: "transactions",
    timestamps: true,
    underscored: true
  }
);
