import { Router } from "express";
import { parseResume } from "../controllers/ai.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = Router();

router.use(verifyJWT);

// POST /api/v1/ai/parse-resume
// upload.single("resume") = expect one file with field name "resume"
router.route("/parse-resume").post(
  upload.single("resume"),
  parseResume
);

export default router;