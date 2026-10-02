// ═══════════════════════════════════════════════════════════════════════════
// Two separate AI entry points — clearly separated by purpose:
//
//   askSmartChat()  — VSmart Chat (VSmartAIPage)
//                     Pure LLM streaming, ChatGPT-style, no tools, no TTS.
//                     User sees tokens appear live as they arrive.
//
//   askVoiceAgent() — VSmart Voice (ChatWidget + mic)
//                     Agentic tool-calling loop, executes real system actions,
//                     speaks replies via TTS. Natural Hindi/English assistant.
// ═══════════════════════════════════════════════════════════════════════════

import { agenticRoute } from "../ai/agenticRouter";
import {
  streamWithFallback, callWithFallback, getApiKey, langRule,
  CHAT_MODELS, type ApiMessage, type ReplyLang, type ChatHistoryMessage,
} from "../llm/openrouter";
import type { RouteResult } from "../ai/router";

// ── VSmart Chat ───────────────────────────────────────────────────────────────
// Pure streaming LLM. Calls onChunk with each token delta so the UI can render
// tokens live (like ChatGPT). Returns the full assembled reply when done.
// No tools, no TTS, no agentic loop.
export async function askSmartChat(
  prompt: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = [],
  onChunk: (delta: string, accumulated: string) => void
): Promise<string> {
  const apiKey = await getApiKey();

  const systemPrompt =
    `You are VSmart AI — a highly intelligent AI assistant like ChatGPT. ` +
    `You are helpful, honest, and thorough. Answer clearly and completely. ` +
    `For code, use proper markdown code blocks. ` +
    langRule(lang);

  const messages: ApiMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-12).map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: prompt },
  ];

  return streamWithFallback(apiKey, CHAT_MODELS, messages, onChunk, 2048);
}

// ── VSmart Voice Agent ────────────────────────────────────────────────────────
// Agentic tool-calling loop for voice and chat widget commands.
// Opens apps, writes code, controls system, answers questions — and speaks back.
export async function askVoiceAgent(
  input: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {
  return agenticRoute(input, lang, history);
}

// ── Re-export for agents that still need direct LLM access ───────────────────
// (codingAgent, factExtractorAgent, visionAgent use these)
export { callWithFallback, getApiKey, CHAT_MODELS };
export type { ReplyLang, ChatHistoryMessage };
