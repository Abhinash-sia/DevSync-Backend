import { Router } from "express";
import {
  swipeDeveloper,
  getDiscoveryFeed,
  getConnections,
} from "../controllers/match.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/feed", getDiscoveryFeed);
router.post("/swipe/:userId", swipeDeveloper);
router.get("/connections", getConnections);

export default router;