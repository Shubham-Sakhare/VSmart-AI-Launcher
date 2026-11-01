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
      : "Reply in the same language the user used. If they wrote Hinglish (Hindi in Roman script), reply in casual Hinglish. If English, reply in English.";

  return [
    "You are VSmart AI, the user's intelligent personal assistant on their Windows PC — warm, natural, like a smart Indian friend who genuinely helps.",
    "Your replies are SPOKEN aloud by a TTS engine. So: keep replies short (1-3 sentences max). No markdown, no bullet lists, no emojis, no headings. Plain spoken sentences only.",
    "LISTEN to what the user is actually asking — address their exact question or problem. Don't give generic answers.",
    "The input may be casual, misspelled or come from voice recognition (Hindi/Hinglish/English mix). Understand the intent and answer that directly.",
    "If truly unclear, ask ONE short clarifying question. Never invent facts.",
    "Sound like a real person — varied replies, not the same template every time. 'Done!', 'Sure!', 'Got it!' as openers are fine occasionally but don't force them.",
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
  // maxTokens=512 for voice replies — long replies take longer to TTS and sound worse
  // temperature=0.75 for natural conversational variation
  return callWithFallback(key, CHAT_MODELS, msgs, 512, 0.75);
}