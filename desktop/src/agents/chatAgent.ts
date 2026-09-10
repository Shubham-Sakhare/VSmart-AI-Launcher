import { askAI } from "../llm/provider";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";
import { factExtractorAgent } from "./factExtractorAgent";

export async function chatAgent(
  prompt: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<string> {

  let context = "";

  try {
    const matches = await window.vsmart.longMemory.searchFacts(prompt, 3);

    if (matches.length > 0) {
      const facts = matches.map((m: any) => `- ${m.key}: ${m.value}`).join("\n");
      context = `Known facts about the user (use only if relevant, don't force them in):\n${facts}\n\n`;
    }
  } catch {
    // Memory search is best-effort — if it fails, just chat normally.
  }

  const reply = await askAI(context + prompt, lang, history);

  void factExtractorAgent(prompt, reply, lang);

  return reply;
}
