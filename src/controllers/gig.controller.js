import mongoose from "mongoose"
import Gig from "../models/gig.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_TITLE_LENGTH = 100
const MAX_DESC_LENGTH  = 2000
const MAX_SKILLS       = 15
const MAX_SKILL_LENGTH = 50

// ─── normalizeSkills ──────────────────────────────────────────────────────────
const normalizeSkills = (value) => {
  if (!value) return []

  if (Array.isArray(value)) {
    return value.map((i) => String(i).trim()).filter(Boolean)
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map((i) => String(i).trim()).filter(Boolean)
      }
    } catch {}
    return value.split(",").map((i) => i.trim()).filter(Boolean)
  }

  return []
}

// ─── createGig ────────────────────────────────────────────────────────────────
const createGig = asyncHandler(async (req, res) => {
  const { title, description, skills = [], budget } = req.body

  if (!title?.trim() || !description?.trim()) {
    throw new ApiError(400, "Title and description are required")
  }

  // Issue #8 Fix: Length limits to prevent DoS via oversized input
  if (title.trim().length > MAX_TITLE_LENGTH) {
    throw new ApiError(400, `Title cannot exceed ${MAX_TITLE_LENGTH} characters`)
  }
  if (description.trim().length > MAX_DESC_LENGTH) {
    throw new ApiError(400, `Description cannot exceed ${MAX_DESC_LENGTH} characters`)
  }

  const parsedSkills = normalizeSkills(skills)

  if (parsedSkills.length > MAX_SKILLS) {
    throw new ApiError(400, `Cannot add more than ${MAX_SKILLS} skills`)
  }
  if (parsedSkills.some((s) => s.length > MAX_SKILL_LENGTH)) {
    throw new ApiError(400, `Each skill cannot exceed ${MAX_SKILL_LENGTH} characters`)
  }

  // Issue #7 Fix: Validate budget — reject negative numbers, strings, and huge values
  let safeBudget = null
  if (budget !== undefined && budget !== null) {
    const parsed = Number(budget)
    if (isNaN(parsed) || parsed < 0) {
      throw new ApiError(400, "Budget must be a non-negative number")
    }
    if (parsed > 1_000_000) {
      throw new ApiError(400, "Budget cannot exceed 1,000,000")
    }
    safeBudget = parsed
  }

  const gig = await Gig.create({
    author: req.user._id,
    title: title.trim(),
    description: description.trim(),
    skills: parsedSkills,
    budget: safeBudget,
    status: "active",
  })

  // Issue #9 Fix: Populate in-place — no second findById round-trip
  // Issue #10 Fix: email removed from author populate — unnecessary PII in response
  await gig.populate("author", "name photoUrl githubUrl")

  return res
    .status(201)
    .json(new ApiResponse(201, gig, "Gig created successfully"))
})

// ─── getGigFeed ───────────────────────────────────────────────────────────────
const getGigFeed = asyncHandler(async (req, res) => {
  // Issue #5 Fix: Clamp page and limit — reject negatives and NaN
  const page  = Math.max(1, Math.floor(Number(req.query.page)  || 1))
  const limit = Math.min(Math.max(1, Math.floor(Number(req.query.limit) || 10)), 20)
  const skip  = (page - 1) * limit

  const skillRaw = req.query.skill?.trim()

  const query = {
    status: "active",
    author: { $ne: req.user._id },
  }

  if (skillRaw) {
    // Issue #4 Fix: Case-insensitive regex match — escape special chars to prevent ReDoS
    const escapedSkill = skillRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    query.skills = { $regex: new RegExp(`^${escapedSkill}$`, "i") }
  }

  const gigs = await Gig.find(query)
    .populate("author", "name photoUrl githubUrl")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit + 1)

  const hasMore   = gigs.length > limit
  const slicedGigs = hasMore ? gigs.slice(0, limit) : gigs

  return res.status(200).json(
    new ApiResponse(
      200,
      { gigs: slicedGigs, page, limit, nextPage: hasMore ? page + 1 : null },
      "Gig feed fetched successfully"
    )
  )
})

// ─── applyToGig ───────────────────────────────────────────────────────────────
const applyToGig = asyncHandler(async (req, res) => {
  const { gigId } = req.params
  const userId    = req.user._id

  // Issue #3 Fix: Validate ObjectId format before any DB call
  if (!mongoose.Types.ObjectId.isValid(gigId)) {
    throw new ApiError(400, "Invalid gig ID format")
  }

  // Issue #1 Fix: Single atomic findOneAndUpdate — eliminates race condition entirely.
  // All checks (status, author, duplicate) happen in one DB operation.
  const updatedGig = await Gig.findOneAndUpdate(
    {
      _id: gigId,
      status: "active",
      author: { $ne: userId },
      applicants: { $ne: userId },
    },
    { $addToSet: { applicants: userId } },
    { new: true }
  )

  if (!updatedGig) {
    // Fetch to determine which condition failed — give user specific error
    const gig = await Gig.findById(gigId).lean()
    if (!gig)                                                            throw new ApiError(404, "Gig not found")
    if (String(gig.author) === String(userId))                           throw new ApiError(400, "You cannot apply to your own gig")
    if (gig.status !== "active")                                         throw new ApiError(400, "This gig is no longer accepting applications")
    if (gig.applicants.some((id) => String(id) === String(userId)))      throw new ApiError(409, "You have already applied to this gig")
    throw new ApiError(400, "Could not apply to this gig")
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      { gigId: updatedGig._id, applied: true },
      "Applied to gig successfully"
    )
  )
})

// ─── getMyGigs ────────────────────────────────────────────────────────────────
const getMyGigs = asyncHandler(async (req, res) => {
  const userId = req.user._id

  // Issue #6 Fix: Add pagination — unbounded queries on both posted and applied
  const page  = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(Number(req.query.limit) || 10, 20)
  const skip  = (page - 1) * limit

  const [posted, applied] = await Promise.all([
    Gig.find({ author: userId })
      .populate("author", "name photoUrl githubUrl")
      // Issue #2 Fix: email removed from applicants populate — PII breach
      .populate("applicants", "name photoUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Gig.find({ applicants: userId })
      .populate("author", "name photoUrl githubUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
  ])

  return res.status(200).json(
    new ApiResponse(200, { posted, applied }, "My gigs fetched successfully")
  )
})

export { createGig, getGigFeed, applyToGig, getMyGigs }