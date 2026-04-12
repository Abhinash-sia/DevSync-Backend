import winston from "winston";
import path from "path";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// ─── Custom log format ────────────────────────────────────────────────────────
const logFormat = printf(({ level, message, timestamp, stack }) => {
  // if it's an error, include the stack trace in the log
  return `[${timestamp}] ${level}: ${stack || message}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "warn" : "debug",

  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true }), // capture full stack trace on errors
    logFormat
  ),

  transports: [
    // ── Console transport (development) ────────────────────────────────────
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }), // colored output in terminal
        timestamp({ format: "HH:mm:ss" }),
        logFormat
      ),
    }),

    // ── File transport — ALL logs (info and above) ──────────────────────────
    new winston.transports.File({
      filename: path.join("logs", "combined.log"),
      level: "info",
    }),

    // ── File transport — ERROR logs only ───────────────────────────────────
    // This is your "black box" — when server crashes at 2AM, read this file
    new winston.transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
    }),
  ],
});

export default logger;