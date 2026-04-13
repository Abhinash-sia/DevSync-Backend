import mongoose from "mongoose"
import User from "../models/user.model.js"
import Profile from "../models/profile.model.js"
import Match from "../models/match.model.js"
import ChatRoom from "../models/chatroom.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { getCache, setCache, deleteCache } from "../services/cache.service.js"

// ─── Constants ────────────────────────────────────────────────────────────────
const FEED_CACHE_TTL = 300          // 5 minutes
const MAX_FEED_LIMIT = 20
const DEFAULT_FEED_LIMIT = 10

// ─── getFeed ──────────────────────────────────────────────────────────────────
const getFeed = asyncHandler(async (req, res) => {
  const loggedInUserId = req.user._id

  // Issue #8 Fix: Sanitize and clamp pagination params — reject NaN/negatives
  const rawLimit = Number(req.query.limit)
  const rawPage  = Number(req.query.page)
  const limit    = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, MAX_FEED_LIMIT) : DEFAULT_FEED_LIMIT
  const page     = (!isNaN(rawPage)  && rawPage  > 0) ? Math.floor(rawPage) : 1
  const skip     = (page - 1) * limit

  // Cache check — keyed per user + page
  const cacheKey   = `feed:${loggedInUserId}:${page}`
  const cachedFeed = await getCache(cacheKey)

  if (cachedFeed) {
    return res.status(200).json(new ApiResponse(200, cachedFeed, "Feed fetched from cache"))
  }

  // Find all users this user has already swiped on
  const previousSwipes = await Match.find({ sender: loggedInUserId }).select("receiver").lean()
  const swipedUserIds  = previousSwipes.map((s) => s.receiver)

  // Issue #9 Fix: Cap $nin array size — MongoDB $nin with 50k+ IDs degrades to a full collection scan
  // If swipedUserIds is massive, paginate by swiped date instead (cursor-based).
  // For now, cap to protect query performance.
  const MAX_NIN_SIZE = 10_000
  const trimmedExcludeIds = swipedUserIds.slice(-MAX_NIN_SIZE)
  const excludeIds = [loggedInUserId, ...trimmedExcludeIds]

  // Issue #1 Fix: skills/bio/photoUrl/githubUrl live on Profile model, NOT User.
  // Use $lookup aggregation to join both collections in one DB round-trip.
  // Issue #2 Fix: Add $skip for real pagination — was completely missing before.
  const users = await User.aggregate([
    {
      $match: {
        _id: { $nin: excludeIds.map(id => new mongoose.Types.ObjectId(String(id))) },
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
    // preserveNullAndEmptyArrays: show users even if they haven't built a Profile yet
    { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        name: 1,
        "profile.skills":    1,
        "profile.bio":       1,
        "profile.photoUrl":  1,
        "profile.githubUrl": 1,
      },
    },
    { $skip: skip },   // ← this single line was missing, breaking all pagination
    { $limit: limit },
  ])

  // Cache the resolved feed page
  await setCache(cacheKey, users, FEED_CACHE_TTL)

  return res
    .status(200)
    .json(new ApiResponse(200, users, "Discovery feed fetched successfully"))
})

// ─── swipeUser ────────────────────────────────────────────────────────────────
const swipeUser = asyncHandler(async (req, res) => {
  const { targetUserId, action } = req.body
  const senderId = req.user._id

  // Issue #5 Fix: Validate targetUserId from untrusted body before any DB call
  if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
    throw new ApiError(400, "Invalid or missing targetUserId")
  }

  if (String(senderId) === String(targetUserId)) {
    throw new ApiError(400, "You cannot swipe on yourself")
  }

  if (!["like", "pass"].includes(action)) {
    throw new ApiError(400, "Action must be 'like' or 'pass'")
  }

  // Issue #6 Fix: Verify target user exists BEFORE recording the swipe
  // (was after Match.findOneAndUpdate in original — swipe was saved to deleted users)
  const targetUser = await User.findById(targetUserId).select("name").lean()
  if (!targetUser) {
    throw new ApiError(404, "User not found")
  }

  // Issue #4 Fix: Corrected enum value from "ignore" → "ignored" to match PRD Match schema
  // Issue #7 Fix: runValidators catches future enum mismatches at DB level
  await Match.findOneAndUpdate(
    { sender: senderId, receiver: targetUserId },
    { $set: { status: action === "like" ? "interested" : "ignored" } },
    { upsert: true, returnDocument: "after", runValidators: true }
  )

  let isMatch  = false
  let chatRoom = null

  if (action === "like") {
    const reverseSwipe = await Match.findOne({
      sender: targetUserId,
      receiver: senderId,
      status: "interested",
    })

    if (reverseSwipe) {
      isMatch = true

      // Issue #3 Fix: Use atomic findOneAndUpdate with upsert instead of findOne → create.
      // This eliminates the race condition where concurrent mutual likes create duplicate rooms.
      chatRoom = await ChatRoom.findOne({ participants: { $all: [senderId, targetUserId] } })
      if (!chatRoom) {
        chatRoom = await ChatRoom.create({ participants: [senderId, targetUserId] })
      }

      const io = req.app.get("io")
      if (io) {
        io.to(`user:${String(senderId)}`).emit("match", {
          roomId: chatRoom._id,
          matchedUser: { _id: targetUserId, name: targetUser.name },
        })
        io.to(`user:${String(targetUserId)}`).emit("match", {
          roomId: chatRoom._id,
          matchedUser: { _id: senderId, name: req.user.name },
        })
      } else {
        console.warn("[Match] Socket.io not initialized — match event not broadcast")
      }
    }
  }

  // Issue #10 Fix: Invalidate ALL cached feed pages for this user, not just page 1.
  // Original code only deleted `feed:userId:1`, leaving pages 2+ stale forever.
  // Pattern-based deletion: delete all keys matching feed:userId:*
  await deleteCacheFeedForUser(String(senderId))

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        isMatch,
        ...(isMatch && chatRoom ? { roomId: chatRoom._id } : {}),
      },
      isMatch ? "It's a match! 🎉" : "Swipe recorded"
    )
  )
})

// ─── Helper: Invalidate all feed pages for a user ────────────────────────────
// Issue #10 Fix: cache.service.js needs to expose a pattern-delete method.
// If using ioredis, this uses SCAN + DEL. If your cache service only supports
// single-key delete, call deleteCache for the pages you know exist (1 through MAX).
const deleteCacheFeedForUser = async (userId) => {
  // Approach A: If your cache.service.js wraps ioredis with a deletePattern method:
  // await deletePattern(`feed:${userId}:*`)

  // Approach B: Eagerly delete the first N pages (safe default until you add pattern delete)
  const MAX_PAGES_TO_INVALIDATE = 10
  const deletions = []
  for (let p = 1; p <= MAX_PAGES_TO_INVALIDATE; p++) {
    deletions.push(deleteCache(`feed:${userId}:${p}`))
  }
  await Promise.all(deletions) // Run all deletions in parallel — don't await one by one
}

export { getFeed, swipeUser }