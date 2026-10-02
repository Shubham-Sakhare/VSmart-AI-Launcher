import type { Plan, Intent } from "./types";
import type { ChatHistoryMessage } from "../llm/openrouter";
import { detectIntent } from "./intent";

// Words that just mean "do this action" — strip them out to find the actual target.
const FILLER_WORDS = [
  "open", "khol", "kholo", "khol do", "shuru karo", "start",
  "please", "kripya", "karo", "kar do", "kar de", "do", "de"
];

// Intents that make sense to "continue" — e.g. after a file search, a short
// follow-up like "aur dikhao" should stay in file-search mode rather than
// falling through to plain chat. Intents like "chat" or "memory" aren't
// continued this way since a short reply there is usually just... a reply.
const CONTINUABLE_INTENTS: Intent[] = ["file", "vision", "automation", "system"];

// A message this short, with none of its own strong trigger words, is very
// likely a follow-up to whatever the assistant was just doing — not a
// brand-new unrelated request.
const SHORT_MESSAGE_WORD_LIMIT = 4;

export async function planner(
  text: string,
  history: ChatHistoryMessage[] = []
): Promise<Plan> {

  let intent = detectIntent(text);

  // ---- Follow-up continuation ----
  // Only kicks in when detectIntent() fell through to the generic "chat"
  // bucket for a short message AND the previous turn was doing something
  // continuable. This never overrides a clearly-detected intent.
  if (intent === "chat" && text.trim().split(/\s+/).length <= SHORT_MESSAGE_WORD_LIMIT) {
    const lastIntent = lastAssistantIntent(history);
    if (lastIntent && CONTINUABLE_INTENTS.includes(lastIntent)) {
      intent = lastIntent;
    }
  }

  // Every switch branch below assigns `command`, including `default` —
  // no initial value needed here.
  let command: string;

  switch (intent) {
    case "system":
      command = extractTarget(text);
      break;

    case "memory":
      command = extractMemoryCommand(text);
      break;

    case "file":
      // Keep the full sentence — the file-search service does its own
      // natural-language parsing (file type, date range, keywords).
      command = text.trim();
      break;

    case "automation":
      // Keep the full sentence — the desktop-control agent parses out
      // coordinates / typed text / key combos itself.
      command = text.trim();
      break;

    case "coding":
      // Keep the full sentence for coding — the LLM needs the whole context
      // to generate the right code, not just the trigger words stripped out.
      command = text.trim();
      break;

    default:
      command = text;
  }

  return { intent, command };
}

/** Strips filler/trigger words from anywhere in the sentence, leaving the target (app/site name). */
function extractTarget(text: string): string {
  let result = text.toLowerCase();

  for (const word of FILLER_WORDS) {
    result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), " ");
  }

  return result.replace(/\s+/g, " ").trim();
}

function extractMemoryCommand(text: string) {
  return text.trim();
}

// Recovers the router-level intent of the last real turn from chat history,
// by re-running detectIntent on the last USER message (not the assistant's
// reply — the reply is prose, the original message carries the intent
// signal). History is a flat role/content list, so we scan from the end.
function lastAssistantIntent(history: ChatHistoryMessage[]): Intent | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "user") {
      return detectIntent(msg.content);
    }
  }
  return null;
}