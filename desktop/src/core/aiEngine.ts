// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - AI Engine (Updated)
//
// Two entry points:
//   askSmartChat()  — Streaming chat with JARVIS persona (JarvisPage)
//   askVoiceAgent() — Agentic tool-calling loop (voice commands)
//
// Both now use the unified LLM provider that tries Ollama first,
// then falls back to OpenRouter — so ₹0 cost when Ollama is running.
// ═══════════════════════════════════════════════════════════════════════════

import { agenticRoute } from "../ai/agenticRouter";
import {
  streamChat, callChat,
  type ApiMessage, type ReplyLang, type ChatHistoryMessage,
} from "../llm/llmProvider";
import {
  streamWithFallback, callWithFallback, getApiKey,
  CHAT_MODELS, langRule,
} from "../llm/openrouter";
import { buildSystemPrompt } from "./persona";
import { useAppStore } from "../store/appStore";
import type { RouteResult } from "../ai/router";

// ── JARVIS Chat (streaming) ───────────────────────────────────────────────────
// Used by JarvisPage for the streaming ChatGPT-style experience.
// Uses the JARVIS persona system prompt and the unified LLM provider.
export async function askSmartChat(
  prompt:  string,
  lang:    ReplyLang = "en",
  history: ChatHistoryMessage[] = [],
  onChunk: (delta: string, accumulated: string) => void
): Promise<string> {
  const { persona } = useAppStore.getState();

  // Get memory facts for context
  let memFacts = "";
  try {
    const facts = await window.vsmart.longMemory.searchFacts(prompt, 5);
    if (facts?.length) {
      memFacts = facts.map((f: { key: string; value: string }) => `• ${f.key}: ${f.value}`).join("\n");
    }
  } catch { /* non-fatal */ }

  const systemPrompt = buildSystemPrompt(persona, lang, memFacts);

  const messages: ApiMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-12).map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: prompt },
  ];

  // Try unified provider (Ollama → OpenRouter)
  try {
    return await streamChat(messages, onChunk, 2048);
  } catch (e) {
    // Last resort: direct OpenRouter
    const apiKey = await getApiKey();
    return streamWithFallback(apiKey, CHAT_MODELS, messages, onChunk, 2048);
  }
}

// ── JARVIS Voice Agent (agentic tool loop) ────────────────────────────────────
// Used by MainLayout/ChatWidget for voice commands that execute real actions.
export async function askVoiceAgent(
  input:   string,
  lang:    ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {
  return agenticRoute(input, lang, history);
}

// ── Re-exports for agents that still need direct LLM access ──────────────────
export { callWithFallback, getApiKey, CHAT_MODELS, callChat, streamChat };
export type { ReplyLang, ChatHistoryMessage, ApiMessage };
