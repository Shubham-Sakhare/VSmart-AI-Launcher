import { registerLLM } from "./dynamic";
import { getApiKey } from "../llm/openrouter";

// Fast models first — these are used for planner, naturalReply, confirmations.
// Separate from main CHAT_MODELS to avoid shared AbortController interference.
// Verified November 2026.
const URL = "https://openrouter.ai/api/v1/chat/completions";
const FAST_MODELS = [
  "google/gemma-3-12b-it:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "openrouter/auto",
];
const PER_MODEL_TIMEOUT_MS = 2500;

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

registerLLM(async ({ system, user, maxTokens = 100, temperature = 0.5 }) => {
  const key = await getApiKey();
  if (!key) throw new Error("OpenRouter API key missing.");

  let lastErr: unknown;

  for (const model of FAST_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);

    try {
      const res = await fetch(URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://vsmart.local",
          "X-Title": "VSmart AI",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });

      clearTimeout(timer);
      if (!res.ok) throw new Error(`${model} HTTP ${res.status}`);

      const data = await res.json();
      const text = stripThinking(String(data?.choices?.[0]?.message?.content ?? ""));
      if (text) return text;

      throw new Error(`${model} returned empty content`);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      console.warn("[registerLLM] model failed, trying next:", model, (err as Error).message);
    }
  }

  throw lastErr ?? new Error("All fast models failed.");
});