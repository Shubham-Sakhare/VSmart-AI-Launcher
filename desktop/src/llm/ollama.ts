// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Ollama Local LLM Provider
//
// Connects to Ollama (free, local) running on localhost:11434.
// Provides same API shape as openrouter.ts so it's a drop-in swap.
//
// FREE models to install via: ollama pull <model>
//   • llama3.2:3b     — fast, 3B params, good for commands
//   • llama3.1:8b     — balanced quality/speed
//   • mistral:7b      — very capable, good reasoning
//   • qwen2.5:7b      — excellent for Hindi/multilingual
//   • phi3.5:mini     — tiny but smart
//   • deepseek-r1:7b  — strong reasoning/coding
//   • gemma2:9b       — Google's capable model
//
// All 100% FREE and run OFFLINE.
// ═══════════════════════════════════════════════════════════════════════════

import type { ApiMessage, ReplyLang } from "./openrouter";

const OLLAMA_BASE = "http://localhost:11434";

// ── Model preferences (in priority order) ────────────────────────────────────
// The first available model will be used.
export const OLLAMA_CHAT_MODELS = [
  "llama3.2:3b",
  "llama3.1:8b",
  "mistral:7b",
  "qwen2.5:7b",
  "phi3.5:mini",
  "gemma2:9b",
  "llama3:8b",
  "llama2:7b",
];

export const OLLAMA_CODER_MODELS = [
  "deepseek-coder-v2:16b",
  "qwen2.5-coder:7b",
  "codellama:7b",
  "codellama:13b",
  "deepseek-r1:7b",
  "llama3.1:8b",
];

export const OLLAMA_VISION_MODELS = [
  "llava:7b",
  "llava:13b",
  "llava-phi3:mini",
  "moondream:latest",
];

// ── Check if Ollama is running ────────────────────────────────────────────────
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Get installed models ─────────────────────────────────────────────────────
export async function getInstalledOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { models?: { name: string }[] };
    return (data.models ?? []).map(m => m.name);
  } catch {
    return [];
  }
}

// ── Pick best available model ────────────────────────────────────────────────
export async function pickBestModel(
  preferredList: string[],
  installed: string[]
): Promise<string | null> {
  const normalInstalled = installed.map(m => m.toLowerCase());
  for (const preferred of preferredList) {
    const match = normalInstalled.find(m =>
      m === preferred.toLowerCase() ||
      m.startsWith(preferred.toLowerCase().split(":")[0])
    );
    if (match) {
      // Return the actual installed model name (with tag)
      return installed[normalInstalled.indexOf(match)];
    }
  }
  // Return first installed model as fallback
  return installed[0] ?? null;
}

// ── Non-streaming Ollama call ────────────────────────────────────────────────
export async function ollamaCall(
  model: string,
  messages: ApiMessage[],
  maxTokens = 1024,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({
        role:    m.role,
        content: typeof m.content === "string" ? m.content : extractText(m.content),
      })),
      stream:  false,
      options: {
        num_predict:  maxTokens,
        temperature:  0.7,
        top_p:        0.9,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(data.error);
  return data.message?.content?.trim() ?? "";
}

// ── Streaming Ollama call ────────────────────────────────────────────────────
export async function ollamaStream(
  model: string,
  messages: ApiMessage[],
  onChunk: (delta: string, accumulated: string) => void,
  maxTokens = 2048,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({
        role:    m.role,
        content: typeof m.content === "string" ? m.content : extractText(m.content),
      })),
      stream:  true,
      options: {
        num_predict: maxTokens,
        temperature: 0.7,
        top_p:       0.9,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama stream error ${res.status}`);
  }

  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
          };
          if (data.message?.content) {
            accumulated += data.message.content;
            onChunk(data.message.content, accumulated);
          }
        } catch { /* partial JSON line, skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return accumulated;
}

// ── Helper: extract text from complex message content ────────────────────────
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c?.type === "text")
      .map(c => c.text)
      .join("\n");
  }
  return String(content);
}

// ── Ollama vision call ───────────────────────────────────────────────────────
export async function ollamaVision(
  model: string,
  prompt: string,
  imageBase64: string,    // raw base64, no data URL prefix
  lang: ReplyLang = "en"
): Promise<string> {
  const langHint = lang === "hi"
    ? "Respond in Hindi."
    : "Respond in English.";

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt:  `${langHint}\n\n${prompt}`,
      images:  [imageBase64],
      stream:  false,
      options: { num_predict: 512 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama vision error ${res.status}`);
  const data = await res.json() as { response?: string };
  return data.response?.trim() ?? "";
}
