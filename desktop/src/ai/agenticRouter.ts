import { askHunyuan } from "../llm/openrouter";
import { toolListForPrompt, executeTool } from "./tools";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";
import type { RouteResult } from "./router";

// ============================================================
// SAFETY: content block
// ============================================================
const BLOCKED_TERMS = [
  "porn", "porno", "xxx", "nude", "nudes", "sex video", "adult video",
  "hentai", "onlyfans", "escort"
];

function isBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some(term => lower.includes(term));
}

// ============================================================
// PENDING CONFIRMATION
// ============================================================
const PENDING_TIMEOUT_MS = 90_000;

let pendingConfirmation: { tool: string; args: Record<string, any>; setAt: number } | null = null;

const CONFIRM_WORDS = ["yes", "haan", "ha", "confirm", "karo", "ok", "sure"];
const CANCEL_WORDS = ["no", "nahi", "cancel", "mat karo"];

// Expanded destructive patterns (B — risk system)
const DESTRUCTIVE_SYSTEM_PATTERN =
  /\b(restart|reboot|shutdown|shut\s*down|sign\s*out|log\s*off|log\s*out|format|wipe|delete\s+all|empty\s+recycle|taskkill|force\s*close)\b/i;

function isDestructiveSystemCommand(command: string): boolean {
  return DESTRUCTIVE_SYSTEM_PATTERN.test(command);
}

const MAX_TOOL_STEPS = 6;

// ============================================================
// C — Memory injection
// ============================================================
async function getMemoryBlock(userQuery: string): Promise<string> {
  try {
    const facts = await window.vsmart.longMemory.searchFacts(userQuery, 6);
    if (!facts?.length) return "";
    const lines = facts.map(f => `• ${f.key}: ${f.value}`);
    return (
      "\nRelevant facts I remember about the user:\n" +
      lines.join("\n") +
      "\nUse these when they help personalize or answer correctly.\n"
    );
  } catch {
    return "";
  }
}

async function autoSavePreference(userText: string): Promise<void> {
  const patterns = [
    /(?:mera|my)\s+(?:preferred|favourite|favorite|default)\s+(.+?)\s+(?:is|hai)\s+(.+)/i,
    /(?:remember|yaad\s*rakh)\s+(?:that|ki)?\s*(.+)/i,
  ];
  for (const re of patterns) {
    const m = userText.match(re);
    if (m) {
      const key = (m[1] || "preference").trim().slice(0, 40);
      const value = (m[2] || m[1] || userText).trim().slice(0, 180);
      try {
        await window.vsmart.longMemory.saveFact(key, value);
      } catch {}
      break;
    }
  }
}

function buildSystemPrompt(lang: ReplyLang, memoryBlock: string): string {
  return `You are VSmart AI — a real desktop assistant like Jarvis, running locally on the user's PC. \
You don't just chat — you can actually take actions on their computer. Talk and think like a capable \
human assistant working alongside the user, not a rigid command parser. Understand intent even when the \
user phrases things casually, indirectly, or in Hindi/English/Hinglish mixed together.

Available tools:
${toolListForPrompt()}

Rules:
- Reply with ONLY one JSON object, nothing else — no markdown fences, no commentary outside the JSON.
- Format: {"tool": "<name>", "args": { ... }}
- If nothing needs to be done, or you already have your final answer, use final_reply.
- If the user's message clearly requires action, pick the single best-matching tool for THIS step. \
You'll be told the result and can call another tool next, or finish with final_reply — so a request \
like "open notepad then type X" takes two turns of this loop, not one.
- Always use request_confirmation before restart, shutdown, delete, format, or any irreversible action.
- For screen interaction (click a button, find something on screen), first call vision_analyze with a clear question. \
If coordinates come back, then call desktop_control.
- If you're unsure what the user means, use final_reply and ask a clarifying question rather than guessing \
at a destructive or hard-to-undo action.
- Reply language for any "message"/"question" text: ${lang === "hi" ? "Hindi, Devanagari script" : "English"}.
- Tone: warm, direct, like a trusted human assistant — not robotic, not overly formal.
${memoryBlock}`;
}

function extractJson(raw: string): any | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function agenticRoute(
  message: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {

  if (isBlocked(message)) {
    return {
      success: false,
      action: "blocked",
      message: lang === "hi" ? "माफ़ कीजिए बॉस, इसमें मदद नहीं कर सकता।" : "Sorry Boss, I can't help with that."
    };
  }

  // Auto-save clear preferences (C)
  await autoSavePreference(message);

  // ---- Resolve pending confirmation first ----
  if (pendingConfirmation) {
    const expired = Date.now() - pendingConfirmation.setAt > PENDING_TIMEOUT_MS;
    const pending = pendingConfirmation;
    pendingConfirmation = null;

    if (!expired) {
      const lower = message.toLowerCase();

      if (CONFIRM_WORDS.some(w => lower.includes(w))) {
        const result = await executeTool(pending.tool, pending.args, lang);
        return { success: true, action: `confirmed.${pending.tool}`, message: result };
      }

      if (CANCEL_WORDS.some(w => lower.includes(w))) {
        return {
          success: true,
          action: "confirmation.cancelled",
          message: lang === "hi" ? "ठीक है, कैंसिल कर दिया।" : "Okay, cancelled."
        };
      }
    }
  }

  // ---- Agentic tool-calling loop ----
  const memoryBlock = await getMemoryBlock(message);
  const systemPrompt = buildSystemPrompt(lang, memoryBlock);

  const transcript: ChatHistoryMessage[] = [...history, { role: "user", content: message }];
  const stepResults: string[] = [];

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const conversationBlock = transcript
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const raw = await askHunyuan(`${systemPrompt}\n\nConversation:\n${conversationBlock}`, lang);
    const decision = extractJson(raw);

    if (!decision || typeof decision.tool !== "string") {
      const fallback = [...stepResults, raw.trim()].filter(Boolean).join("\n\n");
      return { success: true, action: "agentic.reply", message: fallback || "Ok Boss." };
    }

    if (decision.tool === "final_reply") {
      const finalMsg = [...stepResults, String(decision.args?.message ?? "")].filter(Boolean).join("\n\n");
      return { success: true, action: "agentic.reply", message: finalMsg || "Ok Boss." };
    }

    if (decision.tool === "request_confirmation") {
      pendingConfirmation = {
        tool: String(decision.args?.onConfirmTool ?? ""),
        args: decision.args?.onConfirmArgs ?? {},
        setAt: Date.now()
      };
      return {
        success: true,
        action: "agentic.confirm",
        message: String(decision.args?.question ?? (lang === "hi" ? "बॉस, पक्का करना है?" : "Are you sure, Boss?"))
      };
    }

    // Hard safety net (B)
    if (decision.tool === "system_action" && isDestructiveSystemCommand(String(decision.args?.command ?? ""))) {
      pendingConfirmation = {
        tool: "system_action",
        args: decision.args ?? {},
        setAt: Date.now()
      };
      return {
        success: true,
        action: "agentic.confirm",
        message: lang === "hi"
          ? "बॉस, पक्का करना है? हां बोलें कन्फर्म करने के लिए।"
          : "Are you sure, Boss? Say yes to confirm."
      };
    }

    const result = await executeTool(decision.tool, decision.args ?? {}, lang);
    stepResults.push(result);
    transcript.push({
      role: "assistant",
      content: `(Called ${decision.tool} — result: ${result})`
    });
  }

  return {
    success: stepResults.length > 0,
    action: "agentic.reply",
    message: stepResults.join("\n\n") || (lang === "hi" ? "यह थोड़ा मुश्किल था, बॉस।" : "That was a bit much, Boss.")
  };
}