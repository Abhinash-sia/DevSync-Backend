import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redis, { isRedisAvailable } from "../config/redis.js";

// ─── Shared Helpers ───────────────────────────────────────────────────────────

const makeStore = (prefix) => {
  if (!isRedisAvailable) return undefined;
  return new RedisStore({
    // Fix 1: node-redis uses sendCommand(args) — not redis.call() which is ioredis
    sendCommand: (...args) => redis.sendCommand(args),
    prefix: `rl:${prefix}:`,
  });
};

const make429Handler = (message) => (req, res, _next, options) => {
  res.status(429).json({
    statusCode: 429,
    success: false,
    data: null,
    message,
    retryAfter: res.getHeader("Retry-After"),
  });
};

// Fix 2: Use ipKeyGenerator helper — handles IPv6 properly, satisfies express-rate-limit validation
const getRealIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"]?.split(",")[0].trim();
  return forwarded ? forwarded : ipKeyGenerator(req);
};

// ─── AUTH LIMITER ─────────────────────────────────────────────────────────────
export const authLimiter = rateLimit({
  // windowMs: 15 * 60 * 1000,
  // max: 10,
  // standardHeaders: true,
  // legacyHeaders: false,
  // store: makeStore("auth"),
  // keyGenerator: getRealIp,
  // handler: make429Handler(
  //   "Too many login attempts from this IP. Please try again after 15 minutes.",
  // ),
});

// ─── MATCH LIMITER ────────────────────────────────────────────────────────────
export const matchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("match"),
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: make429Handler(
    "You're swiping too fast. Please slow down and try again in an hour.",
  ),
});

// ─── GLOBAL LIMITER ───────────────────────────────────────────────────────────
export const globalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("global"),
  keyGenerator: getRealIp,
  skip: (req) => ["/health", "/ping", "/metrics"].includes(req.path),
  handler: make429Handler("Too many requests. Please try again later."),
});

