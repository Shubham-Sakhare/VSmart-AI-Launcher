import type { Intent } from "./types";

// ─── intent.ts ────────────────────────────────────────────────────────────────
// Keyword-based fallback classifier used when the LLM planner is unavailable.
// Supports English, Hindi, Hinglish, and Marathi.
// Checked in priority order to avoid false positives.
// ─────────────────────────────────────────────────────────────────────────────

export function detectIntent(text: string): Intent {
  const input = text.toLowerCase();

  // ── Memory ──────────────────────────────────────────────────────────────────
  // Check FIRST — "remember chrome password" should not hit system.
  if (
    /\b(remember|yaad rakho|yaad rakh|note kar|lakshat thev|lakshat ठेव)\b/.test(input) ||
    /\b(recall|yaad hai|kya tha|athav|आठव)\b/.test(input) ||
    /\b(what is my|what's my|whats my|mera .+ kya hai)\b/.test(input) ||
    input.includes("show memory") ||
    input.includes("what do you remember") ||
    input.includes("kya yaad hai") ||
    input.includes("tumhe kya pata hai")
  ) {
    return "memory";
  }

  // ── Vision ──────────────────────────────────────────────────────────────────
  // Check before system so "screenshot" doesn't swallow screen-description queries.
  if (
    /\b(what'?s on (my |the )?screen|whats on (my |the )?screen)\b/.test(input) ||
    /\b(look at (my |the )?screen|check (my |the )?screen)\b/.test(input) ||
    /\b(explain (my |the )?screen|screen explain karo)\b/.test(input) ||
    /\b(screen dekho|screen dekh|mera screen|screen samjhao|screen batao)\b/.test(input) ||
    /\b(is screen (pe|par) kya hai|screen var kay ahe)\b/.test(input) ||
    /\b(screen par kya dikh raha|screen mein kya hai)\b/.test(input)
  ) {
    return "vision";
  }

  // ── File ─────────────────────────────────────────────────────────────────────
  if (
    input.includes(".pdf") ||
    input.includes(".txt") ||
    input.includes(".doc") ||
    input.includes(".docx") ||
    input.includes(".png") ||
    input.includes(".jpg") ||
    input.includes(".xlsx") ||
    /\b(find|search|locate|dhundo|dhundho|dhoondo|khojo|kahan hai|kaha hai|where is|shodha|शोध)\b.*\b(file|files|document|documents|pdf|resume|cv|invoice|photo|photos|image|images|picture|pictures|video|videos|excel|spreadsheet)\b/.test(input) ||
    /\b(file|files|document|documents|resume|invoice)\b.*\b(find|search|dhundo|dhundho|khojo|locate|shodha)\b/.test(input) ||
    /\b(summarize|summarise|summary|saransh|saraansh)\b.*\b(file|document|pdf|doc)\b/.test(input) ||
    /\b(file|document|pdf)\b.*\b(padho|padh do|read|open karke padho)\b/.test(input)
  ) {
    return "file";
  }

  // ── Automation ───────────────────────────────────────────────────────────────
  // Checked before system — click/type/press are direct desktop control.
  if (
    /\b(click|double\s+click|right\s+click)\s*(at\s*)?\d+[, ]+\d+/.test(input) ||
    /^(type|likho|likh do|likh|tap karo|tap kar)\s+.+/.test(input) ||
    /\b(press|dabao|dabaiye|press karo|dabavaa|दाबा)\s+[a-z0-9+ ]+/.test(input)
  ) {
    return "automation";
  }

  // ── Coding ───────────────────────────────────────────────────────────────────
  if (
    /\b(code|program|function|script)\b.*\b(likho|likh|likhna|write|banao|banaye|lihiva)\b/.test(input) ||
    /\b(likho|likh|write|banao)\b.*\b(code|program|function|script)\b/.test(input) ||
    /\b(create|banao|bana do|start|build|tayar karo|तयार)\s+(a\s+|an\s+)?(new\s+)?(project|app|application|website|folder)\b/.test(input) ||
    /\b(find|check|fix)\s+(the\s+)?bugs?\b/.test(input) ||
    /\bbugs?\s+(dhundo|dhundho|khojo|find|check|shodha)\b/.test(input) ||
    /\b(debug|review the code|review code|code check karo)\b/.test(input) ||
    (/\b(cmd|command|terminal)\b/.test(input) && /\b(run|chalao|chala do|execute|run karo)\b/.test(input))
  ) {
    return "coding";
  }

  // ── System / open app or website ─────────────────────────────────────────────
  if (
    /\b(open|khol|kholo|khol do|shuru karo|start|chalao|chala do|lagao|laga do|play|search|bajao|baja do|gana|gaana|song|ughad|उघड)\b/.test(input) ||
    /\b(band karo|close karo|band kar|close kar|band kar do|bund karo)\b/.test(input) ||
    input.includes("settings") ||
    input.includes("calculator") ||
    input.includes("notepad") ||
    input.includes("task manager") ||
    input.includes("volume") ||
    input.includes("awaaz") ||
    input.includes("brightness") ||
    input.includes("chamak") ||
    input.includes("wifi") ||
    input.includes("wi-fi") ||
    input.includes("internet") ||
    input.includes("bluetooth") ||
    input.includes("screenshot") ||
    input.includes("screen shot") ||
    input.includes("recycle bin") ||
    input.includes("trash") ||
    input.includes("restart") ||
    input.includes("reboot") ||
    input.includes("shutdown") ||
    input.includes("shut down") ||
    input.includes("band karo pc") ||
    input.includes("download") ||
    input.includes("document") ||
    input.includes("desktop") ||
    input.includes("picture") ||
    input.includes("folder") ||
    input.includes("lock") ||
    input.includes("lock karo")
  ) {
    return "system";
  }

  return "chat";
}
