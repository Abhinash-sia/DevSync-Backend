import { v2 as cloudinary } from "cloudinary"
import fs from "fs"

// Issue #6 Fix: Validate credentials at module load — fail fast, not at upload time
const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  throw new Error(
    "Missing Cloudinary credentials — check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"
  )
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true, // always return HTTPS URLs
})

// Issue #5 Fix: Safe async unlink — no TOCTOU, handles already-deleted files gracefully
const unlinkSafe = async (filePath) => {
  if (!filePath) return
  try {
    await fs.promises.unlink(filePath) // Issue #4 Fix: async — non-blocking
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[Cloudinary] Failed to delete temp file ${filePath}:`, err.message)
    }
  }
}

// ─── uploadOnCloudinary ───────────────────────────────────────────────────────
const uploadOnCloudinary = async (localFilePath) => {
  if (!localFilePath) throw new Error("localFilePath is required")

  try {
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "image",             // Issue #3 Fix: explicit — reject videos/raw files
      folder: "devsync/profiles",
      transformation: [
        { width: 500, height: 500, crop: "fill", gravity: "face" },
        { quality: "auto:good" },
        { fetch_format: "auto" },
      ],
    })

    // Issue #7 Fix: Return stable internal shape — don't expose raw Cloudinary response
    return {
      secure_url: response.secure_url,
      public_id:  response.public_id,
      format:     response.format,
      width:      response.width,
      height:     response.height,
    }
  } finally {
    // Issue #1 Fix: Always clean up temp file — regardless of success or failure
    // Cleanup is here so callers don't need to manage temp files at all
    await unlinkSafe(localFilePath)
  }
  // Issue #1 Fix: Errors propagate to caller — no silent null return
}

// ─── deleteFromCloudinary ─────────────────────────────────────────────────────
// Issue #2 Fix: This function was missing but imported by profile.controller.js
const deleteFromCloudinary = async (publicId) => {
  if (!publicId) throw new Error("publicId is required for deletion")
  const result = await cloudinary.uploader.destroy(publicId)
  return result
}

export { uploadOnCloudinary, deleteFromCloudinary }