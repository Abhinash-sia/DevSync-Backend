import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";

import authRoutes from "./routes/auth.routes.js";
import matchRoutes from "./routes/match.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import gigRoutes from "./routes/gig.routes.js";
import profileRoutes from "./routes/profile.routes.js";

import {
  authLimiter,
  matchLimiter,
  globalLimiter,
} from "./middlewares/rateLimiter.js";
import logger from "./utils/logger.js";

const app = express();

// Security Middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(mongoSanitize());

// Rate Limiting
app.use(globalLimiter);

// Body Parsing & Cookies
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

// API Routes
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/match", matchLimiter, matchRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/gig", gigRoutes);
app.use("/api/v1/profile", profileRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() })
})

// 404 Catch-All for undefined API routes
app.all("*", (req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.statusCode = 404;
  next(error);
});

// Global Error Handler
app.use((err, req, res, next) => {
  // If response headers are already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  // Only log 500+ errors (server crashes), ignore 400s (user errors like bad passwords)
  if (statusCode >= 500) {
    logger.error(
      `${statusCode} - ${message} - ${req.originalUrl} - ${req.method}`,
      err
    );
  }

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    errors: err.errors || [],
  });
});

export { app };