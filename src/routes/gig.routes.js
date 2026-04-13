import { Router } from "express";
import {
  createGig,
  getGigFeed,
  applyToGig,
  getMyGigs,
  postComment,
  getComments,
  dmCommenter,
} from "../controllers/gig.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/feed", getGigFeed);
router.post("/create", createGig);
router.post("/apply/:gigId", applyToGig);
router.get("/my-gigs", getMyGigs);

// ─── Comment routes ───────────────────────────────────────────────────────────
router.post("/:gigId/comment", postComment);
router.get("/:gigId/comments", getComments);

// ─── DM a commenter (gig-owner only) ─────────────────────────────────────────
router.post("/:gigId/dm/:commenterId", dmCommenter);

export default router;