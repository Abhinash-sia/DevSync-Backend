import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config({ path: "/home/abhi/dev-sync/devsync-backend/.env" });
import Notification from "./src/models/notification.model.js";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const recipientId = new mongoose.Types.ObjectId('69e8a0ac588c7bd3cb1de40f');
  const notifications = await Notification.aggregate([
    { $match: { recipient: recipientId } },
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
  ]);
  console.log(JSON.stringify(notifications, null, 2));
  process.exit();
}
run();
