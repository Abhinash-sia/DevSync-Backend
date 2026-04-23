import mongoose from "mongoose"
import ChatRoom from "../models/chatroom.model.js"
import Message from "../models/message.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
// Note: mongoose import kept for ObjectId.isValid() calls — session removed (perf fix)

const MAX_MESSAGE_LENGTH = 2000

// ─── getMyChatRooms ───────────────────────────────────────────────────────────
const getMyChatRooms = asyncHandler(async (req, res) => {
  const userId = req.user._id

  // Issue #6 Fix: Paginate — never fetch all rooms at once
  const page  = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(Number(req.query.limit) || 20, 50)
  const skip  = (page - 1) * limit

  const chatRooms = await ChatRoom.find({ participants: userId })
    // Issue #4 Fix: Removed email (PII) — Issue #5 Fix: Removed skills/bio (wrong model)
    .populate("participants", "name photoUrl")
    .populate({
      path: "lastMessage",
      populate: { path: "sender", select: "name photoUrl" },
    })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)

  const rooms = chatRooms.map((room) => {
    // Issue #8 Fix: Null-guard participant before accessing _id
    const otherUser = room.participants.find(
      (p) => p && String(p._id) !== String(userId)
    ) || null

    return {
      _id: room._id,
      participants: room.participants,
      otherUser,
      lastMessage: room.lastMessage || null,
      updatedAt: room.updatedAt,
      createdAt: room.createdAt,
    }
  })

  return res
    .status(200)
    .json(new ApiResponse(200, rooms, "Chat rooms fetched successfully"))
})

// ─── getChatHistory ───────────────────────────────────────────────────────────
const getChatHistory = asyncHandler(async (req, res) => {
  const { chatRoomId } = req.params

  // Issue #1 Fix: Validate chatRoomId ObjectId format before any DB call
  if (!mongoose.Types.ObjectId.isValid(chatRoomId)) {
    throw new ApiError(400, "Invalid chat room ID format")
  }

  const limit  = Math.min(Number(req.query.limit) || 20, 50)
  const before = req.query.before || null

  const chatRoom = await ChatRoom.findOne({
    _id: chatRoomId,
    participants: req.user._id,
  })
  if (!chatRoom) throw new ApiError(404, "Chat room not found or access denied")

  const query = { chatRoom: chatRoomId }
  if (before) {
    if (!mongoose.Types.ObjectId.isValid(before)) {
      throw new ApiError(400, "Invalid cursor")
    }
    query._id = { $lt: new mongoose.Types.ObjectId(before) }
  }

  const messages = await Message.find(query)
    .populate("sender", "name photoUrl githubUrl")
    .sort({ _id: -1 })
    .limit(limit + 1)

  const hasMore    = messages.length > limit
  const sliced     = hasMore ? messages.slice(0, limit) : messages
  const nextCursor = hasMore ? sliced[sliced.length - 1]._id : null

  return res.status(200).json(
    new ApiResponse(
      200,
      { messages: sliced.reverse(), nextCursor, hasMore },
      "Chat history fetched successfully"
    )
  )
})

// ─── sendMessage ──────────────────────────────────────────────────────────────
const sendMessage = asyncHandler(async (req, res) => {
  const { chatRoomId } = req.params
  const { content }    = req.body

  // Issue #1 Fix: Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(chatRoomId)) {
    throw new ApiError(400, "Invalid chat room ID format")
  }

  // Issue #7 Fix: Enforce max message length
  if (!content?.trim()) throw new ApiError(400, "Message content cannot be empty")
  if (content.trim().length > MAX_MESSAGE_LENGTH) {
    throw new ApiError(400, `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
  }

  const chatRoom = await ChatRoom.findOne({
    _id: chatRoomId,
    participants: req.user._id,
  })
  if (!chatRoom) throw new ApiError(404, "Chat room not found or access denied")

  // Perf: Skip the Mongoose session/transaction — these two writes are independent
  // and a transaction on Atlas free-tier adds ~200-400ms per message.
  const message = await Message.create({
    chatRoom: chatRoomId,
    sender: req.user._id,
    content: content.trim(),
    status: "sent",
  })

  // Fire-and-forget: ChatRoom lastMessage update doesn't need to block the response
  ChatRoom.findByIdAndUpdate(
    chatRoomId,
    { $set: { lastMessage: message._id, updatedAt: new Date() } }
  ).catch((err) => console.error("[Chat] Failed to update lastMessage:", err.message))

  const populatedMessage = await message.populate("sender", "name photoUrl githubUrl")

  // Issue #9 Fix: Warn if io is not set up instead of silently skipping
  const io = req.app.get("io")
  if (io) {
    let broadcast = io.to(chatRoomId)
    // Also emit specifically to each participant's user channel
    // so they receive notifications even if they haven't explicitly joined the chatRoomId channel.
    chatRoom.participants.forEach((p) => {
      broadcast = broadcast.to(`user:${p.toString()}`)
    })
    broadcast.emit("message", { roomId: chatRoomId, message: populatedMessage })
  } else {
    console.warn("[Chat] Socket.io not initialized — real-time broadcast skipped:", populatedMessage._id)
  }

  return res
    .status(201)
    .json(new ApiResponse(201, populatedMessage, "Message sent successfully"))
})

export { getMyChatRooms, getChatHistory, sendMessage }