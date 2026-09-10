import { agenticRoute } from "../ai/agenticRouter";
import type { RouteResult } from "../ai/router";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";

/**
 * Single JARVIS entry point for chat, voice, and the full VSmart AI page.
 * UI components should call this instead of the raw LLM provider so tool
 * calling, confirmations, memory, vision, desktop control and agent loops
 * stay consistent without changing the UI.
 */
export async function askVSmart(
  input: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {
  return await agenticRoute(input, lang, history);
}
