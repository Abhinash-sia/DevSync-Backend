import mongoose, { Schema } from "mongoose";

const chatroomSchema = new Schema(
  {
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { timestamps: true }
);

chatroomSchema.index({ participants: 1 });
chatroomSchema.path("participants").validate(function (value) {
  return Array.isArray(value) && value.length >= 2;
}, "Chat room must have at least 2 participants");

const ChatRoom = mongoose.model("ChatRoom", chatroomSchema);
export default ChatRoom;