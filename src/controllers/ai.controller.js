import fs from "fs"
import { createRequire } from "module"
import mongoose from "mongoose"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { parseResumeWithAI, generateIcebreaker } from "../services/ai.service.js"
import Profile from "../models/profile.model.js"
import ChatRoom from "../models/chatroom.model.js"

import { PDFParse } from "pdf-parse"

const AI_TIMEOUT_MS = 15_000

// ─── parseResume ─────────────────────────────────────────────────────────────
const parseResume = asyncHandler(async (req, res) => {
  const resumeLocalPath = req.file?.path

  if (!resumeLocalPath) {
    throw new ApiError(400, "Resume PDF is required")
  }

  // Issue #5 Fix: Validate file type and size before any processing
  if (req.file.mimetype !== "application/pdf") {
    await fs.promises.unlink(resumeLocalPath).catch(() => {})
    throw new ApiError(415, "Only PDF files are accepted")
  }
  const MAX_SIZE = 5 * 1024 * 1024
  if (req.file.size > MAX_SIZE) {
    await fs.promises.unlink(resumeLocalPath).catch(() => {})
    throw new ApiError(413, "Resume PDF must be under 5MB")
  }

  try {
    // Issue #3 Fix: Non-blocking async file read
    const pdfBuffer = await fs.promises.readFile(resumeLocalPath)
    const parser = new PDFParse(new Uint8Array(pdfBuffer))
    const pdfData = await parser.getText()
    const rawText = pdfData.text

    if (!rawText || rawText.trim().length < 50) {
      throw new ApiError(400, "Could not extract text from PDF. Try a text-based PDF.")
    }

    // Issue #10 Fix: Truncate and label text to prevent prompt injection
    const MAX_CHARS = 8000
    const sanitizedText = rawText.trim().slice(0, MAX_CHARS)

    // Issue #6 Fix: Race AI call against a timeout
    const parsedData = await Promise.race([
      parseResumeWithAI(sanitizedText),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new ApiError(504, "AI service timed out. Please try again.")),
          AI_TIMEOUT_MS
        )
      ),
    ])

    // Issue #1 Fix: Guard entire parsedData object before accessing properties
    if (!parsedData || typeof parsedData !== "object") {
      throw new ApiError(502, "AI service returned an invalid response. Please try again.")
    }

    // Issue #7 Fix: Validate each field's type before writing to DB
    const safeSkills     = Array.isArray(parsedData.skills)           ? parsedData.skills              : []
    const safeBio        = typeof parsedData.bio         === "string"  ? parsedData.bio.trim()          : ""
    const safeLookingFor = typeof parsedData.lookingFor  === "string"  ? parsedData.lookingFor.trim()   : ""

    const updatedProfile = await Profile.findOneAndUpdate(
      { user: req.user._id },
      { $set: { skills: safeSkills, bio: safeBio, lookingFor: safeLookingFor } },
      { returnDocument: "after", upsert: true }
    )

    return res.status(200).json(
      new ApiResponse(
        200,
        { profile: updatedProfile, aiExtracted: parsedData },
        "Resume parsed and profile auto-filled successfully 🤖"
      )
    )
  } finally {
    // Issue #9 Fix: Non-blocking fire-and-forget cleanup
    fs.promises.unlink(resumeLocalPath).catch((err) => {
      console.error("[AI Controller] Failed to delete temp resume file:", err.message)
    })
  }
})

// ─── generateIcebreakerMessage ───────────────────────────────────────────────
const generateIcebreakerMessage = asyncHandler(async (req, res) => {
  const { roomId } = req.params
  const currentUserId = req.user._id

  // Issue #8 Fix: Validate ObjectId format before hitting MongoDB
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    throw new ApiError(400, "Invalid room ID format")
  }

  // Issue #2 Fix: Only populate name from User (skills live in Profile model)
  const room = await ChatRoom.findOne({
    _id: roomId,
    participants: currentUserId,
  }).populate("participants", "name")

  if (!room || room.participants.length !== 2) {
    throw new ApiError(404, "Room not found or requires exactly two participants")
  }

  const currentUserDoc = room.participants.find(p => String(p._id) === String(currentUserId))
  const otherUserDoc   = room.participants.find(p => String(p._id) !== String(currentUserId))

  // Issue #2 Fix: Fetch skills from Profile model where they actually live
  const [currentUserProfile, otherUserProfile] = await Promise.all([
    Profile.findOne({ user: currentUserDoc._id }).select("skills").lean(),
    Profile.findOne({ user: otherUserDoc._id }).select("skills").lean(),
  ])

  // Issue #6 Fix: Timeout AI call
  const icebreaker = await Promise.race([
    generateIcebreaker(
      currentUserProfile?.skills || [],
      otherUserProfile?.skills   || [],
      currentUserDoc.name        || "A developer",
      otherUserDoc.name          || "another developer"
    ),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new ApiError(504, "AI service timed out. Please try again.")),
        AI_TIMEOUT_MS
      )
    ),
  ])

  return res.status(200).json(
    new ApiResponse(200, { message: icebreaker }, "Icebreaker generated successfully")
  )
})

export { parseResume, generateIcebreakerMessage }