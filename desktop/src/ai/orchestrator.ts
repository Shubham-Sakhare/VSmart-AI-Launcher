import { route, type RouteResult } from "./router";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";

// Splits "do X, then do Y, phir Z" into separate steps. Each step still goes
// through the normal single-agent router (intent detection + the right
// agent), so this is real multi-agent chaining: a single message can now
// touch file search, desktop control, system, vision, etc. in one go.
const STEP_CONNECTORS = /\b(?:then|uske baad|phir|after that|and then)\b/i;

export async function orchestrate(
  message: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {

  if (!STEP_CONNECTORS.test(message)) {
    return route(message, lang, history);
  }

  const steps = message
    .split(STEP_CONNECTORS)
    .map(s => s.trim())
    .filter(Boolean);

  if (steps.length < 2) {
    return route(message, lang, history);
  }

  const results: string[] = [];
  let allSucceeded = true;

  // Each step now sees the ORIGINAL conversation history PLUS every
  // previous step's outcome from this same multi-step command, appended
  // as assistant turns. So step 2 knows what step 1 actually did —
  // e.g. "open notepad, then type my name in it" -> step 2's agent can
  // see notepad was just opened, instead of acting blind.
  const runningHistory: ChatHistoryMessage[] = [...history];

  for (const step of steps) {
    const result = await route(step, lang, runningHistory);
    if (!result.success) allSucceeded = false;

    const stepMessage = result.message ?? "";
    results.push(stepMessage);

    // Record this step as a completed turn so the next step has context.
    runningHistory.push({ role: "user", content: step });
    runningHistory.push({ role: "assistant", content: stepMessage });

    // Stop the chain early if a step failed — running later steps after
    // a failure usually compounds the error instead of recovering it.
    if (!result.success) break;
  }

  const combined = results
    .map((msg, i) => `${i + 1}. ${msg}`)
    .join("\n\n");

  return {
    success: allSucceeded,
    action: "orchestrator.multiStep",
    message: combined
  };

}