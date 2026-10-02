// provider.ts — thin wrapper used by factExtractorAgent and chatAgent
// Routes to the right model based on prompt type.
import { askQwenCoder, callWithFallback, getApiKey, isCodingPrompt, langRule, CHAT_MODELS, type ReplyLang, type ChatHistoryMessage, type ApiMessage } from "./openrouter";

export async function askAI(
  prompt: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<string> {
  if (isCodingPrompt(prompt)) {
    return askQwenCoder(prompt, lang);
  }
  const key = await getApiKey();
  const msgs: ApiMessage[] = [
    { role: "system", content: `You are a helpful AI assistant. ${langRule(lang)}` },
    ...history.slice(-8).map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: prompt },
  ];
  return callWithFallback(key, CHAT_MODELS, msgs);
}
