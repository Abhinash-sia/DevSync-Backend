import './src/config/env.js';
import { GoogleGenerativeAI } from "@google/generative-ai";

async function test(modelName) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent("Say hello");
    console.log(`[${modelName}] Success:`, result.response.text());
  } catch (e) {
    if (e.status === 429) {
      console.log(`[${modelName}] Error 429 Quota Exceeded`);
    } else {
      console.log(`[${modelName}] Error:`, e.message);
    }
  }
}

async function run() {
  await test("gemini-2.5-flash");
  await test("gemini-2.0-flash-lite-001");
  await test("gemini-flash-latest");
}
run();
