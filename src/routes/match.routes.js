import { Router } from "express";
import {
  swipeDeveloper,
  getDiscoveryFeed,
  getConnections,
  getMatchStatus,
} from "../controllers/match.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/feed", getDiscoveryFeed);
router.post("/swipe/:userId", swipeDeveloper);
router.get("/connections", getConnections);
router.get("/status/:userId", getMatchStatus);

export default router;