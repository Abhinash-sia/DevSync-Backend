import User from "../models/user.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ─── getUsageStats ────────────────────────────────────────────────────────────
export const getUsageStats = asyncHandler(async (req, res) => {
  // Get total users
  const totalUsers = await User.countDocuments();

  // Get active users today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const activeToday = await User.countDocuments({
    lastLogin: { $gte: startOfDay },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      { totalUsers, activeToday },
      "Usage statistics fetched successfully"
    )
  );
});
