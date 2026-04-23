import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";
dotenv.config({ path: "/home/abhi/dev-sync/devsync-backend/.env" });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection;
  const r = await db.collection("users").findOne({ name: "kirito" });
  if (!r) { console.log("User not found"); process.exit(1); }
  
  const token = jwt.sign({ _id: r._id }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '10m' });
  
  try {
      const response = await fetch("http://[::1]:8000/api/v1/notifications", {
          headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      console.log("REST API Response:", JSON.stringify(data, null, 2));
  } catch (e) {
      console.log("Error:", e.message);
  }
  process.exit();
}
run();
