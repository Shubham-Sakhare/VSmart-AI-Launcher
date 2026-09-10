import { askAI } from "../llm/provider";
import type { ReplyLang } from "../llm/openrouter";

interface ExtractedFact {
  key: string;
  value: string;
}

const EXTRACTION_PROMPT = `You extract durable personal facts from a single chat turn.
Return ONLY a JSON array, nothing else. Each item: {"key": "...", "value": "..."}.
Only include facts that are clearly stated and worth remembering long-term
(name, job, preferences, ongoing project, recurring habits, important dates).
Do NOT include one-off requests, greetings, or anything uncertain.
If nothing is worth remembering, return [].`;

export async function factExtractorAgent(
  userMessage: string,
  assistantReply: string,
  lang: ReplyLang = "en"
): Promise<void> {
  try {
    const raw = await askAI(
      `${EXTRACTION_PROMPT}\n\nUser: ${userMessage}\nAssistant: ${assistantReply}`,
      lang
    );

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts: ExtractedFact[] = JSON.parse(jsonMatch[0]);

    for (const fact of facts) {
      if (!fact?.key || !fact?.value) continue;
      await window.vsmart.longMemory.saveFact(
        String(fact.key).trim(),
        String(fact.value).trim()
      );
    }
  } catch {
    // Best-effort only — never let extraction failures affect the chat flow.
  }
}
