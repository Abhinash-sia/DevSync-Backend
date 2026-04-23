import fs from "fs"
import mongoose from "mongoose"
import Profile from "../models/profile.model.js"
import User from "../models/user.model.js"
import ChatRoom from "../models/chatroom.model.js"
import Gig from "../models/gig.model.js"
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_BIO_LENGTH        = 500
const MAX_LOOKINGFOR_LENGTH = 300
const MAX_LOCATION_LENGTH   = 100
const ALLOWED_MIME_TYPES    = ["image/jpeg", "image/png", "image/webp"]
const MAX_PHOTO_SIZE        = 5 * 1024 * 1024

import { normalizeSkills } from "../utils/normalizeSkills.js"

// ─── URL validator ────────────────────────────────────────────────────────────
// Issue #8 Fix: Validates URL protocol + optional hostname enforcement
const isValidUrl = (url, requiredHostname) => {
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol)) return false
    if (requiredHostname && !parsed.hostname.endsWith(requiredHostname)) return false
    return true
  } catch { return false }
}

// ─── getOwnProfile ────────────────────────────────────────────────────────────
const getOwnProfile = asyncHandler(async (req, res) => {
  // Issue #5 Fix: Run both queries in parallel
  // Issue #7 Fix: Compute real stats instead of hardcoded zeros
  const [user, profile, connectionsCount, gigsPostedCount] = await Promise.all([
    User.findById(req.user._id).select("-password -refreshToken"),
    Profile.findOne({ user: req.user._id }),
    ChatRoom.countDocuments({ participants: req.user._id }),
    Gig.countDocuments({ author: req.user._id, status: "active" }),
  ])

  if (!user) throw new ApiError(404, "User not found")

  const data = {
    user,
    profile: profile || null,
    bio:         profile?.bio         ?? "",
    skills:      profile?.skills?.length ? profile.skills : [],
    photoUrl:    profile?.photoUrl    || "",
    githubUrl:   profile?.githubUrl   || "",
    linkedinUrl: profile?.linkedinUrl || "",
    location:    profile?.location    || "",
    lookingFor:  profile?.lookingFor  || "",
    codeSnippet: profile?.codeSnippet || { code: "", language: "javascript", title: "" },
    // Issue #7 Fix: Real computed stats
    stats: { connections: connectionsCount, gigsPosted: gigsPostedCount },
  }

  return res.status(200).json(new ApiResponse(200, data, "Profile fetched successfully"))
})

// ─── getPublicProfile ─────────────────────────────────────────────────────────
const getPublicProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params

  // Issue #2 Fix: Validate ObjectId format before DB call
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid user ID format")
  }

  // Issue #5 Fix: Parallel queries
  const [user, profile] = await Promise.all([
    User.findById(userId).select("-password -refreshToken"),
    Profile.findOne({ user: userId }),
  ])

  if (!user) throw new ApiError(404, "User not found")

  const data = {
    user: {
      _id:       user._id,
      name:      user.name,
      // Issue #1 Fix: email REMOVED — public endpoint must never expose email
      bio:       profile?.bio         ?? "",
      skills:    profile?.skills?.length ? profile.skills : [],
      photoUrl:  profile?.photoUrl    || "",
      githubUrl: profile?.githubUrl   || "",
      codeSnippet: profile?.codeSnippet || null,
      createdAt: user.createdAt,
    },
  }

  return res.status(200).json(new ApiResponse(200, data, "Public profile fetched successfully"))
})

// ─── updateProfile ────────────────────────────────────────────────────────────
const updateProfile = asyncHandler(async (req, res) => {
  const { bio, skills, githubUrl, linkedinUrl, lookingFor, location, codeSnippet } = req.body

  // Issue #9 Fix: Length limits on all text fields
  if (bio !== undefined && bio.length > MAX_BIO_LENGTH) {
    throw new ApiError(400, `Bio cannot exceed ${MAX_BIO_LENGTH} characters`)
  }
  if (lookingFor !== undefined && lookingFor.length > MAX_LOOKINGFOR_LENGTH) {
    throw new ApiError(400, `lookingFor cannot exceed ${MAX_LOOKINGFOR_LENGTH} characters`)
  }
  if (location !== undefined && location.length > MAX_LOCATION_LENGTH) {
    throw new ApiError(400, `Location cannot exceed ${MAX_LOCATION_LENGTH} characters`)
  }
  if (codeSnippet?.code !== undefined && codeSnippet.code.length > 1000) {
    throw new ApiError(400, `Code snippet cannot exceed 1000 characters`)
  }

  // Issue #8 Fix: Validate URLs before saving
  if (githubUrl !== undefined && githubUrl !== "") {
    if (!isValidUrl(githubUrl, "github.com")) {
      throw new ApiError(400, "githubUrl must be a valid GitHub URL")
    }
  }
  if (linkedinUrl !== undefined && linkedinUrl !== "") {
    if (!isValidUrl(linkedinUrl, "linkedin.com")) {
      throw new ApiError(400, "linkedinUrl must be a valid LinkedIn URL")
    }
  }

  const parsedSkills = skills !== undefined ? normalizeSkills(skills) : undefined

  // Issue #3 Fix: Write to Profile ONLY — User model is for auth data only
  const profileUpdateData = {}
  if (bio         !== undefined) profileUpdateData.bio         = bio.trim()
  if (githubUrl   !== undefined) profileUpdateData.githubUrl   = githubUrl.trim()
  if (linkedinUrl !== undefined) profileUpdateData.linkedinUrl = linkedinUrl.trim()
  if (lookingFor  !== undefined) profileUpdateData.lookingFor  = lookingFor.trim()
  if (location    !== undefined) profileUpdateData.location    = location.trim()
  if (parsedSkills !== undefined) profileUpdateData.skills     = parsedSkills
  if (codeSnippet !== undefined) profileUpdateData.codeSnippet = codeSnippet

  const updatedProfile = await Profile.findOneAndUpdate(
    { user: req.user._id },
    { $set: profileUpdateData, $setOnInsert: { user: req.user._id } },
    { returnDocument: "after", upsert: true, runValidators: true }
  )

  return res.status(200).json(
    new ApiResponse(200, { profile: updatedProfile }, "Profile updated successfully")
  )
})

// ─── uploadProfilePhoto ───────────────────────────────────────────────────────
const uploadProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file?.path) throw new ApiError(400, "Photo file is required")

  // Issue #6 Fix: Validate file type and size before uploading to Cloudinary
  if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
    await fs.promises.unlink(req.file.path).catch(() => {})
    throw new ApiError(415, "Only JPEG, PNG, or WebP images are accepted")
  }
  if (req.file.size > MAX_PHOTO_SIZE) {
    await fs.promises.unlink(req.file.path).catch(() => {})
    throw new ApiError(413, "Photo must be under 5MB")
  }

  // Issue #4 Fix: Fetch existing photo's Cloudinary public_id for deletion after upload
  const existingProfile = await Profile.findOne({ user: req.user._id })
    .select("photoPublicId")
    .lean()

  let uploaded
  try {
    uploaded = await uploadOnCloudinary(req.file.path)
  } catch (err) {
    throw new ApiError(500, "Photo upload failed")
  }
  // Note: temp file cleanup is handled by cloudinary.js internally

  if (!uploaded?.secure_url) throw new ApiError(500, "Photo upload failed")

  // Issue #4 Fix: Delete old Cloudinary image after new one is confirmed uploaded
  if (existingProfile?.photoPublicId) {
    await deleteFromCloudinary(existingProfile.photoPublicId).catch((err) =>
      console.error("[Profile] Failed to delete old Cloudinary photo:", err.message)
    )
  }

  // Issue #3 Fix: Write to Profile ONLY — not to User model
  const updatedProfile = await Profile.findOneAndUpdate(
    { user: req.user._id },
    {
      $set: { photoUrl: uploaded.secure_url, photoPublicId: uploaded.public_id },
      $setOnInsert: { user: req.user._id },
    },
    { returnDocument: "after", upsert: true }
  )

  return res.status(200).json(
    new ApiResponse(200, { photoUrl: uploaded.secure_url, profile: updatedProfile }, "Profile photo uploaded successfully")
  )
})

// ─── getAllProfiles ───────────────────────────────────────────────────────────
const getAllProfiles = asyncHandler(async (req, res) => {
  const { search, sortBy = "newest", dateFrom, dateTo } = req.query;

  const matchStage = {};

  if (dateFrom || dateTo) {
    matchStage.createdAt = {};
    if (dateFrom) matchStage.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchStage.createdAt.$lte = new Date(dateTo);
  }

  const searchRegex = search ? { $regex: search, $options: "i" } : null;

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: "profiles",
        localField: "_id",
        foreignField: "user",
        as: "profileData"
      }
    },
    {
      $unwind: { 
        path: "$profileData", 
        preserveNullAndEmptyArrays: true 
      }
    }
  ];

  if (searchRegex) {
    pipeline.push({
      $match: {
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { "profileData.bio": searchRegex },
          { "profileData.skills": searchRegex }
        ]
      }
    });
  }

  pipeline.push({
    $sort: { createdAt: sortBy === "oldest" ? 1 : -1 }
  });

  pipeline.push({
    $project: {
      password: 0,
      refreshToken: 0
    }
  });

  const rawUsers = await User.aggregate(pipeline);

  const formattedUsers = rawUsers.map(u => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt,
    bio: u.profileData?.bio || "",
    skills: u.profileData?.skills || [],
    photoUrl: u.profileData?.photoUrl || "",
    githubUrl: u.profileData?.githubUrl || "",
    location: u.profileData?.location || "",
    lookingFor: u.profileData?.lookingFor || ""
  }));

  return res.status(200).json(
    new ApiResponse(200, formattedUsers, "Directory fetched successfully")
  );
});

export { getOwnProfile, getPublicProfile, updateProfile, uploadProfilePhoto, getAllProfiles }