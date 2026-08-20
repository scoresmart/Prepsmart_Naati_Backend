  // app.js
  import express from "express";
  import cors from "cors";
  import { apiRouter } from "./routes/index.js";
  import { notFound, errorHandler } from "./middleware/error.js";
  import { stripeWebhook } from "./controllers/stripe.controller.js";
  import { env } from "./config/env.js";

  export const app = express();

  const ALLOWED_ORIGINS = [
    "https://naati.prepsmart.au",
    "http://localhost:8080",
    "http://localhost:8083",
    "http://localhost:5173",
  ];

  const corsOptions = {
    origin: (origin, callback) => {
      // allow requests with no origin (curl, mobile apps, etc.)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));


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
