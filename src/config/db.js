import mongoose from "mongoose";
import logger from "../utils/logger.js";

const log = logger;

const connectDB = async () => {
  // Issue #1 Fix: Validate env variable before doing anything
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    log.error("FATAL: MONGODB_URI is not defined in environment variables.");
    process.exit(1);
  }

  try {
    // Issue #3 Fix: Set timeout to fail fast instead of hanging 30s
    // Issue #6 Fix: Explicit dbName prevents silent 'test' DB fallback
    const connectionInstance = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      dbName: process.env.DB_NAME ?? "devsync",
    });

    log.info(
      `✅ MongoDB Connected! Host: ${connectionInstance.connection.host}`
    );

    // Issue #2 Fix: Listen for runtime disconnections after initial connect
    const db = mongoose.connection;
    db.on("disconnected", () =>
      log.error("⚠️  MongoDB disconnected unexpectedly.")
    );
    db.on("reconnected", () => log.info("✅ MongoDB reconnected."));
    db.on("error", (err) =>
      log.error(`MongoDB runtime error: ${err.message}`)
    );

    // Graceful shutdown is handled by server.js — no duplicate SIGINT handler here
  } catch (error) {
    // Issue #4 Fix: Log only error.message — never the full object (exposes URI + credentials)
    log.error(`MongoDB connection FAILED: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;