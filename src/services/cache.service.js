import redis from "../config/redis.js"

// Helper to check if we can safely query Redis
const isCacheReady = () => redis.status === "ready"

const setCache = async (key, data, ttlSeconds = 3600) => {
  if (!isCacheReady()) return false
  try {
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds)
    return true
  } catch (err) {
    console.error(`[Cache Set Error] ${key}:`, err.message)
    return false
  }
}

const getCache = async (key) => {
  if (!isCacheReady()) return null
  try {
    const data = await redis.get(key)
    return data ? JSON.parse(data) : null
  } catch (err) {
    console.error(`[Cache Get Error] ${key}:`, err.message)
    return null
  }
}

const deleteCache = async (key) => {
  if (!isCacheReady()) return false
  try {
    await redis.del(key)
    return true
  } catch (err) {
    console.error(`[Cache Delete Error] ${key}:`, err.message)
    return false
  }
}

const deleteByPattern = async (pattern) => {
  if (!isCacheReady()) return 0
  try {
    let cursor = "0"
    const keysToDelete = []

    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100)
      cursor = nextCursor
      if (Array.isArray(keys) && keys.length) {
        keysToDelete.push(...keys)
      }
    } while (cursor !== "0")

    if (keysToDelete.length) {
      await redis.del(...keysToDelete)
    }
    return keysToDelete.length
  } catch (err) {
    console.error(`[Cache Pattern Delete Error] ${pattern}:`, err.message)
    return 0
  }
}

export { setCache, getCache, deleteCache, deleteByPattern }