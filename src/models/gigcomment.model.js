import mongoose, { Schema } from "mongoose"

const gigCommentSchema = new Schema(
  {
    gig: {
      type: Schema.Types.ObjectId,
      ref: "Gig",
      required: true,
      index: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: [true, "Comment text is required"],
      trim: true,
      maxlength: [500, "Comment cannot exceed 500 characters"],
    },
  },
  { timestamps: true }
)

// Compound index for fast per-gig comment fetching sorted by time
gigCommentSchema.index({ gig: 1, createdAt: 1 })

const GigComment = mongoose.model("GigComment", gigCommentSchema)
export default GigComment
