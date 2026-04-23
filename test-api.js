import * as dotenv from 'dotenv';
dotenv.config({ path: "/home/abhi/dev-sync/devsync-backend/.env" });
import axios from "axios";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection;
    const r = await db.collection("users").findOne({ name: "kirito" });
    if (!r) { console.log("User not found"); process.exit(1); }
    
    const token = jwt.sign({ _id: r._id }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '10m' });
    
    try {
        const response = await axios.get("http://localhost:8000/api/v1/notifications", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        console.log("Response:", JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.log("Error:", e.response?.data || e.message);
    }
    process.exit();
}
run();
