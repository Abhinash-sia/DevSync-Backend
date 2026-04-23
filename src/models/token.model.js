import mongoose, { Schema } from "mongoose";

const tokenSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "User",
  },
  token: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 3600, // MongoDB TTL index: Document will be automatically deleted after 3600 seconds (1 hour)
  },
});

const Token = mongoose.model("Token", tokenSchema);
export default Token;
