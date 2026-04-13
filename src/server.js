import "./config/env.js"

import fs from "fs"
import mongoose from "mongoose"
import { createServer } from "http"

import { app } from "./app.js"
import connectDB from "./config/db.js"
import { initializeSocket } from "./config/socket.js"
import { startCronJobs, stopCronJobs } from "./jobs/cleanup.worker.js"
import logger from "./utils/logger.js"
import redis, { isRedisAvailable } from "./config/redis.js" // ← ADD THIS

fs.mkdirSync("logs", { recursive: true })

const NODE_ENV = process.env.NODE_ENV || "development"
if (!process.env.NODE_ENV) {
  logger.warn("NODE_ENV is not set — defaulting to 'development'")
}

const rawPort = Number(process.env.PORT)
const PORT    = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 8000
if (process.env.PORT && PORT === 8000 && process.env.PORT !== "8000") {
  logger.warn(`Invalid PORT "${process.env.PORT}" — falling back to 8000`)
}

const httpServer = createServer(app)
const io         = initializeSocket(httpServer)
app.set("io", io)

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Shutting down gracefully...`)

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit")
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  // Close Socket.IO first — it holds persistent WebSocket connections open
  // which prevents httpServer.close() from ever firing its callback.
  io.close(() => {
    httpServer.close(async () => {
      clearTimeout(forceExit)
      logger.info("HTTP server closed.")

      try {
        stopCronJobs()
        await mongoose.connection.close()
        logger.info("MongoDB connection closed.")
        await redis.quit()
        logger.info("Redis connection closed.")
      } catch (err) {
        logger.error("Error during connection teardown:", err)
      } finally {
        process.exit(0)
      }
    })
  })
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT",  () => gracefulShutdown("SIGINT"))

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection:", reason)
  gracefulShutdown("unhandledRejection")
})

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception — process will exit:", err)
  process.exit(1)
})

// ─── Boot Sequence ────────────────────────────────────────────────────────────
connectDB()
  .then(async () => {
    // Redis health check — confirms Upstash is reachable before serving traffic
    if (isRedisAvailable) {
      try {
        const pong = await redis.ping()
        logger.info(`✅ Redis (Upstash) connected — PING: ${pong}`)
      } catch (err) {
        logger.warn(`⚠️  Redis unavailable — cache layer disabled: ${err.message}`)
      }
    }

    startCronJobs()

    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`)
      logger.info(`🌍 Environment: ${NODE_ENV}`)
    })
  })
  .catch((err) => {
    logger.error("Server failed to start:", err)
    process.exit(1)
  })