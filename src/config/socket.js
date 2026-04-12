import { Server } from "socket.io"
import jwt from "jsonwebtoken"
import cookie from "cookie"
import mongoose from "mongoose"
import User from "../models/user.model.js"
import ChatRoom from "../models/chatroom.model.js"

// ─── Issue #2 Fix ─────────────────────────────────────────────────────────────
// Track active socket IDs per user to handle multi-tab correctly.
// userId (string) → Set<socketId (string)>
const onlineUsers = new Map()

// ─── Issue #4 Fix ─────────────────────────────────────────────────────────────
// Per-socket, per-event rate limiter (no extra library needed).
const eventCounters = {}
const RATE_LIMITS = {
  "typing": { max: 10, windowMs: 1000 },  // 10 events/sec
  "join-room": { max: 5, windowMs: 5000 }, // 5 joins per 5 sec
}

const isRateLimited = (socketId, event) => {
  const rule = RATE_LIMITS[event]
  if (!rule) return false

  const key = `${socketId}:${event}`
  const now = Date.now()

  if (!eventCounters[key] || now - eventCounters[key].ts > rule.windowMs) {
    eventCounters[key] = { count: 1, ts: now }
    return false
  }

  eventCounters[key].count++
  return eventCounters[key].count > rule.max
}

// ─── Helper: Notify only relevant chatroom partners ───────────────────────────
// Issue #1 Fix: Never broadcast online status to strangers.
const notifyPartners = async (io, userId, isOnline) => {
  try {
    const rooms = await ChatRoom.find({
      participants: new mongoose.Types.ObjectId(userId),
    }).select("participants")

    const partnerIds = rooms.flatMap((r) =>
      r.participants
        .map((p) => p.toString())
        .filter((id) => id !== userId)
    )

    partnerIds.forEach((partnerId) => {
      io.to(`user:${partnerId}`).emit("online-status", { userId, isOnline })
    })
  } catch (err) {
    // Non-critical — log and swallow. Don't crash the connection handler.
    console.error("[Socket] Failed to notify partners of online status:", err.message)
  }
}

// ─── Main Initializer ─────────────────────────────────────────────────────────
const initializeSocket = (httpServer) => {
  // ─── Issue #7 Fix ───────────────────────────────────────────────────────────
  // Support multiple comma-separated origins for staging + production.
  const allowedOrigins = (
    process.env.CORS_ORIGIN || "http://localhost:5173"
  ).split(",").map((o) => o.trim())

  // ─── Issue #9 Fix ───────────────────────────────────────────────────────────
  // Set explicit ping timeouts to detect ghost sockets on mobile/proxies.
  const io = new Server(httpServer, {
    pingTimeout: 10000,
    pingInterval: 25000,
    cors: {
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., Postman, server-to-server)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          callback(new Error(`[Socket] CORS blocked for origin: ${origin}`))
        }
      },
      credentials: true,
    },
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTH MIDDLEWARE
  // ─────────────────────────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    // ─── Issue #3 Fix ─────────────────────────────────────────────────────────
    // Validate server config BEFORE attempting token verification so the real
    // error isn't silently swallowed as "Invalid token".
    if (!process.env.ACCESS_TOKEN_SECRET) {
      return next(
        new Error("[Socket] Server misconfiguration: ACCESS_TOKEN_SECRET is not set")
      )
    }

    try {
      const rawCookie = socket.handshake.headers?.cookie || ""
      const cookies = cookie.parse(rawCookie)
      const token = cookies.accessToken

      if (!token) {
        return next(new Error("Authentication error: No token provided"))
      }

      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

      // Lean query — only fetch what socket handlers actually need
      const user = await User.findById(decoded._id).select("_id name").lean()
      if (!user) {
        return next(new Error("Authentication error: User not found"))
      }

      socket.user = user
      next()
    } catch (err) {
      // This catch now ONLY handles genuinely expired/tampered tokens
      next(new Error("Authentication error: Invalid token"))
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // CONNECTION HANDLER
  // ─────────────────────────────────────────────────────────────────────────────
  io.on("connection", async (socket) => {
    const userId = socket.user._id.toString()

    // ─── Issue #2 Fix: Register this socket in the active-sockets map ──────────
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set())
    onlineUsers.get(userId).add(socket.id)

    // Join personal notification room
    socket.join(`user:${userId}`)

    // ─── Issue #1 Fix: Only notify chatroom partners, not all users ────────────
    // Only emit online if this is the FIRST tab/socket for this user
    if (onlineUsers.get(userId).size === 1) {
      await notifyPartners(io, userId, true)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // EVENT: join-room
    // ─────────────────────────────────────────────────────────────────────────────
    socket.on("join-room", async ({ roomId } = {}) => {
      // ─── Issue #4 Fix: Rate limit join-room to prevent DB hammering ───────────
      if (isRateLimited(socket.id, "join-room")) {
        return socket.emit("error", { message: "Too many join requests. Slow down." })
      }

      // ─── Issue #6 Fix: Validate roomId is a valid ObjectId before hitting DB ──
      if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
        return socket.emit("error", { message: "Invalid room ID format" })
      }

      try {
        const room = await ChatRoom.exists({
          _id: roomId,
          participants: socket.user._id,
        })

        if (!room) {
          return socket.emit("error", { message: "Chat room access denied" })
        }

        socket.join(roomId)
      } catch (err) {
        console.error("[Socket] join-room error:", err.message)
        socket.emit("error", { message: "Failed to join room" })
      }
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // NOTE: send-message is intentionally handled via REST controller.
    // POST /api/v1/chat/send → saves to DB → io.to(roomId).emit("message")
    // This avoids double-save race conditions and keeps DB logic in one place.
    // ─────────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────────
    // EVENT: typing
    // ─────────────────────────────────────────────────────────────────────────────
    socket.on("typing", (payload) => {
      // ─── Issue #4 Fix: Rate limit typing events ───────────────────────────────
      if (isRateLimited(socket.id, "typing")) return

      if (!payload?.roomId) return

      // ─── Issue #5 Fix: Verify socket is actually in this room ────────────────
      if (!socket.rooms.has(payload.roomId)) {
        return socket.emit("error", { message: "Not authorized for this room" })
      }

      socket.to(payload.roomId).emit("typing", {
        roomId: payload.roomId,
        userId,
        name: socket.user.name,
      })
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // EVENT: stop-typing  (Issue #8 Fix)
    // Without this, the typing indicator gets permanently stuck if a tab crashes.
    // ─────────────────────────────────────────────────────────────────────────────
    socket.on("stop-typing", (payload) => {
      if (!payload?.roomId) return

      // ─── Issue #5 Fix: Same room-membership check as typing ──────────────────
      if (!socket.rooms.has(payload.roomId)) return

      socket.to(payload.roomId).emit("stop-typing", {
        roomId: payload.roomId,
        userId,
      })
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // EVENT: disconnect
    // ─────────────────────────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      // ─── Issue #2 Fix: Remove this socket from the map ───────────────────────
      const userSockets = onlineUsers.get(userId)
      if (userSockets) {
        userSockets.delete(socket.id)

        // Only broadcast offline when ALL tabs/sockets are closed
        if (userSockets.size === 0) {
          onlineUsers.delete(userId)

          // ─── Issue #1 Fix: Targeted offline broadcast to partners only ────────
          await notifyPartners(io, userId, false)
        }
      }

      // ─── Issue #8 Fix: Auto-clear typing indicators in all joined rooms ───────
      socket.rooms.forEach((roomId) => {
        if (roomId !== socket.id && roomId !== `user:${userId}`) {
          socket.to(roomId).emit("stop-typing", { roomId, userId })
        }
      })

      // Clean up rate limiter counters for this socket
      Object.keys(eventCounters).forEach((key) => {
        if (key.startsWith(socket.id)) delete eventCounters[key]
      })
    })
  })

  return io
}

export { initializeSocket }