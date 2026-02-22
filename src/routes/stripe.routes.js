import express from "express";
import {
  createCheckoutSession,
  verifyCheckoutSession,
  stripeWebhook,
  cancelUserSubscription 
} from "../controllers/stripe.controller.js";

const stripeRouter = express.Router();

stripeRouter.post("/checkout/session", createCheckoutSession);
stripeRouter.post("/checkout/verify", verifyCheckoutSession);
stripeRouter.patch("/subscriptions/cancel/:subscriptionId", cancelUserSubscription);

// stripeRouter.post(
//   "/webhook",
//   express.raw({ type: "application/json" }),
//   stripeWebhook
// );

export default stripeRouter;
