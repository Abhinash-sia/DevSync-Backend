import { Router } from "express";
import {
  createGig,
  getGigFeed,
  applyToGig,
  getMyGigs,
} from "../controllers/gig.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/feed", getGigFeed);
router.post("/create", createGig);
router.post("/apply/:gigId", applyToGig);
router.get("/my-gigs", getMyGigs);

export default router;