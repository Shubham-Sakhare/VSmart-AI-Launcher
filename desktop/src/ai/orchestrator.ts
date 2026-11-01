import { route, type RouteResult } from "./router";
import { splitSteps, naturalReply } from "./dynamic";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";

// The LLM decides whether the message really has several different tasks.
// A single request stays a single request.
export async function orchestrate(
  message: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {

  const steps = await splitSteps(message);

  if (steps.length < 2) {
    return route(message, lang, history);
  }

  const results: string[] = [];
  let allSucceeded = true;

  // Each step sees the original history PLUS what earlier steps did.
  const runningHistory: ChatHistoryMessage[] = [...history];

  for (const step of steps) {
    const result = await route(step, lang, runningHistory);
    if (!result.success) allSucceeded = false;

    const stepMessage = result.message ?? "";
    results.push(stepMessage);

    runningHistory.push({ role: "user", content: step });
    runningHistory.push({ role: "assistant", content: stepMessage });

    // Stop on failure: later steps usually compound the error.
    if (!result.success) break;
  }

  const fallback = results.map((msg, i) => `${i + 1}. ${msg}`).join("\n\n");

  const totalLen = results.join(" ").length;
  const combined =
    totalLen <= 400
      ? await naturalReply({
          userMessage: message,
          lang,
          history,
          situation:
            `You completed these steps in order:\n` +
            steps.map((s, i) => `${i + 1}. "${s}" -> ${results[i] ?? "(not run)"}`).join("\n") +
            (allSucceeded ? "" : "\nA step failed, so you stopped there. Mention that."),
          fallback,
        })
      : fallback;

  return {
    success: allSucceeded,
    action: "orchestrator.multiStep",
    message: combined,
  };
}