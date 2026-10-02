// ═══════════════════════════════════════════════════════════════════════════
// OpenRouter LLM provider
// Two paths:
//   streamChat()  — SSE streaming, used by VSmart Chat (ChatGPT-style page)
//   callChat()    — Non-streaming, used by VSmart Voice agentic loop
// Both share the same model cascade and abort management.
// ═══════════════════════════════════════════════════════════════════════════

export type ReplyLang = "en" | "hi";

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export type ApiMessage = {
  role: "system" | "user" | "assistant";
  content: string | { type: "text"; text: string }[] | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
};

const OPENROUTER_URL    = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT   = 30_000;

// Cascade of free models — tried in order until one succeeds.
// Verified October 2026: https://openrouter.ai/models?max_price=0
export const CHAT_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
  "nex-agi/nex-n2.5-pro:free",
  "openrouter/free",
];
export const CODER_MODELS = [
  "cohere/north-mini-code:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openrouter/free",
];
export const VISION_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nex-agi/nex-n2.5-pro:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
];

// ── API key ──────────────────────────────────────────────────────────────────
let cachedKey: string | null | undefined;

export async function getApiKey(): Promise<string> {
  if (cachedKey !== undefined) return cachedKey ?? "";
  try {
    const stored = await window.vsmart.apiKey.get();
    if (stored) { cachedKey = stored; return stored; }
  } catch { /* not available in main process context */ }
  const envKey = import.meta.env.VITE_OPENROUTER_API_KEY ?? "";
  cachedKey = envKey || null;
  return envKey;
}

export function invalidateApiKeyCache(): void { cachedKey = undefined; }

// ── Abort management ─────────────────────────────────────────────────────────
// One controller per "user session" — a new message aborts the previous one
// so only the latest answer ever reaches the UI.
let activeController: AbortController | null = null;

function startRequest(): AbortController {
  activeController?.abort();
  const c = new AbortController();
  activeController = c;
  return c;
}
function endRequest(c: AbortController) {
  if (activeController === c) activeController = null;
}

// ── Core fetch ───────────────────────────────────────────────────────────────
async function fetchCompletion(
  apiKey: string,
  model: string,
  messages: ApiMessage[],
  stream: false,
  maxTokens?: number
): Promise<string>;
async function fetchCompletion(
  apiKey: string,
  model: string,
  messages: ApiMessage[],
  stream: true,
  maxTokens: number,
  onChunk: (delta: string, accumulated: string) => void
): Promise<string>;
async function fetchCompletion(
  apiKey: string,
  model: string,
  messages: ApiMessage[],
  stream: boolean,
  maxTokens = 2048,
  onChunk?: (delta: string, accumulated: string) => void
): Promise<string> {
  if (!apiKey) throw new Error("OpenRouter API key missing. Add it in Settings.");

  const controller = startRequest();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    if (import.meta.env.MODE !== "production") console.log("[LLM] model:", model);

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://vsmart.local",
        "X-Title": "VSmart AI",
      },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens, stream }),
    });

    clearTimeout(timer);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as any)?.error?.message || res.statusText);
    }

    // ── Streaming ──
    if (stream && res.body) {
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", total = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t || t === "data: [DONE]" || !t.startsWith("data:")) continue;
          try {
            const delta: string = JSON.parse(t.slice(5).trim())?.choices?.[0]?.delta?.content ?? "";
            if (delta) { total += delta; onChunk?.(delta, total); }
          } catch { /* malformed SSE chunk — skip */ }
        }
      }
      return total.trim();
    }

    // ── Non-streaming ──
    const data = await res.json();
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error("Empty response from model.");
    return answer.trim();

  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new DOMException("Request superseded or timed out.", "AbortError");
    }
    throw err;
  } finally {
    endRequest(controller);
  }
}

// ── With-fallback helpers ─────────────────────────────────────────────────────
// Try models in order; stop on AbortError (user sent new message).

export async function streamWithFallback(
  apiKey: string,
  models: string[],
  messages: ApiMessage[],
  onChunk: (delta: string, accumulated: string) => void,
  maxTokens = 1024
): Promise<string> {
  if (!apiKey) throw new Error("OpenRouter API key missing.");
  let last: unknown;
  for (const model of models) {
    try {
      return await fetchCompletion(apiKey, model, messages, true, maxTokens, onChunk);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      console.warn("[LLM] stream fallback:", model, (e as Error).message);
      last = e;
    }
  }
  throw last ?? new Error("All models failed.");
}

export async function callWithFallback(
  apiKey: string,
  models: string[],
  messages: ApiMessage[],
  maxTokens = 2048
): Promise<string> {
  if (!apiKey) throw new Error("OpenRouter API key missing.");
  let last: unknown;
  for (const model of models) {
    try {
      return await fetchCompletion(apiKey, model, messages, false, maxTokens);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      console.warn("[LLM] call fallback:", model, (e as Error).message);
      last = e;
    }
  }
  throw last ?? new Error("All models failed.");
}

// ── Language helpers ──────────────────────────────────────────────────────────
export function langRule(lang: ReplyLang): string {
  return lang === "hi"
    ? "Hamesha sirf Hindi mein jawab do (Devanagari script). English technical terms naturally mix kar sakte ho (Hinglish theek hai)."
    : "Always reply in English only.";
}

// ── Coding helpers (used by codingAgent) ─────────────────────────────────────
export async function askQwenCoder(prompt: string, lang: ReplyLang = "en"): Promise<string> {
  const key = await getApiKey();
  return callWithFallback(key, CODER_MODELS, [
    { role: "system", content: `You are an expert programmer. ${langRule(lang)} Reply with code only, no explanations unless asked.` },
    { role: "user", content: prompt },
  ]);
}

export async function askQwenCoderProject(request: string): Promise<string> {
  const key = await getApiKey();
  return callWithFallback(key, CODER_MODELS, [
    {
      role: "system",
      content: "You are an expert programmer. Return ONLY valid JSON, no markdown, no explanation.",
    },
    {
      role: "user",
      content: `Plan a project for: "${request}"\n\nReturn ONLY this JSON shape:\n{"projectFolder":"kebab-name","files":[{"path":"relative/path","content":"full code"}],"commands":["optional setup command"]}\n\nUse real working code. Use relative paths only. Only include commands if genuinely needed (e.g. npm install).`,
    },
  ]);
}

export async function askQwenCoderReview(
  request: string,
  files: { path: string; content: string }[]
): Promise<string> {
  const key = await getApiKey();
  const filesBlock = files.map(f => `--- ${f.path} ---\n${f.content}`).join("\n\n");
  return callWithFallback(key, CODER_MODELS, [
    { role: "system", content: "You are an expert code reviewer. Return ONLY valid JSON, no markdown." },
    {
      role: "user",
      content: `Review for bugs. Request: "${request}"\n\n${filesBlock}\n\nReturn ONLY:\n{"summary":"2-4 sentence summary","fixedFiles":[{"path":"path","content":"fixed code"}]}\n\nOnly include files you actually changed.`,
    },
  ]);
}

export async function askVision(prompt: string, imageDataUrl: string, lang: ReplyLang = "en"): Promise<string> {
  const key = await getApiKey();
  return callWithFallback(key, VISION_MODELS, [
    { role: "system", content: `You analyze screen content and answer questions about it. ${langRule(lang)}` },
    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl } }] },
  ]);
}

export function isCodingPrompt(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return ["code","coding","program","function","class","bug","error","debug","script",
    "python","javascript","typescript","java","c++","c#","react","node","express",
    "nextjs","html","css","tailwind","sql","mongodb","api","json","regex","algorithm",
    "compile","syntax","refactor","fix","build","npm","yarn","vite","electron",
  ].some(w => p.includes(w));
}
