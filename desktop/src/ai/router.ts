import { planner } from "./planner";
import { memoryAgent } from "../agents/memoryAgent";
import { chatAgent } from "../agents/chatAgent";
import { systemAgent } from "../agents/systemAgent";
import { codingAgent } from "../agents/codingAgent";
import { visionAgent } from "../agents/visionAgent";
import { fileSearchAgent } from "../agents/fileSearchAgent";
import { desktopControlAgent } from "../agents/desktopControlAgent";
import { speak } from "../app/voice/useVoice";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";
import type { Plan } from "./types";


export interface RouteResult {
  success: boolean;
  action: string;
  message?: string;
  data?: Record<string, any>;
}

const CONFIRM_WORDS = ["yes", "haan", "ha", "confirm", "karo", "ok", "sure"];
const CANCEL_WORDS = ["no", "nahi", "cancel", "mat karo"];



type ActionKey =
  | "search" | "open" | "write" | "close" | "play" | "pause" | "stop"
  | "volume" | "brightness" | "wifi" | "bluetooth" | "screenshot"
  | "folder" | "delete" | "create" | "notepad" | "recyclebin";

const ACTION_TEMPLATES: Record<ActionKey, { ack: Record<ReplyLang, string>; done: Record<ReplyLang, string> }> = {
  search: {
    ack: { en: "Ok Boss, searching...", hi: "ओके बॉस, सर्च कर रहा हूँ..." },
    done: { en: "Ok Boss, here's what I found.", hi: "बॉस, ये मिला।" }
  },
  open: {
    ack: { en: "Ok Boss, opening...", hi: "ओके बॉस, खोल रहा हूँ..." },
    done: { en: "Ok Boss, open kar diya. Next, what can I do for you?", hi: "ओके बॉस, खोल दिया। अगला, क्या करूं?" }
  },
  write: {
    ack: { en: "Ok Boss, writing...", hi: "ओके बॉस, लिख रहा हूँ..." },
    done: { en: "Ok Boss, likh diya.", hi: "ओके बॉस, लिख दिया।" }
  },
  close: {
    ack: { en: "Ok Boss, closing...", hi: "ओके बॉस, बंद कर रहा हूँ..." },
    done: { en: "Ok Boss, band kar diya.", hi: "ओके बॉस, बंद कर दिया।" }
  },
  play: {
    ack: { en: "Ok Boss, playing...", hi: "ओके बॉस, चला रहा हूँ..." },
    done: { en: "Ok Boss, chal raha hai.", hi: "ओके बॉस, चल रहा है।" }
  },
  pause: {
    ack: { en: "Ok Boss, pausing...", hi: "ओके बॉस, रोक रहा हूँ..." },
    done: { en: "Ok Boss, paused.", hi: "ओके बॉस, रोक दिया।" }
  },
  stop: {
    ack: { en: "Ok Boss, stopping...", hi: "ओके बॉस, रोक रहा हूँ..." },
    done: { en: "Ok Boss, stopped.", hi: "ओके बॉस, रोक दिया।" }
  },
  volume: {
    ack: { en: "Ok Boss, adjusting volume...", hi: "ओके बॉस, वॉल्यूम बदल रहा हूँ..." },
    done: { en: "Ok Boss, done.", hi: "ओके बॉस, हो गया।" }
  },
  brightness: {
    ack: { en: "Ok Boss, adjusting brightness...", hi: "ओके बॉस, ब्राइटनेस बदल रहा हूँ..." },
    done: { en: "Ok Boss, done.", hi: "ओके बॉस, हो गया।" }
  },
  wifi: {
    ack: { en: "Ok Boss, on it...", hi: "ओके बॉस, कर रहा हूँ..." },
    done: { en: "Ok Boss, done.", hi: "ओके बॉस, हो गया।" }
  },
  bluetooth: {
    ack: { en: "Ok Boss, on it...", hi: "ओके बॉस, कर रहा हूँ..." },
    done: { en: "Ok Boss, done.", hi: "ओके बॉस, हो गया।" }
  },
  screenshot: {
    ack: { en: "Ok Boss, taking a screenshot...", hi: "ओके बॉस, स्क्रीनशॉट ले रहा हूँ..." },
    done: { en: "Ok Boss, screenshot le liya.", hi: "ओके बॉस, स्क्रीनशॉट ले लिया।" }
  },
  folder: {
    ack: { en: "Ok Boss, opening the folder...", hi: "ओके बॉस, फ़ोल्डर खोल रहा हूँ..." },
    done: { en: "Ok Boss, folder open kar diya.", hi: "ओके बॉस, फ़ोल्डर खोल दिया।" }
  },
  delete: {
    ack: { en: "Ok Boss, deleting...", hi: "ओके बॉस, डिलीट कर रहा हूँ..." },
    done: { en: "Ok Boss, deleted.", hi: "ओके बॉस, डिलीट कर दिया।" }
  },
  create: {
    ack: { en: "Ok Boss, creating...", hi: "ओके बॉस, बना रहा हूँ..." },
    done: { en: "Ok Boss, ban gaya.", hi: "ओके बॉस, बन गया।" }
  },
  notepad: {
    ack: { en: "Ok Boss, opening Notepad...", hi: "ओके बॉस, नोटपैड खोल रहा हूँ..." },
    done: { en: "Ok Boss, likh diya.", hi: "ओके बॉस, लिख दिया।" }
  },
  recyclebin: {
    ack: { en: "Ok Boss, opening Recycle Bin...", hi: "ओके बॉस, रीसायकल बिन खोल रहा हूँ..." },
    done: { en: "Ok Boss, open kar diya.", hi: "ओके बॉस, खोल दिया।" }
  }
};

/** Classifies which action keyword a system command matches, using the RAW message
 * (before filler-word stripping) so words like "open"/"search" are still present. */
function classifyAction(rawMessage: string): ActionKey {
  const lower = rawMessage.toLowerCase();

  if (lower.includes("screenshot") || lower.includes("screen shot")) return "screenshot";
  if (lower.includes("recycle bin") || lower.includes("trash")) return "recyclebin";
  if (lower.includes("volume")) return "volume";
  if (lower.includes("brightness") || lower.includes("chamak")) return "brightness";
  if (lower.includes("wifi") || lower.includes("wi-fi")) return "wifi";
  if (lower.includes("bluetooth")) return "bluetooth";
  if (["download", "document", "desktop", "picture", "music", "video", "folder"].some(f => lower.includes(f))) return "folder";
  if (lower.includes("notepad")) return "notepad";
  if (/\b(delete|hatao|hata do|remove)\b/.test(lower)) return "delete";
  if (/\b(create|banao|bana do)\b/.test(lower)) return "create";
  if (/\b(pause|rok do|roko)\b/.test(lower)) return "pause";
  if (/\b(stop|band karo|band kar do)\b/.test(lower)) return "stop";
  if (/\b(close)\b/.test(lower)) return "close";
  if (/\b(play|chalao|chala do|bajao|baja do|lagao|laga do)\b/.test(lower)) return "play";
  if (/\b(search|khojo|dhundo|dhundho)\b/.test(lower)) return "search";
  return "open";
}

const CONFIRM_MSGS: Record<ReplyLang, { restart: string; shutdown: string; cancelled: string; cancelledUnclear: string }> = {
  en: {
    restart: "Are you sure you want to restart the PC, Boss? Say yes to confirm.",
    shutdown: "Are you sure you want to shut down the PC, Boss? Say yes to confirm.",
    cancelled: "Okay, cancelled.",
    cancelledUnclear: "Okay, I've cancelled that for safety."
  },
  hi: {
    restart: "बॉस, क्या आप पक्का पीसी रीस्टार्ट करना चाहते हैं? हां बोलें कन्फर्म करने के लिए।",
    shutdown: "बॉस, क्या आप पक्का पीसी शटडाउन करना चाहते हैं? हां बोलें कन्फर्म करने के लिए।",
    cancelled: "ठीक है, कैंसिल कर दिया।",
    cancelledUnclear: "सुरक्षा के लिए मैंने इसे कैंसिल कर दिया है।"
  }
};

const BLOCKED_TERMS = [
  "porn", "porno", "xxx", "nude", "nudes", "sex video", "adult video",
  "hentai", "onlyfans", "escort"
];

function isBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some(term => lower.includes(term));
}

// Tracks a pending destructive action awaiting a yes/no confirmation.
// Expires after PENDING_TIMEOUT_MS so a stray later message (e.g. the user
// changed topic instead of answering) never gets misread as a confirmation.
const PENDING_TIMEOUT_MS = 90_000;

let pendingConfirm: "restart" | "shutdown" | null = null;
let pendingConfirmAt = 0;

function isPendingExpired(setAt: number): boolean {
  return Date.now() - setAt > PENDING_TIMEOUT_MS;
}

// Tracks a pending multi-turn follow-up after certain "open X" commands —
// e.g. "open chrome" -> "which profile?" -> next message picks one;
// "open youtube" -> "what do you want to watch?" -> next message searches
// the same tab; "open vs code" -> "what do you want me to do?" -> next
// message is treated as a coding task.
type PendingFollowUp =
  | { type: "chrome_profile"; profiles: { name: string; directory: string }[] }
  | { type: "youtube_search" }
  | { type: "vscode_task" }
  | null;

let pendingFollowUp: PendingFollowUp = null;
let pendingFollowUpAt = 0;

const VSCODE_TRIGGER_WORDS = [
  "code", "vscode", "vs code", "visual studio code", "v s code",
  "code editor", "cde", "b s", "bs"
];

export async function route(
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

  const msgs = CONFIRM_MSGS[lang];

  // ---- Handle a pending restart/shutdown confirmation first ----
  if (pendingConfirm && isPendingExpired(pendingConfirmAt)) {
    pendingConfirm = null; // stale — fall through to normal handling below
  }

  if (pendingConfirm) {
    const lower = message.toLowerCase();
    const action = pendingConfirm;
    pendingConfirm = null;

    if (CONFIRM_WORDS.some(w => lower.includes(w))) {
      const result = await systemAgent(action);
      return { success: true, action: `system.${action}`, message: result };
    }

    if (CANCEL_WORDS.some(w => lower.includes(w))) {
      return { success: true, action: "system.cancelled", message: msgs.cancelled };
    }

    return { success: true, action: "system.cancelled", message: msgs.cancelledUnclear };
  }

  // ---- Handle a pending multi-turn follow-up next ----
  if (pendingFollowUp && isPendingExpired(pendingFollowUpAt)) {
    pendingFollowUp = null; // stale — fall through to normal handling below
  }

  if (pendingFollowUp) {
    const followUp = pendingFollowUp;
    pendingFollowUp = null;

    if (followUp.type === "youtube_search") {
      await window.vsmart.system.searchYoutube(message);
      return {
        success: true,
        action: "youtube.search",
        message: lang === "hi"
          ? `ठीक है बॉस, "${message}" search कर दिया।`
          : `Ok Boss, searched for "${message}".`
      };
    }

    if (followUp.type === "vscode_task") {
      const result = await codingAgent(message);
      return { success: true, action: "coding.write", message: result };
    }

    if (followUp.type === "chrome_profile") {
      const lower = message.toLowerCase();
      const chosen = followUp.profiles.find(p => lower.includes(p.name.toLowerCase()));

      if (chosen) {
        await window.vsmart.system.openChromeProfile(chosen.directory);
        return {
          success: true,
          action: "system.open",
          message: lang === "hi"
            ? `ओके बॉस, Chrome (${chosen.name}) खोल दिया।`
            : `Ok Boss, opened Chrome (${chosen.name}).`
        };
      }

      // Couldn't match a profile name — open the default profile rather
      // than leaving the user stuck.
      const result = await systemAgent("chrome");
      return {
        success: true,
        action: "system.open",
        message: [result, lang === "hi"
          ? "Profile samajh nahi aaya, default Chrome khol diya."
          : "Couldn't match that profile, opened the default Chrome instead."
        ].filter(Boolean).join(" ")
      };
    }
  }

  const plan: Plan = await planner(message, history);
  const { intent, command } = plan;

  switch (intent) {

    case "memory": {
      const lower = command.toLowerCase();

      if (lower.startsWith("show memory") || lower.includes("what do you remember")) {
        return {
          success: true,
          action: "memory.show",
          message: await memoryAgent("show")
        };
      }

      if (lower.startsWith("recall") || lower.startsWith("what is my") || lower.startsWith("what's my")) {
        const key = lower
          .replace(/^(recall|what is my|what's my)\s*/i, "")
          .replace(/\?$/, "")
          .trim();

        return {
          success: true,
          action: "memory.get",
          message: await memoryAgent("get", { key })
        };
      }

      return {
        success: true,
        action: "memory.save",
        message: await memoryAgent("save", { value: command })
      };
    }

    case "system": {
      const lower = command.toLowerCase();

      if (lower.includes("restart") || lower.includes("reboot")) {
        pendingConfirm = "restart";
        pendingConfirmAt = Date.now();
        return { success: true, action: "system.confirm", message: msgs.restart };
      }

      if (lower.includes("shutdown") || lower.includes("shut down")) {
        pendingConfirm = "shutdown";
        pendingConfirmAt = Date.now();
        return { success: true, action: "system.confirm", message: msgs.shutdown };
      }

      const trimmedCommand = lower.trim();

      // Chrome — if multiple profiles exist, ask which one before opening.
      if (trimmedCommand === "chrome" || trimmedCommand === "browser") {
        const profiles = await window.vsmart.system.getChromeProfiles();

        if (profiles.length > 1) {
          pendingFollowUp = { type: "chrome_profile", profiles };
          pendingFollowUpAt = Date.now();
          const names = profiles.map(p => p.name).join(", ");
          return {
            success: true,
            action: "system.askProfile",
            message: lang === "hi"
              ? `बॉस, कौन सी profile खोलूं? (${names})`
              : `Which profile should I open, Boss? (${names})`
          };
        }
        // 0 or 1 profile detected — fall through to the normal open below.
      }

      // YouTube — open it now, then ask what to search for (same tab).
      if (trimmedCommand === "youtube" || trimmedCommand === "yt") {
        speak(
          lang === "hi" ? "ओके बॉस, YouTube खोल रहा हूँ..." : "Ok Boss, opening YouTube...",
          lang === "hi" ? "hi-IN" : "en-IN"
        );

        const result = await systemAgent("youtube");
        pendingFollowUp = { type: "youtube_search" };
        pendingFollowUpAt = Date.now();

        return {
          success: true,
          action: "system.open",
          message: [
            result,
            lang === "hi" ? "YouTube पे क्या देखना चाहते हो?" : "What do you want to watch on YouTube?"
          ].filter(Boolean).join(" ")
        };
      }

      // VS Code — open it now, then ask what to build.
      if (VSCODE_TRIGGER_WORDS.includes(trimmedCommand)) {
        speak(
          lang === "hi" ? "ओके बॉस, VS Code खोल रहा हूँ..." : "Ok Boss, opening VS Code...",
          lang === "hi" ? "hi-IN" : "en-IN"
        );

        const result = await systemAgent(command);
        pendingFollowUp = { type: "vscode_task" };
        pendingFollowUpAt = Date.now();

        return {
          success: true,
          action: "system.open",
          message: [
            result,
            lang === "hi" ? "VS Code में क्या करना चाहते हो?" : "What do you want me to do in VS Code?"
          ].filter(Boolean).join(" ")
        };
      }

      const actionKey = classifyAction(message);
      const template = ACTION_TEMPLATES[actionKey];

      speak(template.ack[lang], lang === "hi" ? "hi-IN" : "en-IN");

      const result = await systemAgent(command);

      return {
        success: true,
        action: "system.open",
        message: [result, template.done[lang]].filter(Boolean).join(" ")
      };
    }

    case "vision": {
      speak(
        lang === "hi" ? "ओके बॉस, स्क्रीन देख रहा हूँ..." : "Ok Boss, looking at your screen...",
        lang === "hi" ? "hi-IN" : "en-IN"
      );

      const result = await visionAgent(command, lang);

      return {
        success: true,
        action: "vision.analyze",
        message: result
      };
    }

    case "file": {
      speak(
        lang === "hi" ? "ओके बॉस, फ़ाइलें ढूंढ रहा हूँ..." : "Ok Boss, searching your files...",
        lang === "hi" ? "hi-IN" : "en-IN"
      );

      const result = await fileSearchAgent(command, lang);

      return {
        success: true,
        action: "file.search",
        message: result
      };
    }

    case "automation": {
      const result = await desktopControlAgent(command, lang);

      return {
        success: true,
        action: "automation.control",
        message: result
      };
    }

    case "coding": {
      const template = ACTION_TEMPLATES.write;

      speak(template.ack[lang], lang === "hi" ? "hi-IN" : "en-IN");

      const result = await codingAgent(command, history);

      return {
        success: true,
        action: "coding.write",
        message: [result, template.done[lang]].filter(Boolean).join(" ")
      };
    }

    case "chat":
    default: {
      const reply = await chatAgent(message, lang, history);

      return {
        success: true,
        action: "chat",
        message: reply
      };
    }
  }
}