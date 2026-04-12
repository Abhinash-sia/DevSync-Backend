import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import User from "../models/user.model.js"
import { getCache, setCache } from "../services/cache.service.js"

export const verifyJWT = asyncHandler(async (req, res, next) => {
  // 1. Extract token — cookie (browser) or Authorization header (mobile/Postman)
  const authHeader = req.header("Authorization")
  let token = req.cookies?.accessToken

  if (!token && authHeader) {
    // Issue #2 Fix: Enforce exact "Bearer <token>" format — reject loose variants
    if (!authHeader.startsWith("Bearer ")) {
      throw new ApiError(401, "Authorization header must use Bearer scheme")
    }
    token = authHeader.slice(7).trim()
  }

  if (!token) {
    throw new ApiError(401, "Unauthorized request — no token provided")
  }

  // 2. Verify signature and expiry
  let decodedToken
  try {
    decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
  } catch (err) {
    // Issue #1 Fix: Differentiate expired vs tampered — helps frontend auto-refresh
    if (err.name === "TokenExpiredError") {
      throw new ApiError(401, "Access token expired")
    }
    throw new ApiError(401, "Invalid access token")
  }

  // Issue #6 Fix: Validate token payload before using _id in a DB query
  if (!decodedToken._id || !mongoose.Types.ObjectId.isValid(decodedToken._id)) {
    throw new ApiError(401, "Invalid token payload")
  }

  // Issue #3 Fix: Cache user in Redis — avoid a DB hit on every authenticated request
  const cacheKey = `auth:user:${decodedToken._id}`
  let user = await getCache(cacheKey)

  if (!user) {
    // Issue #5 Fix: .lean() returns a plain object — no accidental .save() risk
    user = await User.findById(decodedToken._id)
      .select("-password -refreshToken")
      .lean()

    if (!user) throw new ApiError(401, "Invalid token — user no longer exists")

    await setCache(cacheKey, user, 60) // 60 second TTL — deleted users evict within 1 min
  }

  req.user = user
  next()
})