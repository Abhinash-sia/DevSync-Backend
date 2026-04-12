import { createClient } from "redis"
import logger from "../utils/logger.js"

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[Redis] FATAL: REDIS_URL is not set in production.")
  }
  logger.warn("[Redis] REDIS_URL not set — falling back to localhost:6379 (dev only)")
}

export let isRedisAvailable = true

const redis = createClient({
  url: redisUrl ?? "redis://localhost:6379",
  // node-redis handles rediss:// TLS automatically — no manual tls config needed
  socket: {
    connectTimeout: 5000,
    reconnectStrategy(retries) {
      if (retries > 5) {
        isRedisAvailable = false
        logger.error("[Redis] Retry limit reached — cache layer disabled")
        return false // stop retrying
      }
      return Math.min(retries * 500, 2000)
    },
  },
})

redis.on("connect",      () => logger.info("✅ Redis connected"))
redis.on("ready",        () => { isRedisAvailable = true;  logger.info("✅ Redis ready for commands") })
redis.on("reconnecting", () => { isRedisAvailable = false; logger.warn("⚠️  Redis reconnecting...") })
redis.on("end",          () => logger.warn("[Redis] Connection permanently closed"))
redis.on("error",        (err) => logger.error(`[Redis] Error [${err.code ?? "UNKNOWN"}]: ${err.message}`))

// node-redis requires explicit connect() — unlike ioredis which auto-connects
await redis.connect()

export default redis