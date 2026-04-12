import { Router } from "express";
import {
  getOwnProfile,
  getPublicProfile,
  updateProfile,
  uploadProfilePhoto,
} from "../controllers/profile.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = Router();

router.get("/", verifyJWT, getOwnProfile);
router.patch("/update", verifyJWT, updateProfile);
router.post(
  "/photo",
  verifyJWT,
  upload.single("photo"),
  uploadProfilePhoto
);

router.get("/:userId", getPublicProfile);

export default router;