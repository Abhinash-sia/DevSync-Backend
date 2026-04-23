import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  deleteAccount,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", verifyJWT, logoutUser);
router.post("/refresh", refreshAccessToken);
router.get("/me", verifyJWT, getCurrentUser);
router.delete("/delete-account", verifyJWT, deleteAccount);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:userId/:token", resetPassword);

export default router;