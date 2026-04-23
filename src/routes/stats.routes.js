import { Router } from "express";
import { getUsageStats } from "../controllers/stats.controller.js";

const router = Router();

// Public route to get platform stats
router.route("/usage").get(getUsageStats);

export default router;
