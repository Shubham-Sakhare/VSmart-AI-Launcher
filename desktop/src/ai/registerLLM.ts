import { registerLLM } from "./dynamic";
import { getApiKey } from "../llm/openrouter";

// Helper calls (planner, natural replies, confirmations) use their OWN fetch,
// not callWithFallback(). openrouter.ts keeps one shared AbortController, so a
// helper call through it would abort the main chat answer (and vice versa).
//
// Fast models first. If replies come back empty, raise maxTokens in
// dynamic.ts or move a non-reasoning model to the top of this list.
const URL = "https://openrouter.ai/api/v1/chat/completions";
const FAST_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
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