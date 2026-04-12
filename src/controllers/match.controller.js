import mongoose from "mongoose"
import Match from "../models/match.model.js"
import User from "../models/user.model.js"
import Profile from "../models/profile.model.js"
import ChatRoom from "../models/chatroom.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { setCache, getCache, deleteCache } from "../services/cache.service.js"

// ─── Helper: Invalidate all feed pages for a user ─────────────────────────────
const invalidateFeedCache = async (userId) => {
  const MAX_PAGES = 10
  await Promise.all(
    Array.from({ length: MAX_PAGES }, (_, i) =>
      deleteCache(`feed:${userId}:${i + 1}`)
    )
  )
}

// ─── swipeDeveloper ───────────────────────────────────────────────────────────
const swipeDeveloper = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { action }  = req.body
  const senderId    = req.user._id

  // Issue #3 Fix: Validate ObjectId before any DB call
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid user ID format")
  }

  if (String(senderId) === String(userId)) {
    throw new ApiError(400, "You cannot swipe on yourself")
  }

  // Issue #2 Fix: Correct enum values to match PRD Match schema
  if (!["interested", "ignored"].includes(action)) {
    throw new ApiError(400, "Action must be 'interested' or 'ignored'")
  }

  // Issue #4 Fix: Only name from User — profile data fetched separately
  const receiver = await User.findById(userId).select("_id name").lean()
  if (!receiver) throw new ApiError(404, "User not found")

  // Issue #5 Fix: Fetch sender's Profile for socket payload
  const [receiverProfile, senderProfile] = await Promise.all([
    Profile.findOne({ user: userId }).select("skills bio photoUrl githubUrl").lean(),
    Profile.findOne({ user: senderId }).select("skills bio photoUrl githubUrl").lean(),
  ])

  // Issue #6 Fix: Atomic upsert — no race condition, no unhandled duplicate key error
  const swipe = await Match.findOneAndUpdate(
    { sender: senderId, receiver: userId },
    { $set: { status: action } },
    { upsert: true, new: true, runValidators: true }
  )

  let isMatch  = false
  let chatRoom = null

  if (action === "interested") {
    const reverseSwipe = await Match.findOne({
      sender: userId,
      receiver: senderId,
      status: "interested",
    })

    if (reverseSwipe) {
      isMatch = true

      // Issue #7 Fix: Atomic findOneAndUpdate upsert — no duplicate room race condition
      chatRoom = await ChatRoom.findOneAndUpdate(
        { participants: { $all: [senderId, userId] } },
        { $setOnInsert: { participants: [senderId, userId] } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )

      const io = req.app.get("io")
      if (io) {
        // Issue #5 Fix: Use Profile data in socket payloads — not undefined User fields
        io.to(`user:${String(senderId)}`).emit("match", {
          roomId: chatRoom._id,
          user: {
            _id: receiver._id,
            name: receiver.name,
            photoUrl:  receiverProfile?.photoUrl,
            skills:    receiverProfile?.skills,
            bio:       receiverProfile?.bio,
            githubUrl: receiverProfile?.githubUrl,
          },
        })
        io.to(`user:${String(userId)}`).emit("match", {
          roomId: chatRoom._id,
          user: {
            _id:       senderId,
            name:      req.user.name,
            photoUrl:  senderProfile?.photoUrl,
            skills:    senderProfile?.skills,
            bio:       senderProfile?.bio,
            githubUrl: senderProfile?.githubUrl,
          },
        })
      } else {
        console.warn("[Match] Socket.io not initialized — match event not broadcast")
      }
    }
  }

  // Invalidate all cached feed pages for the sender
  await invalidateFeedCache(String(senderId))

  return res.status(200).json(
    new ApiResponse(
      200,
      { isMatch, roomId: chatRoom?._id || null },
      isMatch ? "It's a match! 🎉" : "Swipe recorded"
    )
  )
})

// ─── getDiscoveryFeed ─────────────────────────────────────────────────────────
const getDiscoveryFeed = asyncHandler(async (req, res) => {
  const loggedInUserId = req.user._id
  const page  = Math.max(1, Math.floor(Number(req.query.page)  || 1))
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 20)
  const skip  = (page - 1) * limit

  const cacheKey   = `feed:${loggedInUserId}:${page}`
  const cachedFeed = await getCache(cacheKey)
  if (cachedFeed) {
    return res.status(200).json(new ApiResponse(200, cachedFeed, "Feed fetched from cache"))
  }

  // Issue #1 Fix: Only query where logged-in user is SENDER
  // Using $or (receiver too) hides people who swiped on YOU — making mutual matches impossible
  const swipes = await Match.find({ sender: loggedInUserId }).select("receiver").lean()

  const hiddenUserIds = new Set([String(loggedInUserId)])
  for (const s of swipes) hiddenUserIds.add(String(s.receiver))

  // Issue #4 & #8 Fix: Use aggregation $lookup for Profile data; remove email
  const users = await User.aggregate([
    {
      $match: {
        _id: { $nin: Array.from(hiddenUserIds).map(id => new mongoose.Types.ObjectId(id)) },
      },
    },
    {
      $lookup: {
        from: "profiles",
        localField: "_id",
        foreignField: "user",
        as: "profile",
      },
    },
    { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        name: 1,
        "profile.skills":    1,
        "profile.bio":       1,
        "profile.photoUrl":  1,
        "profile.githubUrl": 1,
      },
    },
    { $skip: skip },
    { $limit: limit + 1 },
  ])

  const hasMore      = users.length > limit
  const slicedUsers  = hasMore ? users.slice(0, limit) : users
  const responseData = { users: slicedUsers, page, limit, nextPage: hasMore ? page + 1 : null }

  await setCache(cacheKey, responseData, 3600)

  return res
    .status(200)
    .json(new ApiResponse(200, responseData, "Discovery feed fetched successfully"))
})

// ─── getConnections ───────────────────────────────────────────────────────────
const getConnections = asyncHandler(async (req, res) => {
  const loggedInUserId = req.user._id

  // Issue #10 Fix: Add pagination — unbounded query is a performance/DoS risk
  const page  = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(Number(req.query.limit) || 20, 50)

  const rooms = await ChatRoom.find({ participants: loggedInUserId })
    .populate("participants", "name photoUrl") // Issue #4: profile fields removed (wrong model)
    .populate({ path: "lastMessage", populate: { path: "sender", select: "name" } })
    .sort({ updatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)

  const connections = rooms
    .map((room) => {
      // Issue #9 Fix: Guard against deleted participant before calling .toObject()
      const otherUser = room.participants.find(
        (p) => p && String(p._id) !== String(loggedInUserId)
      )
      if (!otherUser) return null

      return {
        ...otherUser.toObject(),
        roomId: room._id,
        lastMessage: room.lastMessage || null,
        updatedAt: room.updatedAt,
      }
    })
    .filter(Boolean) // Remove null entries from deleted participants

  return res
    .status(200)
    .json(new ApiResponse(200, connections, "Connections fetched successfully"))
})

export { swipeDeveloper, getDiscoveryFeed, getConnections }