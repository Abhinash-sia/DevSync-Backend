import mongoose, { Schema } from "mongoose";

const profileSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    bio: {
      type: String,
      maxlength: [500, "Bio cannot exceed 500 characters"],
      default: "",
      trim: true,
    },
    skills: {
      type: [String],
      default: [],
    },
    githubUrl: {
      type: String,
      default: "",
      trim: true,
    },
    linkedinUrl: {
      type: String,
      default: "",
      trim: true,
    },
    photoUrl: {
      type: String,
      default: "",
      trim: true,
    },
    photoPublicId: {
      type: String,
      default: "",
    },
    resumeUrl: {
      type: String,
      default: "",
      trim: true,
    },
    location: {
      type: String,
      default: "",
      trim: true,
    },
    codeSnippet: {
      code: {
        type: String,
        maxlength: [1000, "Code snippet cannot exceed 1000 characters"],
        default: "",
      },
      language: {
        type: String,
        default: "javascript",
      },
      title: {
        type: String,
        maxlength: [50, "Title cannot exceed 50 characters"],
        default: "",
      }
    },
    lookingFor: {
      type: String,
      enum: ["hackathon", "freelance", "cofounder", "openSource", ""],
      default: "",
    },
  },
  { timestamps: true }
);

const Profile = mongoose.model("Profile", profileSchema);
export default Profile;