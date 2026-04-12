import mongoose, { Schema } from "mongoose";

const matchSchema = new Schema(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["interested", "ignored", "accepted", "rejected"],
      default: "interested",
    },
  },
  { timestamps: true }
);


matchSchema.index({ sender: 1, receiver: 1 }, { unique: true });

const Match = mongoose.model("Match", matchSchema);
export default Match;