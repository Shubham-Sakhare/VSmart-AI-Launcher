// src/ai/dynamic.ts
// ---------------------------------------------------------------------------
// Dynamic (LLM-driven) helpers — every helper degrades gracefully if the
// LLM is not registered, times out, or errors. Falls back to a safe default.
// ---------------------------------------------------------------------------

import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";

export interface LLMRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}
export type LLMFn = (req: LLMRequest) => Promise<string>;

let llm: LLMFn | null = null;

export function registerLLM(fn: LLMFn): void { llm = fn; }
export function hasLLM(): boolean { return llm !== null; }

export async function ask(req: LLMRequest, timeoutMs: number): Promise<string | null> {
  if (!llm) return null;
  try {
    const out = await Promise.race([
      llm(req),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), timeoutMs)
      ),
    ]);
    const text = (out ?? "").trim();
    return text || null;
  } catch (err) {
    console.warn("[dynamic] LLM call failed:", err);
    return null;
  }
}

function cleanSpoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^["'""]+|["'""]+$/g, "")
    .trim();
}

function recentText(history: ChatHistoryMessage[] = [], n = 4): string {
  const rows = history.slice(-n).map(m => `${m.role}: ${m.content}`);
  return rows.length ? rows.join("\n") : "(none)";
}

// ---------------------------------------------------------------------------
// 1) Natural spoken reply — human-like, Indian, conversational
// ---------------------------------------------------------------------------
export async function naturalReply(opts: {
  userMessage: string;
  situation: string;
  fallback: string;
  lang: ReplyLang;
  history?: ChatHistoryMessage[];
}): Promise<string> {

  const langInstr = opts.lang === "hi"
    ? "Hindi mein jawab do (Devanagari). Natural, conversational — bookish nahi. English tech words OK."
    : "Hinglish mein jawab do — jaise real urban Indians baat karte hain (Roman script). " +
      "Agar user ne English mein bola toh English mein jawab do. Natural feel chahiye.";

  const system = [
    "Tu VSmart AI hai — ek intelligent Indian desktop assistant. Real person ki tarah baat karta hai.",
    "EXACTLY 1-2 short spoken sentences likh — jo tu actually bolega. No markdown, no emojis, no bullet points.",
    langInstr,
    "Sirf wahi baat karo jo 'Kya hua' section mein diya gaya hai. Kuch invent mat karo.",
    "Agar kuch fail hua, simply bolo kya hua aur ek next step suggest karo.",
    "User ki baat word-for-word repeat mat karo. Fresh natural response do.",
    "AVOID robotic templates jaise 'I have successfully completed' ya 'Done, Boss.' — varied, warm replies do.",
    "Kabhi kabhi natural fillers theek hain: 'Haan!', 'Lo!', 'Ho gaya!', 'Sure!' — but don't overdo it.",
  ].join("\n");

  const user =
    `Recent conversation:\n${recentText(opts.history)}\n\n` +
    `User ne kaha: "${opts.userMessage}"\n` +
    `Kya hua: ${opts.situation}\n\nTera spoken reply:`;

  const out = await ask({ system, user, maxTokens: 100, temperature: 0.75 }, 4000);
  return out ? cleanSpoken(out) || opts.fallback : opts.fallback;
}

// ---------------------------------------------------------------------------
// 2) Yes/No for dangerous action. Default = cancel (safe first).
// ---------------------------------------------------------------------------
const NEGATION_RE =
  /(\bno\b|\bnope\b|\bnot\b|\bdon'?t\b|\bnahi\b|\bnahin\b|\bnaa\b|\bmat\b|\bcancel\b|\bstop\b|\bruko\b|\brehne\b|\bwait\b|नहीं|मत|रुको|रहने|कैंसिल)/i;

const QUICK_CONFIRM_RE =
  /^\s*(yes|yeah|yep|yup|haan|han|haa|ha|confirm|confirmed|ok|okay|sure|theek hai|thik hai|kar\s*do|bilkul|zaroor|हाँ|हां|हा|ठीक है)\s*[.!।]?\s*$/i;

export async function interpretConfirmation(
  message: string,
  pendingAction: string
): Promise<"confirm" | "cancel"> {
  if (NEGATION_RE.test(message)) return "cancel";
  if (QUICK_CONFIRM_RE.test(message)) return "confirm";

  const system = [
    `A potentially destructive action ("${pendingAction}" the PC) is waiting for confirmation.`,
    "Classify the reply. Answer with exactly ONE word: CONFIRM or CANCEL.",
    "CONFIRM only if the user clearly agrees (any language — Hindi/Hinglish/English/slang).",
    "CANCEL for refusal, hesitation, questions, topic changes, or anything unclear.",
  ].join("\n");

  const out = await ask(
    { system, user: `User reply: "${message}"`, maxTokens: 5, temperature: 0 },
    3500
  );
  return out && /^confirm/i.test(out) ? "confirm" : "cancel";
}

// ---------------------------------------------------------------------------
// 3) Pick one option from a list based on free-form speech (e.g. Chrome profile)
// ---------------------------------------------------------------------------
export async function pickOption(message: string, options: string[]): Promise<number> {
  const lower  = message.toLowerCase();
  const direct = options.findIndex(o => lower.includes(o.toLowerCase()));
  if (direct >= 0) return direct;

  const list = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
  const system = [
    "The user was asked to choose one option. Decide which option their reply refers to.",
    "Reply may be in Hindi/Hinglish/English, may be misspelled, or say 'first', 'pehla', 'dusra' etc.",
    `Answer with ONLY the option number (1-${options.length}), or 0 if no option matches.`,
  ].join("\n");

  const out = await ask(
    { system, user: `Options:\n${list}\n\nUser reply: "${message}"`, maxTokens: 4, temperature: 0 },
    3500
  );
  const n = out ? parseInt(out.replace(/\D/g, ""), 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= options.length ? n - 1 : -1;
}

// ---------------------------------------------------------------------------
// 4) Turn a casual reply into a clean search query
// ---------------------------------------------------------------------------
export async function extractSearchQuery(message: string): Promise<string> {
  const words = message.trim().split(/\s+/).length;
  if (words <= 4) return message.trim();

  const system = [
    "Extract the best search query from the user's casual request (Hindi/Hinglish/English).",
    "Remove filler like 'mujhe', 'dikhao', 'search karo', 'please'. Keep names and key words.",
    "Output ONLY the query text.",
  ].join("\n");

  const out = await ask({ system, user: message, maxTokens: 30, temperature: 0 }, 3000);
  return out ? cleanSpoken(out) || message.trim() : message.trim();
}

// ---------------------------------------------------------------------------
// 5) Split a message into separate tasks only when it truly has several
// ---------------------------------------------------------------------------
const MAYBE_MULTI_RE =
  /(\bthen\b|\band then\b|\bafter that\b|\buske baad\b|\bphir\b|\bfir\b|\baur phir\b|\balso\b|\bsaath me\b|[,;]|\band\b|\baur\b)/i;

export async function splitSteps(message: string): Promise<string[]> {
  if (message.trim().length < 15 || !MAYBE_MULTI_RE.test(message)) return [message];

  const system = [
    "Decide if the user's message contains several DIFFERENT actions to perform in order.",
    "If it is a single request, return it as ONE item. Words like 'then', 'phir', 'aur', commas inside text, a search phrase, or a sentence to type do NOT mean multiple tasks.",
    "Keep each step in the user's original wording and language. Maximum 5 steps.",
    "Output ONLY a JSON array of strings, nothing else.",
  ].join("\n");

  const out = await ask({ system, user: message, maxTokens: 220, temperature: 0 }, 3500);
  if (!out) return [message];

  try {
    const match = out.match(/\[[\s\S]*\]/);
    if (!match) return [message];
    const arr = JSON.parse(match[0]);
    if (
      Array.isArray(arr) &&
      arr.length >= 1 &&
      arr.length <= 5 &&
      arr.every((s: unknown) => typeof s === "string" && (s as string).trim().length > 0)
    ) {
      return arr.map((s: string) => s.trim());
    }
  } catch { /* fall through */ }

  return [message];
}
