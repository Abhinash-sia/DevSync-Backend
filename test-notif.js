import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config({ path: "/home/abhi/dev-sync/devsync-backend/.env" });
import Notification from "./src/models/notification.model.js";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const docs = await Notification.find();
  console.log("Notifications count:", docs.length);
  if (docs.length > 0) console.log(docs[0]);
  process.exit();
}
run();
