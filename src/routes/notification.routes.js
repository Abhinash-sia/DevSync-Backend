import { Router } from "express"
import { getUserNotifications, markAsRead, markAllAsRead } from "../controllers/notification.controller.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"

const router = Router()

router.use(verifyJWT)

router.get("/", getUserNotifications)
router.patch("/read-all", markAllAsRead)
router.patch("/:id/read", markAsRead)

export default router
