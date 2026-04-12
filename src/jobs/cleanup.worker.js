import cron from "node-cron"
import Match from "../models/match.model.js"
import Gig from "../models/gig.model.js"
import logger from "../utils/logger.js"

const BATCH_SIZE = 500

// ─── JOB 1: Delete stale ignored/rejected matches ────────────────────────────
// Runs every day at 3:00 AM IST
// "0 3 * * *" = minute(0) hour(3) every-day every-month every-weekday
const cleanRejectedMatches = cron.schedule("0 3 * * *", async () => {
  logger.info("🧹 CRON: Starting stale match cleanup...")
  const start = Date.now()

  try {
    // Issue #2 Fix: Use updatedAt — createdAt predates re-swipes
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Issue #4 Fix: Batch deletions to avoid full collection write lock
    let totalDeleted = 0
    let batchResult

    do {
      const staleIds = await Match.find({
        // Issue #1 Fix: "ignored" not "rejected" — that's what left-swipes save
        status: { $in: ["ignored", "rejected"] },
        updatedAt: { $lt: thirtyDaysAgo },
      })
        .select("_id")
        .limit(BATCH_SIZE)
        .lean()

      if (staleIds.length === 0) break

      batchResult = await Match.deleteMany({
        _id: { $in: staleIds.map((m) => m._id) },
      })

      totalDeleted += batchResult.deletedCount
      await new Promise((r) => setTimeout(r, 100)) // yield between batches
    } while (batchResult.deletedCount === BATCH_SIZE)

    // Issue #8 Fix: Log duration for observability
    logger.info(`🧹 CRON: Deleted ${totalDeleted} stale matches in ${Date.now() - start}ms`)
  } catch (err) {
    logger.error("CRON cleanup error (matches):", err)
  }
}, {
  scheduled: false,
  timezone: "Asia/Kolkata",
})

// ─── JOB 2: Expire old gig posts ─────────────────────────────────────────────
// Runs every day at 3:30 AM IST
const expireOldGigs = cron.schedule("30 3 * * *", async () => {
  logger.info("🧹 CRON: Starting gig expiration job...")
  const start = Date.now()

  try {
    // Issue #5 Fix: Also expire gigs with no expiresAt that are very old
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

    const result = await Gig.updateMany(
      {
        status: "active",
        $or: [
          { expiresAt: { $lt: new Date() } },
          { expiresAt: null, createdAt: { $lt: ninetyDaysAgo } },
        ],
      },
      { $set: { status: "expired" } }
    )

    logger.info(`🧹 CRON: Expired ${result.modifiedCount} gigs in ${Date.now() - start}ms`)
  } catch (err) {
    logger.error("CRON cleanup error (gigs):", err)
  }
}, {
  scheduled: false,
  timezone: "Asia/Kolkata",
})

// ─── Start / Stop ─────────────────────────────────────────────────────────────
const startCronJobs = () => {
  cleanRejectedMatches.start()
  expireOldGigs.start()
  logger.info("⏰ Cron jobs scheduled and running")
}

// Issue #3 Fix: Export stop function for graceful shutdown in server.js
const stopCronJobs = () => {
  cleanRejectedMatches.stop()
  expireOldGigs.stop()
  logger.info("⏰ Cron jobs stopped")
}

export { startCronJobs, stopCronJobs }