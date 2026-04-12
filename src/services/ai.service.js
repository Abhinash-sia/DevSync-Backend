import { GoogleGenerativeAI } from "@google/generative-ai";
import logger from "../utils/logger.js";

// Validate API key at module load — fail fast, not at request time
if (!process.env.GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY — AI features will not work");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Single constant — one place to update when upgrading models
const GEMINI_MODEL = "gemini-2.0-flash";

// Retry on transient 429/503 errors from Gemini
const generateWithRetry = async (model, prompt, retries = 2) => {
  for (let i = 0; i <= retries; i++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1))); // 1s, 2s backoff
    }
  }
};

// ─── PARSE RESUME TEXT → structured skills data ───────────────────────────────
const parseResumeWithAI = async (resumeText) => {
  // Validate and truncate — prevents empty input and quota burning on huge PDFs
  if (!resumeText?.trim()) return { skills: [], bio: "", lookingFor: "" };
  const truncatedText = resumeText.slice(0, 8000); // ~2000 tokens — enough for any resume

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `
    You are an expert technical recruiter and resume parser.
    Extract information from the following resume text and return a JSON object.

    STRICT RULES:
    1. Return ONLY valid JSON — no markdown, no backticks, no explanation text
    2. If a field cannot be found, use an empty array [] or empty string ""
    3. skills must only contain actual programming languages, frameworks, and databases

    Required JSON format:
    {
      "skills": ["array of up to 8 core programming languages/frameworks"],
      "bio": "one sentence professional summary (max 150 chars)",
      "lookingFor": "one of: hackathon, freelance, cofounder, openSource, or empty string"
    }

    Resume text:
    ${truncatedText}
  `;

  try {
    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();

    // Bulletproof JSON extraction — finds first { and last } to ignore any conversational text
    const jsonStart = responseText.indexOf("{");
    const jsonEnd = responseText.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error("AI did not return valid JSON format");
    }

    const parsed = JSON.parse(responseText.slice(jsonStart, jsonEnd + 1));

    // Validate response shape — Gemini occasionally ignores field names from prompt
    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 8) : [],
      bio: typeof parsed.bio === "string" ? parsed.bio.slice(0, 150) : "",
      lookingFor: [
        "hackathon",
        "freelance",
        "cofounder",
        "openSource",
      ].includes(parsed.lookingFor)
        ? parsed.lookingFor
        : "",
    };
  } catch (err) {
    // Return safe fallback — resume parse failure is non-fatal, user can fill manually
    logger.error("AI resume parse error:", err.message);
    return { skills: [], bio: "", lookingFor: "" };
  }
};

// ─── GENERATE ICEBREAKER MESSAGE for a new match ──────────────────────────────
const generateIcebreaker = async (
  userAStack,
  userBStack,
  userAName,
  userBName,
) => {
  // Handle empty stacks gracefully — don't send blank lines to Gemini
  const stackA = userAStack?.length
    ? userAStack.join(", ")
    : "various technologies";
  const stackB = userBStack?.length
    ? userBStack.join(", ")
    : "various technologies";

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `
    You are a friendly developer community bot.
    Two developers just matched on DevSync:
    - ${userAName} works with: ${stackA}
    - ${userBName} works with: ${stackB}

    Write a single, natural, friendly icebreaker message (max 50 words) they can use to start chatting.
    Focus on their complementary tech stacks and potential collaboration.
    Return ONLY the message text — no labels, no quotes.
  `;

  try {
    const result = await generateWithRetry(model, prompt);
    return result.response
      .text()
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch (err) {
    logger.error("AI icebreaker error:", err.message);
    return "Hey! I saw we both have complementary stacks. What are you building right now?";
  }
};

export { parseResumeWithAI, generateIcebreaker };

