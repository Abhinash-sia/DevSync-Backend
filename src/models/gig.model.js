import mongoose, { Schema } from "mongoose";

const gigSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: [true, "Gig title is required"],
      trim: true,
      maxlength: [120, "Title cannot exceed 120 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [1200, "Description cannot exceed 1200 characters"],
    },
    skills: {
      type: [String],
      default: [],
    },
    budget: {
      type: Number,
      default: null,
      min: [0, "Budget cannot be negative"],
    },
    status: {
      type: String,
      enum: ["active", "expired", "filled"],
      default: "active",
    },
    applicants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

gigSchema.index({ status: 1, createdAt: -1 });
gigSchema.index({ author: 1, createdAt: -1 });
gigSchema.index({ applicants: 1, createdAt: -1 });
gigSchema.index({ skills: 1 });

const Gig = mongoose.model("Gig", gigSchema);
export default Gig;