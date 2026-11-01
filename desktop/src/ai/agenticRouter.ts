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

import { callWithFallback, getApiKey, CHAT_MODELS, type ApiMessage, type ReplyLang, type ChatHistoryMessage } from "../llm/openrouter";
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
    /^(?:open|launch|start|chalu\s*kar|kholo?|kholna\s*hai|chala|chalao)\s+(.+)$/i,
    /^(.+?)\s+(?:kholo?|open\s*karo?|chalu\s*karo?|chalao?|open\s*kar|kholna|start\s*karo?)$/i,
    /^(.+?)\s+(?:open|launch|chalo?|chalao?)\s*(?:karo?|kar\s*do|please)?$/i,
  ];
  for (const re of openPat) {
    const m = lo.match(re);
    if (m) {
      const t = m[1].trim().replace(/\s*(please|bhai|boss|jaldi|abhi|karo|kar\s*do|yaar|na|do)\s*$/i,"").trim();
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
  const langInstr = lang === "hi"
    ? "Natural Hindi mein baat karo (Devanagari). English tech terms naturally mix kar sakte ho. Bookish Hindi nahi — jaise ek padha-likha Indian naturally bolta hai."
    : "Hinglish mein baat karo — jaise real urban Indians bolte hain. Roman script. Natural, friendly, NOT robotic. User ki tone match karo.";

  return `Tu VSmart hai — ek warm, intelligent Indian desktop assistant. Tu sirf chatbot nahi hai — tu actually real system actions leta/leti hai Windows PC par, aur naturally baat karta/karti hai jaise ek smart dost.

TOOLS AVAILABLE:
${toolListForPrompt()}

RESPONSE FORMAT — ZARURI:
Sirf ek valid JSON object return karo. Pehle ya baad mein koi text nahi. No markdown fences.
{"tool":"<name>","args":{...}}

TOOL SELECTION GUIDE:
- App/website/folder kholna → system_action, command="open <name>"
- Volume/brightness/wifi/bluetooth/screenshot/media controls → system_action
- Code likhna/fix karna/project banana → coding_task
- File dhundhna → file_search
- Click/type/keyboard control → desktop_control
- Screen dekhna/analyze karna → vision_analyze
- User ki baat yaad rakhna → memory_save / memory_get
- DANGEROUS kaam (restart/shutdown/delete all) → pehle request_confirmation
- Sirf baat karna/jawab dena/question ka answer → final_reply

IMPORTANT — CONTEXT AWARENESS:
- Pichli baaton ka CONTEXT yaad rakh — agar user ne pehle kuch mention kiya hai, use connect karo.
- Agar user short reply de raha hai jaise "haan", "theek hai", "woh wala" — pehle messages se context samjho.
- Follow-up questions naturally handle karo — har baar fresh conversation mat maano.

REPLY STYLE (final_reply ke "message" field ke liye):
- USER JO KEHE RAHA HAI USSE SUNO — unki exact request address karo.
- Kaam hua? Khushi se bolo: "Ho gaya!", "Haan, khol diya!", "Le liya screenshot!"
- Kuch fail hua? Clearly bolo kya hua aur kya kare: "Yaar, yeh nahi mila — [reason]. Try karo [X]?"
- Confirmation chahiye? Naturally pucho: "Ek second — pakka restart karein? Kaam save hai na?"
- Simple tasks: max 1-2 sentences. Complex mein thoda zyada theek hai.
- AVOID: "I have successfully completed", "Done, Boss." — ye robotic laga hai, kabhi mat likhna.
- Sound like a real person who genuinely helps — not reading from a script.
- ${langInstr}
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

// ── Natural reply composer — varied, human-sounding ──────────────────────────
// Used only for the direct (no-LLM) fast path. Gives different responses
// so Iris never sounds like a broken record.
function composeReply(tool: string, args: Record<string, unknown>, result: string, lang: ReplyLang): string {
  const hi  = lang === "hi";
  const cmd = String(args?.command ?? args?.request ?? "").toLowerCase();

  // If the tool returned an error, surface it directly — no sugar-coating
  if (/could not|couldn't|failed|error|not found/i.test(result)) return result;

  if (tool === "system_action") {
    if (/open|launch|start|khol/i.test(cmd)) {
      const target = cmd.replace(/^open\s+/i, "").replace(/^kholo?\s+/i, "").trim();
      const opens_hi = [
        `Haan, ${target} khol diya!`,
        `${target} open ho gaya.`,
        `Lo, ${target} chalu kar diya.`,
        `${target} ready hai.`,
      ];
      const opens_en = [
        `Opened ${target}!`,
        `There you go — ${target} is up.`,
        `${target} is open now.`,
        `Done, ${target} launched.`,
      ];
      const pool = hi ? opens_hi : opens_en;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    if (/screenshot/i.test(cmd)) {
      const hi_pool = [`Screenshot le liya!`, `Ho gaya, screenshot save kar liya.`, `Screenshot ready hai.`];
      const en_pool = [`Screenshot taken!`, `Got it, screenshot saved.`, `Screenshot done!`];
      const p = hi ? hi_pool : en_pool;
      return p[Math.floor(Math.random() * p.length)];
    }
    if (/volume|awaaz/i.test(cmd)) {
      return hi ? `Volume set kar diya.` : `Volume adjusted.`;
    }
    if (/brightness|chamak/i.test(cmd)) {
      return hi ? `Brightness badal di.` : `Brightness updated.`;
    }
    if (/wifi|wi-fi/i.test(cmd)) {
      return hi ? `WiFi update kar diya.` : `WiFi updated.`;
    }
    if (/bluetooth/i.test(cmd)) {
      return hi ? `Bluetooth change kar diya.` : `Bluetooth toggled.`;
    }
    if (/play|pause|next|skip/i.test(cmd)) {
      const hi_pool = [`Ho gaya.`, `Kar diya.`];
      const en_pool = [`Done!`, `Sure.`];
      const p = hi ? hi_pool : en_pool;
      return p[Math.floor(Math.random() * p.length)];
    }
    // Generic system action
    const generic_hi = [`Ho gaya!`, `Kar diya.`, `Done!`, `Haan, ho gaya.`];
    const generic_en = [`Done!`, `All set.`, `Got it.`, `Sure, done.`];
    const gp = hi ? generic_hi : generic_en;
    return gp[Math.floor(Math.random() * gp.length)];
  }

  if (tool === "coding_task") {
    const prefix_hi = [`Ho gaya! Yeh dekho:\n\n`, `Likh diya:\n\n`, `Ready hai:\n\n`, `Yeh raha:\n\n`];
    const prefix_en = [`Done! Here it is:\n\n`, `Written — check this:\n\n`, `Ready:\n\n`, `Here you go:\n\n`];
    const pp = hi ? prefix_hi : prefix_en;
    return pp[Math.floor(Math.random() * pp.length)] + result;
  }

  if (tool === "desktop_control") {
    return hi ? `Kar diya.` : `Done.`;
  }

  if (tool === "file_search") {
    return result || (hi ? `Koi file nahi mili.` : `No files found.`);
  }

  return result || (hi ? `Ho gaya.` : `Done.`);
}

// ── Main router ───────────────────────────────────────────────────────────────
export async function agenticRoute(
  message: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {

  if (isBlocked(message)) {
    return { success: false, action: "blocked", message: lang === "hi"
      ? "Yeh nahi kar sakta — yeh content allowed nahi hai."
      : "Sorry, can't help with that — it's not something I'm allowed to do." };
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
        return { success: true, action: `confirmed.${p.tool}`, message: r };
      }
      if (NO.some(w => lo.includes(w))) {
        return { success: true, action: "cancelled",
          message: lang === "hi"
            ? "Theek hai, chhodta hoon. Koi aur kaam ho toh batao."
            : "Alright, cancelled. Let me know if you need anything else." };
      }
    }
  }

  // Fast path — no LLM
  const direct = tryDirectRoute(message);
  if (direct) {
    if (direct.tool === "system_action" && DESTRUCTIVE.test(String(direct.args?.command ?? ""))) {
      pending = { tool: direct.tool, args: direct.args, at: Date.now() };
      return { success: true, action: "confirm",
        message: lang === "hi"
          ? "Ruko — yeh kaam thoda bada hai. Pakka karna chahte ho? 'Haan' bolo toh karta hoon."
          : "Hold on — this is a big action. Are you sure? Say yes and I'll do it." };
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
      // Send last 8 exchanges as context — enough for natural follow-ups
      ...turns.slice(0,-1).slice(-8).map(h => ({ role:h.role, content:h.content })),
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
      return { success: true, action: "reply", message: [...results, raw.trim()].filter(Boolean).join("\n\n") || (lang === "hi" ? "Ho gaya." : "Done!") };
    }
    if (dec.tool === "final_reply") {
      const msg = [...results, String(dec.args?.message ?? "")].filter(Boolean).join("\n\n");
      return { success: true, action: "reply", message: msg || (lang === "hi" ? "Ho gaya." : "Done!") };
    }
    if (dec.tool === "request_confirmation") {
      pending = { tool: String(dec.args?.onConfirmTool ?? ""), args: (dec.args?.onConfirmArgs as Record<string, unknown>) ?? {}, at: Date.now() };
      return { success: true, action: "confirm",
        message: String(dec.args?.question ?? (lang === "hi"
          ? "Pakka karna chahte ho? 'Haan' bolo."
          : "Are you sure? Say yes and I'll proceed.")) };
    }
    if (dec.tool === "system_action" && DESTRUCTIVE.test(String(dec.args?.command ?? ""))) {
      pending = { tool: "system_action", args: dec.args, at: Date.now() };
      return { success: true, action: "confirm",
        message: lang === "hi"
          ? "Ruko — yeh important action hai. Pakka? 'Haan' bolo."
          : "Hold on — this is important. Are you sure? Say yes." };
    }

    const r = await executeTool(dec.tool, dec.args, lang);
    results.push(r);
    turns.push({ role:"assistant", content:`(${dec.tool} result: ${r.slice(0,200)})` });
  }

  return { success: results.length > 0, action: "reply",
    message: results.join("\n\n") || (lang === "hi"
      ? "Kuch nahi hua yaar — shayad connection issue hai. Phir try karo."
      : "Something went wrong — maybe a connection issue. Please try again.") };
}
