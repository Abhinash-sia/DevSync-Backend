/**
 * Normalize a skills input into a clean array of trimmed, non-empty strings.
 * Accepts: Array, JSON-encoded array string, or comma-separated string.
 */
const normalizeSkills = (value) => {
  if (!value) return []

  if (Array.isArray(value)) {
    return value.map((i) => String(i).trim()).filter(Boolean)
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map((i) => String(i).trim()).filter(Boolean)
      }
    } catch {}
    return value.split(",").map((i) => i.trim()).filter(Boolean)
  }

  return []
}

export { normalizeSkills }
