import mongoose from "mongoose"
import Gig from "../models/gig.model.js"
import GigComment from "../models/gigcomment.model.js"
import ChatRoom from "../models/chatroom.model.js"
import Profile from "../models/profile.model.js"
import User from "../models/user.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_TITLE_LENGTH = 100
const MAX_DESC_LENGTH  = 2000
const MAX_SKILLS       = 15
const MAX_SKILL_LENGTH = 50

import { normalizeSkills } from "../utils/normalizeSkills.js"

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
  const applicantId = req.user._id

  if (!mongoose.Types.ObjectId.isValid(gigId)) {
    throw new ApiError(400, "Invalid gig ID format")
  }

  // Atomic apply — all guard checks in one DB round-trip
  const updatedGig = await Gig.findOneAndUpdate(
    {
      _id: gigId,
      status: "active",
      author: { $ne: applicantId },
      applicants: { $ne: applicantId },
    },
    { $addToSet: { applicants: applicantId } },
    { returnDocument: "after" }
  )

  if (!updatedGig) {
    const gig = await Gig.findById(gigId).lean()
    if (!gig)                                                                throw new ApiError(404, "Gig not found")
    if (String(gig.author) === String(applicantId))                          throw new ApiError(400, "You cannot apply to your own gig")
    if (gig.status !== "active")                                             throw new ApiError(400, "This gig is no longer accepting applications")
    if (gig.applicants.some((id) => String(id) === String(applicantId)))     throw new ApiError(409, "You have already applied to this gig")
    throw new ApiError(400, "Could not apply to this gig")
  }

  const authorId = updatedGig.author

  // ─── Create or reuse a ChatRoom between applicant and gig author ──────────────
  let chatRoom = await ChatRoom.findOne({
    participants: { $all: [applicantId, authorId] },
  })
  if (!chatRoom) {
    chatRoom = await ChatRoom.create({ participants: [applicantId, authorId] })
  }

  // ─── Emit real-time notification to gig owner ─────────────────────────────────
  const io = req.app.get("io")
  if (io) {
    const [applicantUser, applicantProfile] = await Promise.all([
      User.findById(applicantId).select("name").lean(),
      Profile.findOne({ user: applicantId }).select("photoUrl bio skills").lean(),
    ])

    io.to(`user:${String(authorId)}`).emit("gig-application", {
      gigId:  updatedGig._id,
      gigTitle: updatedGig.title,
      roomId: chatRoom._id,
      applicant: {
        _id:      applicantId,
        name:     applicantUser?.name,
        photoUrl: applicantProfile?.photoUrl || null,
        bio:      applicantProfile?.bio || "",
        skills:   applicantProfile?.skills || [],
      },
    })
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      { gigId: updatedGig._id, applied: true, roomId: chatRoom._id },
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

// ─── postComment ──────────────────────────────────────────────────────────────
const postComment = asyncHandler(async (req, res) => {
  const { gigId } = req.params
  const authorId  = req.user._id
  const { text }  = req.body

  if (!mongoose.Types.ObjectId.isValid(gigId)) {
    throw new ApiError(400, "Invalid gig ID format")
  }
  if (!text?.trim()) throw new ApiError(400, "Comment text is required")
  if (text.trim().length > 500) throw new ApiError(400, "Comment cannot exceed 500 characters")

  const gig = await Gig.findOne({ _id: gigId, status: "active" }).select("author title").lean()
  if (!gig) throw new ApiError(404, "Gig not found or no longer active")

  const comment = await GigComment.create({ gig: gigId, author: authorId, text: text.trim() })
  await comment.populate("author", "name")

  // Fetch commenter's profile photo for socket payload
  const authorProfile = await Profile.findOne({ user: authorId }).select("photoUrl skills").lean()

  // Notify gig owner in real-time (skip if commenter IS owner)
  if (String(gig.author) !== String(authorId)) {
    const io = req.app.get("io")
    if (io) {
      io.to(`user:${String(gig.author)}`).emit("gig-comment", {
        gigId,
        gigTitle: gig.title,
        comment: {
          _id:       comment._id,
          text:      comment.text,
          createdAt: comment.createdAt,
          author: {
            _id:      authorId,
            name:     comment.author.name,
            photoUrl: authorProfile?.photoUrl || null,
            skills:   authorProfile?.skills   || [],
          },
        },
      })
    }
  }

  return res.status(201).json(new ApiResponse(201, comment, "Comment posted successfully"))
})

// ─── getComments ─────────────────────────────────────────────────────────────
const getComments = asyncHandler(async (req, res) => {
  const { gigId } = req.params

  if (!mongoose.Types.ObjectId.isValid(gigId)) {
    throw new ApiError(400, "Invalid gig ID format")
  }

  const comments = await GigComment.find({ gig: gigId })
    .populate("author", "name")
    .sort({ createdAt: 1 })
    .lean()

  // Attach profile photos in one batch query
  const authorIds = [...new Set(comments.map((c) => String(c.author._id)))]
  const profiles  = await Profile.find({ user: { $in: authorIds } }).select("user photoUrl skills").lean()
  const profileMap = profiles.reduce((acc, p) => { acc[String(p.user)] = p; return acc }, {})

  const enriched = comments.map((c) => ({
    ...c,
    author: {
      ...c.author,
      photoUrl: profileMap[String(c.author._id)]?.photoUrl || null,
      skills:   profileMap[String(c.author._id)]?.skills   || [],
    },
  }))

  return res.status(200).json(new ApiResponse(200, enriched, "Comments fetched successfully"))
})

// ─── dmCommenter (gig owner opens a DM with a commenter) ────────────────────
const dmCommenter = asyncHandler(async (req, res) => {
  const { gigId, commenterId } = req.params
  const ownerId = req.user._id

  if (!mongoose.Types.ObjectId.isValid(gigId) || !mongoose.Types.ObjectId.isValid(commenterId)) {
    throw new ApiError(400, "Invalid ID format")
  }
  if (String(ownerId) === String(commenterId)) {
    throw new ApiError(400, "You cannot DM yourself")
  }

  // Verify requester owns this gig
  const gig = await Gig.findOne({ _id: gigId, author: ownerId }).select("_id").lean()
  if (!gig) throw new ApiError(403, "You do not own this gig")

  // Verify the target actually commented on this gig
  const commented = await GigComment.exists({ gig: gigId, author: commenterId })
  if (!commented) throw new ApiError(404, "That user has not commented on this gig")

  // Find or create a chatroom
  let chatRoom = await ChatRoom.findOne({ participants: { $all: [ownerId, commenterId] } })
  if (!chatRoom) {
    chatRoom = await ChatRoom.create({ participants: [ownerId, commenterId] })
  }

  return res.status(200).json(
    new ApiResponse(200, { roomId: chatRoom._id }, "Chat room ready")
  )
})

export { postComment, getComments, dmCommenter }