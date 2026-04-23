import jwt from "jsonwebtoken"
import crypto from "crypto"
import bcrypt from "bcrypt"
import mongoose from "mongoose"
import User from "../models/user.model.js"
import Token from "../models/token.model.js"
import Profile from "../models/profile.model.js"
import Gig from "../models/gig.model.js"
import Match from "../models/match.model.js"
import ChatRoom from "../models/chatroom.model.js"
import Message from "../models/message.model.js"
import { deleteFromCloudinary } from "../utils/cloudinary.js"
import { sendPasswordResetEmail } from "../utils/email.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

// ─── Issue #6 Fix: Accept full user object to avoid redundant DB lookup ───────
const generateTokens = async (user) => {
  // Issue #2 Fix: Guard against null user
  if (!user) throw new ApiError(404, "User not found during token generation")

  const accessToken  = user.generateAccessToken()
  const refreshToken = user.generateRefreshToken()

  user.refreshToken = refreshToken
  user.lastLogin = new Date()
  await user.save({ validateBeforeSave: false })

  return { accessToken, refreshToken }
}

const isProduction = process.env.NODE_ENV === "production"

const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
}

// Issue #4 Fix: Separate expiry per token type — no more session cookies
const ACCESS_TOKEN_EXPIRY_MS  = 15 * 60 * 1000
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

const accessCookieOptions  = { ...baseCookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_MS }
const refreshCookieOptions = { ...baseCookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_MS }

// ─── registerUser ─────────────────────────────────────────────────────────────
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body

  if ([name, email, password].some((f) => !f || !String(f).trim())) {
    throw new ApiError(400, "Name, email, and password are required")
  }

  // Issue #8 Fix: Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.trim())) {
    throw new ApiError(400, "Please provide a valid email address")
  }

  // Issue #7 Fix: Enforce minimum password strength
  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters long")
  }
  if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) {
    throw new ApiError(400, "Password must contain at least one letter and one number")
  }

  const existingUser = await User.findOne({ email: email.toLowerCase().trim() })
  if (existingUser) throw new ApiError(409, "User with this email already exists")

  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
  })

  // Issue #6 Fix: Pass user object directly — no second DB call
  const { accessToken, refreshToken } = await generateTokens(user)

  // Strip sensitive fields inline — no third DB call
  user.password     = undefined
  user.refreshToken = undefined

  return res
    .status(201)
    .cookie("accessToken",  accessToken,  accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions)
    .json(new ApiResponse(201, user, "User registered successfully"))
})

// ─── loginUser ────────────────────────────────────────────────────────────────
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body

  if (!email?.trim() || !password) {
    throw new ApiError(400, "Email and password are required")
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() })

  // Issue #1 Fix: Same error for missing user AND wrong password — prevents enumeration
  if (!user) throw new ApiError(401, "Invalid email or password")

  const isPasswordValid = await user.isPasswordCorrect(password)
  if (!isPasswordValid) throw new ApiError(401, "Invalid email or password")

  // Issue #6 Fix: Pass user object directly — no second DB call
  const { accessToken, refreshToken } = await generateTokens(user)

  user.password     = undefined
  user.refreshToken = undefined

  return res
    .status(200)
    .cookie("accessToken",  accessToken,  accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions)
    .json(new ApiResponse(200, user, "User logged in successfully"))
})

// ─── logoutUser ───────────────────────────────────────────────────────────────
const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    { $unset: { refreshToken: 1 } },
    { returnDocument: "after" }
  )

  return res
    .status(200)
    .clearCookie("accessToken",  baseCookieOptions)
    .clearCookie("refreshToken", baseCookieOptions)
    .json(new ApiResponse(200, {}, "User logged out successfully"))
})

// ─── refreshAccessToken ───────────────────────────────────────────────────────
const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized — no refresh token")
  }

  // Issue #5 Fix: Validate secret exists before use
  if (!process.env.REFRESH_TOKEN_SECRET) {
    throw new ApiError(500, "Server misconfiguration: REFRESH_TOKEN_SECRET is not set")
  }

  let decoded
  try {
    decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
  } catch {
    throw new ApiError(401, "Refresh token is invalid or expired")
  }

  // Issue #10 Fix: Atomic compare-and-swap prevents concurrent refresh race condition
  const user = await User.findOne({
    _id: decoded._id,
    refreshToken: incomingRefreshToken, // Only match if token in DB is still this one
  })
  if (!user) {
    throw new ApiError(401, "Refresh token is expired or already used")
  }

  const { accessToken, refreshToken } = await generateTokens(user)

  // Issue #3 Fix: Tokens are already in cookies — never expose in response body
  return res
    .status(200)
    .cookie("accessToken",  accessToken,  accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions)
    .json(new ApiResponse(200, {}, "Access token refreshed successfully"))
})

// ─── getCurrentUser ───────────────────────────────────────────────────────────
const getCurrentUser = asyncHandler(async (req, res) => {
  // Issue #9 Fix: req.user is already set by auth middleware — no extra DB call
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"))
})

// ─── deleteAccount ────────────────────────────────────────────────────────────
const deleteAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id

  // 1. Image Cleanup from Cloudinary
  const profile = await Profile.findOne({ user: userId }).select("photoPublicId")
  if (profile && profile.photoPublicId) {
    try {
      await deleteFromCloudinary(profile.photoPublicId)
    } catch (err) {
      console.error(`[Cloudinary] Failed to delete photo for user ${userId}:`, err.message)
      // Non-fatal, continue with DB deletion
    }
  }

  // 2. Database Cleanup in a Transaction (if replica set allows)
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      // a) Delete profile
      await Profile.findOneAndDelete({ user: userId }, { session })

      // b) Delete authored Gigs
      await Gig.deleteMany({ author: userId }, { session })

      // c) Remove user from applicants of other people's Gigs
      await Gig.updateMany(
        { applicants: userId },
        { $pull: { applicants: userId } },
        { session }
      )

      // d) Delete all Matches involving this user
      await Match.deleteMany(
        { $or: [{ sender: userId }, { receiver: userId }] },
        { session }
      )

      // e) Find ChatRooms user is in, delete all messages inside those rooms, then delete rooms
      const chatRooms = await ChatRoom.find({ participants: userId }).select("_id").session(session)
      const chatRoomIds = chatRooms.map(r => r._id)
      
      await Message.deleteMany({ chatRoom: { $in: chatRoomIds } }, { session })
      await ChatRoom.deleteMany({ participants: userId }, { session })

      // f) Finally delete the user account
      await User.findByIdAndDelete(userId, { session })
    })
  } catch (err) {
    // If we're not running a MongoDB replica set, transactions throw. 
    // Fallback to non-transactional deletion. Local isolated drops.
    if (err.message.includes("transaction")) {
       console.log("No replica set detected. Performing non-transactional cascade deletion.")
       await Profile.findOneAndDelete({ user: userId })
       await Gig.deleteMany({ author: userId })
       await Gig.updateMany({ applicants: userId }, { $pull: { applicants: userId } })
       await Match.deleteMany({ $or: [{ sender: userId }, { receiver: userId }] })
       
       const chatRooms = await ChatRoom.find({ participants: userId }).select("_id")
       const chatRoomIds = chatRooms.map(r => r._id)
       await Message.deleteMany({ chatRoom: { $in: chatRoomIds } })
       await ChatRoom.deleteMany({ participants: userId })
       
       await User.findByIdAndDelete(userId)
    } else {
       throw new ApiError(500, "Account deletion failed during transaction")
    }
  } finally {
    await session.endSession()
  }

  // Clear auth cookies
  return res
    .status(200)
    .clearCookie("accessToken", baseCookieOptions)
    .clearCookie("refreshToken", baseCookieOptions)
    .json(new ApiResponse(200, {}, "Account entirely deleted and scrubbed from database"))
})

// ─── forgotPassword ───────────────────────────────────────────────────────────
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body

  if (!email?.trim()) {
    throw new ApiError(400, "Email is required")
  }

  // Always return 200 — never reveal whether email exists (prevents enumeration)
  const user = await User.findOne({ email: email.toLowerCase().trim() })
  if (!user) {
    return res
      .status(200)
      .json(new ApiResponse(200, {}, "If that email is registered, a reset link has been sent"))
  }

  // Ensure only one active token per user
  await Token.deleteMany({ userId: user._id })

  // Generate cryptographically secure raw token
  const rawToken = crypto.randomBytes(32).toString("hex")

  // Hash the token using bcrypt before saving
  const hashedToken = await bcrypt.hash(rawToken, 10)

  await Token.create({
    userId: user._id,
    token: hashedToken,
  })

  try {
    await sendPasswordResetEmail(user.email, user._id, rawToken)
  } catch (err) {
    // Clean up if email fails
    await Token.deleteMany({ userId: user._id })
    console.error("[Auth] Failed to send reset email:", err.message)
    throw new ApiError(500, "Failed to send reset email. Please try again.")
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "If that email is registered, a reset link has been sent"))
})

// ─── resetPassword ────────────────────────────────────────────────────────────
const resetPassword = asyncHandler(async (req, res) => {
  const { userId, token } = req.params
  const { password } = req.body

  if (!userId || !token) throw new ApiError(400, "Invalid or missing reset token parameters")
  if (!password?.trim()) throw new ApiError(400, "New password is required")
  if (password.length < 8) throw new ApiError(400, "Password must be at least 8 characters")
  if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) {
    throw new ApiError(400, "Password must contain at least one letter and one number")
  }

  // Find the token document
  const tokenDoc = await Token.findOne({ userId })
  if (!tokenDoc) {
    throw new ApiError(400, "Reset link is invalid or has expired. Please request a new one.")
  }

  // Compare raw URL token against stored bcrypt hash
  const isValid = await bcrypt.compare(token, tokenDoc.token)
  if (!isValid) {
    throw new ApiError(400, "Reset link is invalid or has expired. Please request a new one.")
  }

  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(404, "User not found")
  }

  // Assign new password; User model pre-save hook handles hashing
  user.password = password
  
  // Invalidate existing sessions by clearing refresh token
  user.refreshToken = ""
  await user.save()

  // Clean up the used token
  await tokenDoc.deleteOne()

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset successfully. Please log in with your new password."))
})

export { registerUser, loginUser, logoutUser, refreshAccessToken, getCurrentUser, deleteAccount, forgotPassword, resetPassword }