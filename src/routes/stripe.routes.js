import express from "express";
import {
  createCheckoutSession,
  verifyCheckoutSession,
  stripeWebhook,
  cancelUserSubscription,
  resumeUserSubscription,
  previewUpgrade,
  applyUpgrade,
} from "../controllers/stripe.controller.js";

const stripeRouter = express.Router();

stripeRouter.post("/checkout/session", createCheckoutSession);
stripeRouter.post("/checkout/verify", verifyCheckoutSession);
stripeRouter.patch("/subscriptions/cancel/:subscriptionId", cancelUserSubscription);
stripeRouter.patch("/subscriptions/resume/:subscriptionId", resumeUserSubscription);
stripeRouter.post("/subscriptions/upgrade/preview", previewUpgrade);
stripeRouter.post("/subscriptions/upgrade", applyUpgrade);

// stripeRouter.post(
//   "/webhook",
//   express.raw({ type: "application/json" }),
//   stripeWebhook
// );

export default stripeRouter;
