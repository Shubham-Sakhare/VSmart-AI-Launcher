import { askAI } from "../llm/provider";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";
import { factExtractorAgent } from "./factExtractorAgent";

export async function chatAgent(
  prompt: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<string> {

  let extraSystem: string | undefined;

  try {
    const matches = await window.vsmart.longMemory.searchFacts(prompt, 3);

    if (matches.length > 0) {
      const facts = matches.map((m: any) => `- ${m.key}: ${m.value}`).join("\n");
      // Facts go in the SYSTEM prompt (not glued to the user's message), so the
      // model uses them naturally and never echoes them back by mistake.
      extraSystem =
        `Known facts about the user (use only when relevant, never force them in):\n${facts}`;
    }
  } catch {
    // Memory search is best-effort — if it fails, just chat normally.
  }

  // Intent is already decided by the planner, so don't re-route to the coder
  // model here based on keywords.
  const reply = await askAI(prompt, lang, history, {
    extraSystem,
    allowCodeRouting: false,
  });

  void factExtractorAgent(prompt, reply, lang);

  return reply;
}