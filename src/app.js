  // app.js
  import express from "express";
  import cors from "cors";
  import { apiRouter } from "./routes/index.js";
  import { notFound, errorHandler } from "./middleware/error.js";
  import { stripeWebhook } from "./controllers/stripe.controller.js";
  import { env } from "./config/env.js";

  const allowedOrigins = [
    "https://naati.prepsmart.au",
    "https://api.prepsmart.au",
    "https://134bcc98-2de2-4e52-9698-56e0fec0776e.lovableproject.com",
    "https://ditto-ui-engine.lovable.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  export const app = express();

  app.use(
    cors({
      origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.log("CORS blocked origin:", origin);
          callback(null, true); // Allow all for now, but log unknown origins
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
    })
  );
  
  app.options("*", cors({ origin: allowedOrigins, credentials: true }));


  app.post(
    "/api/v1/stripe/webhook",
    express.raw({ type: "application/json" }),
    stripeWebhook
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/v1", apiRouter);

  app.use(notFound);
  app.use(errorHandler);
