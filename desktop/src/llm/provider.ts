// provider.ts — thin wrapper used by factExtractorAgent and chatAgent
// Routes to the right model based on prompt type.
import { askQwenCoder, callWithFallback, getApiKey, isCodingPrompt, langRule, CHAT_MODELS, type ReplyLang, type ChatHistoryMessage, type ApiMessage } from "./openrouter";

export interface AskOptions {
  /** Extra context appended to the system prompt (e.g. known user facts). */
  extraSystem?: string;
  /** Default true (old behaviour). chatAgent passes false: the planner already chose the intent. */
  allowCodeRouting?: boolean;
}

function buildSystemPrompt(lang: ReplyLang, extra?: string): string {
  const now = new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" });

  const languageRule =
    lang === "hi"
      ? langRule("hi")
      : "Reply in English. If the user writes Hinglish (Hindi in Roman script), reply in the same casual Hinglish.";

  return [
    "You are VSmart AI, the user's personal intelligent Indian assistant on their Windows PC — warm, smart, natural. Like a knowledgeable friend who actually does things for you.",
    "Your replies are usually SPOKEN aloud, so keep them short (1-3 sentences) unless the user asks for detail. No markdown, no bullet lists, no emojis, no headings.",
    "The input may be casual, misspelled or come from speech recognition (Hindi/Hinglish/English mix). Work out what the user really means and answer that. If it is truly unclear, ask ONE short clarifying question.",
    "Do not claim you performed an action on the PC in this reply; actions are handled by other parts of the system. Never invent facts; if unsure, say so.",
    languageRule,
    `Current date and time: ${now}.`,
    extra,
  ].filter(Boolean).join("\n");
}

export async function askAI(
  prompt: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = [],
  opts: AskOptions = {}
): Promise<string> {
  const allowCode = opts.allowCodeRouting !== false;

  if (allowCode && isCodingPrompt(prompt)) {
    return askQwenCoder(prompt, lang);
  }

  const key = await getApiKey();
  const msgs: ApiMessage[] = [
    { role: "system", content: buildSystemPrompt(lang, opts.extraSystem) },
    ...history.slice(-8).map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: prompt },
  ];
  return callWithFallback(key, CHAT_MODELS, msgs);
}