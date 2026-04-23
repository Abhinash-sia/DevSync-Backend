import mongoose, { Schema } from "mongoose"

const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null, // Allow system notifications which won't have a sender
    },
    type: {
      type: String,
      enum: ["connection_request", "connection_accepted", "new_message", "system"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
)

const Notification = mongoose.model("Notification", notificationSchema)
export default Notification
