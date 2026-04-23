import mongoose from "mongoose"
import Notification from "../models/notification.model.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"

const getUserNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.aggregate([
    { $match: { recipient: new mongoose.Types.ObjectId(req.user._id) } },
    { $sort: { createdAt: -1 } },
    { $limit: 30 },
    {
      $lookup: {
        from: "users",
        localField: "sender",
        foreignField: "_id",
        as: "senderData"
      }
    },
    { $unwind: { path: "$senderData", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "profiles",
        localField: "sender",
        foreignField: "user",
        as: "profileData"
      }
    },
    { $unwind: { path: "$profileData", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        type: 1,
        message: 1,
        isRead: 1,
        createdAt: 1,
        sender: {
          _id: "$senderData._id",
          name: "$senderData.name",
          photoUrl: "$profileData.photoUrl"
        }
      }
    }
  ])

  return res.status(200).json(new ApiResponse(200, notifications, "Notifications fetched successfully"))
})

const markAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid Notification ID")
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: id, recipient: req.user._id },
    { $set: { isRead: true } },
    { new: true }
  )

  if (!notification) {
    throw new ApiError(404, "Notification not found")
  }

  return res.status(200).json(new ApiResponse(200, notification, "Notification marked as read"))
})

const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { recipient: req.user._id, isRead: false },
    { $set: { isRead: true } }
  )

  return res.status(200).json(new ApiResponse(200, null, "All notifications marked as read"))
})

export { getUserNotifications, markAsRead, markAllAsRead }
