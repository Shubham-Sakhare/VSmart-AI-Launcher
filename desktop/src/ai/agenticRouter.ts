// ═══════════════════════════════════════════════════════════════════════════
// VSmart Voice Agentic Router
//
// This is the brain of the VOICE assistant. It:
//   1. Pattern-matches obvious commands instantly (no LLM call needed)
//   2. Falls back to an LLM loop for complex/ambiguous requests
//   3. Executes real system tools (open apps, write code, control volume…)
//   4. Speaks naturally in Hindi or English like a real Indian assistant
//
// VSmart Chat (VSmartAIPage) does NOT use this — it has its own pure-LLM
// path via askSmartChat() for ChatGPT-style conversation.
// ═══════════════════════════════════════════════════════════════════════════

import { callWithFallback, getApiKey, langRule, CHAT_MODELS, type ApiMessage, type ReplyLang, type ChatHistoryMessage } from "../llm/openrouter";
import { toolListForPrompt, executeTool } from "./tools";
import type { RouteResult } from "./router";

// ── Safety ───────────────────────────────────────────────────────────────────
const BLOCKED = ["porn","porno","xxx","nude","nudes","sex video","adult video","hentai","onlyfans","escort"];
function isBlocked(t: string): boolean { return BLOCKED.some(b => t.toLowerCase().includes(b)); }

// ── Destructive command guard ────────────────────────────────────────────────
const DESTRUCTIVE = /\b(restart|reboot|shutdown|shut\s*down|sign\s*out|log\s*off|format|wipe|delete\s+all|empty\s+recycle|taskkill|force\s*close)\b/i;

// ── Pending confirmation state ────────────────────────────────────────────────
const CONFIRM_TIMEOUT = 90_000;
let pending: { tool: string; args: Record<string, unknown>; at: number } | null = null;

const YES = ["yes","haan","ha","han","haa","ok","okay","sure","confirm","karo","kar do","bilkul","zaroor","proceed","go ahead"];
const NO  = ["no","nahi","nhi","nahin","cancel","mat karo","ruk","ruko","stop","chodo"];

// ── Direct intent router — no LLM, instant ──────────────────────────────────
// Matches the most common voice commands by regex and returns the right tool
// call without ever touching the LLM. Covers ~80% of real usage.
export interface DirectRoute { tool: string; args: Record<string, unknown> }

export function tryDirectRoute(msg: string): DirectRoute | null {
  const lo = msg.toLowerCase().trim();

  // Open app / website / folder
  const openPat = [
    /^(?:open|launch|start|chalu\s*kar|kholo?|kholna\s*hai)\s+(.+)$/i,
    /^(.+?)\s+(?:kholo?|open\s*karo?|chalu\s*karo?|chalao?|open\s*kar|kholna)$/i,
  ];
  for (const re of openPat) {
    const m = lo.match(re);
    if (m) {
      const t = m[1].trim().replace(/\s*(please|bhai|boss|jaldi|abhi|karo|kar\s*do|yaar)\s*$/i,"").trim();
      if (t) return { tool:"system_action", args:{ command:`open ${t}` } };
    }
  }

  // System controls — route the whole command string so systemAgent parses it
  if (/\bvolume\b|\bawaaz\b/.test(lo))             return { tool:"system_action", args:{ command:msg } };
  if (/\bbrightness\b|\bchamak\b/.test(lo))        return { tool:"system_action", args:{ command:msg } };
  if (/\bscreenshot\b/.test(lo))                   return { tool:"system_action", args:{ command:"screenshot" } };
  if (/\bwifi\b|\bwi-fi\b/.test(lo) && /\b(on|off|chalu|band)\b/.test(lo))
                                                    return { tool:"system_action", args:{ command:msg } };
  if (/\bbluetooth\b/.test(lo) && /\b(on|off|chalu|band)\b/.test(lo))
                                                    return { tool:"system_action", args:{ command:msg } };
  if (/\b(play|pause|next|previous|skip|mute|unmute)\b/.test(lo))
                                                    return { tool:"system_action", args:{ command:msg } };

  // Create folder
  if (/\b(create|make|bana|banao|new)\b.+\b(folder|directory)\b/i.test(lo) ||
      /\b(folder|directory)\b.+\b(bana|banao|create|make)\b/i.test(lo)) {
    const nm = msg.match(/(?:called|named|naam|ka naam)\s+["']?([^"'\n]+?)["']?(?:\s*$|\s+(?:on|in|at|pe))/i)
            || msg.match(/["']([^"']+)["']/);
    const name = nm?.[1]?.trim()
      || lo.replace(/.*(?:folder|directory)/i,"").replace(/\s*(bana|banao|create|make)\s*/i,"").trim()
      || "New Folder";
    return { tool:"coding_task", args:{ request:`create a folder named "${name}" on the Desktop` } };
  }

  // Type text
  if (/^(?:type|likho|likh\s*do|likh)\s+/i.test(lo))
    return { tool:"desktop_control", args:{ command:msg } };

  // File search
  if (/\b(dhundho?|search|find|khojo?)\b.+\b(file|folder|document|pdf|image|photo)\b/i.test(lo)) {
    const q = msg.match(/(?:dhundho?|search\s*for|find|khojo?)\s+(.+)/i);
    return { tool:"file_search", args:{ query: q?.[1] ?? msg } };
  }

  // Code / project
  if (/\b(code|program|script|project|function|class|website|app)\b/i.test(lo) &&
      /\b(write|likh|bana|banao|create|make|build|generate|likhna|likho)\b/i.test(lo))
    return { tool:"coding_task", args:{ request:msg } };

  // Bug fix / review
  if (/\b(bug|error|fix|debug|review)\b/i.test(lo) && /\b(code|project|file)\b/i.test(lo))
    return { tool:"coding_task", args:{ request:msg } };

  // Run terminal command
  if (/\b(run|chalao|execute)\b.+\b(terminal|cmd|command|npm|pip|node|python)\b/i.test(lo))
    return { tool:"coding_task", args:{ request:msg } };

  return null;
}

// ── Memory helpers ───────────────────────────────────────────────────────────
async function getMemory(q: string): Promise<string> {
  try {
    const facts = await window.vsmart.longMemory.searchFacts(q, 5);
    if (!facts?.length) return "";
    return "\nRelevant facts about the user:\n" + facts.map((f: {key:string;value:string}) => `• ${f.key}: ${f.value}`).join("\n") + "\n";
  } catch { return ""; }
}

async function savePreference(text: string): Promise<void> {
  const pats = [
    /(?:mera|my)\s+(?:preferred|favourite|favorite|default)\s+(.+?)\s+(?:is|hai)\s+(.+)/i,
    /(?:remember|yaad\s*rakh)\s+(?:that|ki)?\s*(.+)/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) {
      try { await window.vsmart.longMemory.saveFact((m[1]||"pref").trim().slice(0,40),(m[2]||m[1]||text).trim().slice(0,180)); } catch { /**/ }
      break;
    }
  }
}

// ── System prompt for LLM agentic calls ──────────────────────────────────────
function buildPrompt(lang: ReplyLang, mem: string): string {
  return `You are VSmart AI — a Jarvis/IRIS-like desktop assistant on Windows. You are NOT a chatbot. You actually execute real actions.

TOOLS AVAILABLE:
${toolListForPrompt()}

RESPONSE FORMAT — CRITICAL:
Reply with ONLY a single valid JSON object. No text before or after. No markdown.
{"tool":"<name>","args":{...}}

HOW TO PICK A TOOL:
- Open app/website/folder → system_action, command="open <name>"
- Volume/brightness/wifi/bluetooth/screenshot/media → system_action
- Write/fix/create code or project → coding_task
- Find a file → file_search
- Click/type/keyboard → desktop_control
- See screen → vision_analyze
- Save/recall user facts → memory_save / memory_get
- DANGEROUS (restart/shutdown/delete all) → request_confirmation first
- Just answering / chatting → final_reply

REPLY STYLE (for final_reply "message" field):
- Short, spoken, natural. Like a real person talking.
- Good: "Done Boss, Chrome khol diya." Bad: "I have successfully launched Chrome."
- Max 2 sentences for simple tasks.
- ${langRule(lang)}
${mem}`;
}

// ── JSON extractor ────────────────────────────────────────────────────────────
function extractJson(raw: string): { tool: string; args: Record<string, unknown> } | null {
  for (const s of [raw.replace(/^```(?:json)?\s*/im,"").replace(/\s*```\s*$/im,"").trim(), raw]) {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]);
      if (typeof j?.tool === "string") return j;
    } catch { /**/ }
  }
  // Model returned plain text — try to salvage a direct route from it
  const dr = tryDirectRoute(raw.slice(0, 200));
  if (dr) return dr as { tool: string; args: Record<string, unknown> };
  const om = raw.match(/(?:open(?:ing)?|launch(?:ing)?|kholna)\s+([A-Za-z0-9 .]+)/i);
  if (om) return { tool:"system_action", args:{ command:`open ${om[1].trim()}` } };
  return null;
}

// ── Natural reply composer ────────────────────────────────────────────────────
function composeReply(tool: string, args: Record<string, unknown>, result: string, lang: ReplyLang): string {
  const hi = lang === "hi";
  const cmd = String(args?.command ?? args?.request ?? "").toLowerCase();
  if (/could not|couldn't|failed|error|not found/i.test(result)) return result;
  if (tool === "system_action") {
    if (/open|launch|start|khol/i.test(cmd)) {
      const t = cmd.replace(/^open\s+/i,"").trim();
      return hi ? `हो गया बॉस, ${t} खोल दिया।` : `Done Boss, opened ${t}.`;
    }
    if (/screenshot/i.test(cmd)) return hi ? `स्क्रीनशॉट ले लिया बॉस।` : `Screenshot taken, Boss.`;
    if (/volume|brightness/i.test(cmd)) return hi ? `हो गया बॉस।` : `Done Boss.`;
    return hi ? `हो गया बॉस।` : `Done Boss.`;
  }
  if (tool === "coding_task")   return (hi ? `हो गया बॉस।\n\n` : `Done Boss.\n\n`) + result;
  if (tool === "desktop_control") return hi ? `कर दिया बॉस।` : `Done Boss.`;
  return result;
}

// ── Main router ───────────────────────────────────────────────────────────────
export async function agenticRoute(
  message: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {

  if (isBlocked(message)) {
    return { success:false, action:"blocked", message: lang === "hi"
      ? "माफ़ कीजिए बॉस, यह नहीं कर सकता।"
      : "Sorry Boss, can't help with that." };
  }

  void savePreference(message);

  // Resolve pending destructive confirmation
  if (pending) {
    const expired = Date.now() - pending.at > CONFIRM_TIMEOUT;
    const p = pending; pending = null;
    if (!expired) {
      const lo = message.toLowerCase();
      if (YES.some(w => lo.includes(w))) {
        const r = await executeTool(p.tool, p.args, lang);
        return { success:true, action:`confirmed.${p.tool}`, message:r };
      }
      if (NO.some(w => lo.includes(w))) {
        return { success:true, action:"cancelled",
          message: lang === "hi" ? "ठीक है, कैंसिल कर दिया।" : "Okay, cancelled." };
      }
    }
  }

  // Fast path — no LLM
  const direct = tryDirectRoute(message);
  if (direct) {
    if (direct.tool === "system_action" && DESTRUCTIVE.test(String(direct.args?.command ?? ""))) {
      pending = { tool:direct.tool, args:direct.args, at:Date.now() };
      return { success:true, action:"confirm",
        message: lang === "hi" ? "बॉस, पक्का? हां बोलें।" : "Are you sure, Boss? Say yes to confirm." };
    }
    const r = await executeTool(direct.tool, direct.args, lang);
    return { success:true, action:"direct."+direct.tool, message: composeReply(direct.tool, direct.args, r, lang) };
  }

  // LLM loop (max 5 steps for multi-step tasks)
  const mem = await getMemory(message);
  const sys = buildPrompt(lang, mem);
  const turns: ChatHistoryMessage[] = [...history, { role:"user", content:message }];
  const results: string[] = [];

  for (let step = 0; step < 5; step++) {
    const apiKey = await getApiKey();
    const msgs: ApiMessage[] = [
      { role:"system", content:sys },
      ...turns.slice(0,-1).slice(-6).map(h => ({ role:h.role, content:h.content })),
      { role:"user", content:message },
    ];

    let raw = "";
    try {
      raw = await callWithFallback(apiKey, CHAT_MODELS, msgs, 1024);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      break;
    }

    const dec = extractJson(raw);

    // Model returned plain text — treat as final reply
    if (!dec) {
      return { success:true, action:"reply", message:[...results,raw.trim()].filter(Boolean).join("\n\n") || "Ok Boss." };
    }
    if (dec.tool === "final_reply") {
      const msg = [...results, String(dec.args?.message ?? "")].filter(Boolean).join("\n\n");
      return { success:true, action:"reply", message: msg || "Ok Boss." };
    }
    if (dec.tool === "request_confirmation") {
      pending = { tool:String(dec.args?.onConfirmTool ?? ""), args:(dec.args?.onConfirmArgs as Record<string,unknown>) ?? {}, at:Date.now() };
      return { success:true, action:"confirm",
        message: String(dec.args?.question ?? (lang === "hi" ? "बॉस, पक्का?" : "Are you sure, Boss?")) };
    }
    if (dec.tool === "system_action" && DESTRUCTIVE.test(String(dec.args?.command ?? ""))) {
      pending = { tool:"system_action", args:dec.args, at:Date.now() };
      return { success:true, action:"confirm",
        message: lang === "hi" ? "बॉस, पक्का? हां बोलें।" : "Sure, Boss? Say yes." };
    }

    const r = await executeTool(dec.tool, dec.args, lang);
    results.push(r);
    turns.push({ role:"assistant", content:`(${dec.tool} result: ${r.slice(0,200)})` });
  }

  return { success:results.length > 0, action:"reply",
    message: results.join("\n\n") || (lang === "hi" ? "हो नहीं पाया बॉस।" : "Couldn't complete that, Boss.") };
}
