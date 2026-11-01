import type { Plan, Intent } from "./types";
import type { ChatHistoryMessage } from "../llm/openrouter";
import { detectIntent } from "./intent";
import { ask } from "./dynamic";

// ---------------------------------------------------------------------------
// LLM planner: understands ANY phrasing (Hindi / Hinglish / English / slang /
// speech-recognition mistakes) and uses recent conversation to resolve
// follow-ups like "aur dikhao", "usko band kar do".
// If the LLM is unavailable or returns junk, it falls back to the old
// keyword logic, so the assistant never goes deaf.
// ---------------------------------------------------------------------------

const LLM_INTENTS: Intent[] = ["system", "memory", "file", "automation", "coding", "chat", "vision"];
const PLANNER_TIMEOUT_MS = 5000;
const PLANNER_RETRY_TIMEOUT_MS = 3500; // faster second attempt
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 250;

const SYSTEM_PROMPT = `You are the intent planner of a Windows voice assistant called VSmart.
The user's message may be Hindi, Hinglish, English, Marathi, slang, or contain speech-recognition mistakes. Understand what they REALLY want.

Choose exactly one intent:
- "system": open/close an app, website, folder or setting; play music/video; web search; volume, brightness, wifi, bluetooth; screenshot saved to a file; recycle bin; shutdown/restart; lock PC.
- "memory": the user wants you to remember something about them, recall it, or show what you remember.
- "file": find/search the user's files or documents on the PC; read, summarize, or answer questions about a document.
- "automation": control mouse/keyboard: click at coordinates, type text into the active window, press keys.
- "coding": write/fix/review code, create a project, run terminal commands.
- "vision": questions about what is currently on the user's screen.
- "chat": everything else (questions, talk, advice, jokes, general knowledge, opinions).

Return "command" depending on the intent:
- system: the target with filler words removed. For just opening an app/site give only its name in lowercase (e.g. "chrome", "youtube", "notepad", "downloads folder"). Otherwise a short phrase keeping the verb (e.g. "volume up", "search python tutorial", "play arijit singh songs", "screenshot", "lock pc"). For shutting down use exactly "shutdown", for restart use exactly "restart".
- memory: to save -> the user's statement unchanged; to recall -> "what is my <thing>"; to list everything -> "show memory".
- file, automation, coding, vision, chat: the user's request as a complete, self-contained sentence in the user's own language. If it depends on earlier turns (pronouns, "aur dikhao", "usko hata do"), rewrite it using the conversation so it makes sense alone. Otherwise keep it unchanged.

Use the recent conversation to decide. A short follow-up usually continues the previous topic.
Questions about news, weather, facts or "what is X" are "chat", not "system".

Examples (English / Hindi / Hinglish / Marathi):
"arre youtube chala de yaar" -> {"intent":"system","command":"youtube"}
"volume thoda badha do" -> {"intent":"system","command":"volume up"}
"pc band kar do" -> {"intent":"system","command":"shutdown"}
"laptop restart karna hai" -> {"intent":"system","command":"restart"}
"mera naam Shubham hai yaad rakhna" -> {"intent":"memory","command":"mera naam Shubham hai yaad rakhna"}
"meri favourite color kya thi" -> {"intent":"memory","command":"what is my favourite color"}
"tune kya kya yaad rakha hai" -> {"intent":"memory","command":"show memory"}
"resume wali pdf dhundo" -> {"intent":"file","command":"resume wali pdf dhundo"}
"screen pe kya chal raha hai" -> {"intent":"vision","command":"screen pe kya chal raha hai"}
"python me fibonacci likho" -> {"intent":"coding","command":"python me fibonacci likho"}
"kaise ho bhai" -> {"intent":"chat","command":"kaise ho bhai"}
"Chrome ughad" -> {"intent":"system","command":"chrome"}
"mala downloads folder ughad" -> {"intent":"system","command":"downloads folder"}
"brightness kami kar" -> {"intent":"system","command":"brightness down"}

Output ONLY one JSON object: {"intent":"...","command":"..."}`;

function formatHistory(history: ChatHistoryMessage[]): string {
  const rows = history.slice(-HISTORY_TURNS).map(m => {
    const c = m.content.length > HISTORY_CHARS ? m.content.slice(0, HISTORY_CHARS) + "…" : m.content;
    return `${m.role}: ${c}`;
  });
  return rows.length ? rows.join("\n") : "(none)";
}

function parsePlan(raw: string | null): Plan | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const intent = String(obj?.intent ?? "").toLowerCase() as Intent;
    const command = typeof obj?.command === "string" ? obj.command.trim() : "";
    if (!LLM_INTENTS.includes(intent) || !command) return null;
    return { intent, command };
  } catch {
    return null;
  }
}

export async function planner(
  text: string,
  history: ChatHistoryMessage[] = []
): Promise<Plan> {

  const plannerRequest = {
    system: SYSTEM_PROMPT,
    user: `Recent conversation:\n${formatHistory(history)}\n\nUser message: "${text}"\n\nJSON:`,
    maxTokens: 120,
    temperature: 0,
  };

  // First attempt
  let raw = await ask(plannerRequest, PLANNER_TIMEOUT_MS);
  let plan = parsePlan(raw);

  if (plan) {
    console.log(`[Planner] LLM -> ${plan.intent}: "${plan.command}"`);
    return plan;
  }

  // One retry with slightly lower timeout (different fast model may succeed)
  if (raw === null) {
    console.warn("[Planner] First attempt timed out — retrying...");
    raw = await ask(plannerRequest, PLANNER_RETRY_TIMEOUT_MS);
    plan = parsePlan(raw);
    if (plan) {
      console.log(`[Planner] LLM retry -> ${plan.intent}: "${plan.command}"`);
      return plan;
    }
  }

  console.warn("[Planner] LLM unavailable/invalid, using keyword fallback.");
  return keywordPlan(text, history);
}

// ===========================================================================
// Fallback: the original keyword-based planner (unchanged behaviour)
// ===========================================================================

const FILLER_WORDS = [
  "open", "khol", "kholo", "khol do", "shuru karo", "start",
  "please", "kripya", "karo", "kar do", "kar de", "do", "de"
];

const CONTINUABLE_INTENTS: Intent[] = ["file", "vision", "automation", "system"];
// Follow-up words that indicate the user is continuing a previous topic
const FOLLOWUP_RE = /\b(usse|isko|uski|woh|yeh|yeh wala|us|is|isko|use|band|hata|khol|aur|more|again|dobara|phir)\b/i;
const SHORT_MESSAGE_WORD_LIMIT = 6; // was 4 — "usse band kar do" (5 words) should also be a follow-up

function keywordPlan(text: string, history: ChatHistoryMessage[]): Plan {
  let intent = detectIntent(text);

  // Treat short follow-up messages as continuing the previous topic
  const wordCount = text.trim().split(/\s+/).length;
  const isFollowUp = wordCount <= SHORT_MESSAGE_WORD_LIMIT || FOLLOWUP_RE.test(text);

  if (intent === "chat" && isFollowUp) {
    const lastIntent = lastUserIntent(history);
    if (lastIntent && CONTINUABLE_INTENTS.includes(lastIntent)) {
      intent = lastIntent;
    }
  }

  const command = intent === "system" ? extractTarget(text) : text.trim();
  return { intent, command };
}

function extractTarget(text: string): string {
  let result = text.toLowerCase();
  for (const word of FILLER_WORDS) {
    result = result.replace(new RegExp(`\\b${word}\\b`, "gi"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

function lastUserIntent(history: ChatHistoryMessage[]): Intent | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return detectIntent(history[i].content);
  }
  return null;
}