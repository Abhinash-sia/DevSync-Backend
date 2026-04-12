import { Router } from "express";
import {
  getMyChatRooms,
  getChatHistory,
  sendMessage,
} from "../controllers/chat.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router.get("/rooms", getMyChatRooms);
router.get("/:chatRoomId/messages", getChatHistory);
router.post("/:chatRoomId/send", sendMessage);

export default router;