import { planner } from "./planner";
import { memoryAgent } from "../agents/memoryAgent";
import { chatAgent } from "../agents/chatAgent";
import { systemAgent } from "../agents/systemAgent";
import { codingAgent } from "../agents/codingAgent";
import { visionAgent } from "../agents/visionAgent";
import { fileSearchAgent } from "../agents/fileSearchAgent";
import { desktopControlAgent } from "../agents/desktopControlAgent";
import {
  naturalReply,
  interpretConfirmation,
  pickOption,
  extractSearchQuery,
} from "./dynamic";
import type { ReplyLang, ChatHistoryMessage } from "../llm/openrouter";
import type { Plan } from "./types";


export interface RouteResult {
  success: boolean;
  action: string;
  message?: string;
  data?: Record<string, any>;
}

// Minimal fallbacks, used ONLY when the LLM is unavailable.
const FALLBACK: Record<ReplyLang, { done: string; cancelled: string; blocked: string; confirmRestart: string; confirmShutdown: string }> = {
  en: {
    done:            "Done! Let me know if you need anything else.",
    cancelled:       "Alright, cancelled. Just say the word if you change your mind.",
    blocked:         "Sorry, that's not something I can help with.",
    confirmRestart:  "Just to confirm — you want to restart the PC? Say yes and I'll do it.",
    confirmShutdown: "Just to confirm — you want to shut down the PC? Say yes and I'll proceed.",
  },
  hi: {
    done:            "हो गया! कुछ और चाहिए तो बताओ।",
    cancelled:       "ठीक है, छोड़ दिया। बदलना हो तो बताओ।",
    blocked:         "यह नहीं कर सकता, माफ़ करना।",
    confirmRestart:  "एक बार confirm करो — PC restart करनी है? हाँ बोलो तो करता हूँ।",
    confirmShutdown: "एक बार confirm करो — PC shutdown करनी है? हाँ बोलो तो करता हूँ।",
  },
};

// Hard safety guard (kept deterministic on purpose).
const BLOCKED_TERMS = [
  "porn", "porno", "xxx", "nude", "nudes", "sex video", "adult video",
  "hentai", "onlyfans", "escort"
];

function isBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some(term => lower.includes(term));
}

// ---- Pending destructive action (restart / shutdown) ----
const PENDING_TIMEOUT_MS = 90_000;

let pendingConfirm: "restart" | "shutdown" | null = null;
let pendingConfirmAt = 0;

function isPendingExpired(setAt: number): boolean {
  return Date.now() - setAt > PENDING_TIMEOUT_MS;
}

// ---- Pending multi-turn follow-ups ----
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

// Short action results get rephrased into a natural reply.
// Long results (file lists, analysis, code) are passed through untouched.
const MAX_WRAP_LENGTH = 300;

async function wrapResult(
  userMessage: string,
  lang: ReplyLang,
  history: ChatHistoryMessage[],
  actionDesc: string,
  result: string | undefined
): Promise<string> {
  const text = (result ?? "").trim();
  if (text.length > MAX_WRAP_LENGTH) return text;

  return naturalReply({
    userMessage,
    lang,
    history,
    situation: text
      ? `You performed: ${actionDesc}. Result: ${text}`
      : `You performed: ${actionDesc}. It completed with no extra output.`,
    fallback: text || FALLBACK[lang].done,
  });
}

export async function route(
  message: string,
  lang: ReplyLang = "en",
  history: ChatHistoryMessage[] = []
): Promise<RouteResult> {

  const fb = FALLBACK[lang];

  if (isBlocked(message)) {
    return {
      success: false,
      action: "blocked",
      message: await naturalReply({
        userMessage: message,
        lang,
        history,
        situation: "The user asked for adult content. Politely decline in one short sentence without judgment.",
        fallback: fb.blocked,
      }),
    };
  }

  // ---- Pending restart/shutdown confirmation ----
  if (pendingConfirm && isPendingExpired(pendingConfirmAt)) {
    pendingConfirm = null;
  }

  if (pendingConfirm) {
    const action = pendingConfirm;
    pendingConfirm = null;

    const decision = await interpretConfirmation(message, `${action}`);

    if (decision === "confirm") {
      const result = await systemAgent(action);
      return {
        success: true,
        action: `system.${action}`,
        message: await wrapResult(message, lang, history, `${action} the PC`, result),
      };
    }

    return {
      success: true,
      action: "system.cancelled",
      message: await naturalReply({
        userMessage: message,
        lang,
        history,
        situation: `The user did not clearly confirm, so you cancelled the PC ${action}. Tell them it's cancelled.`,
        fallback: fb.cancelled,
      }),
    };
  }

  // ---- Pending multi-turn follow-up ----
  if (pendingFollowUp && isPendingExpired(pendingFollowUpAt)) {
    pendingFollowUp = null;
  }

  if (pendingFollowUp) {
    const followUp = pendingFollowUp;
    pendingFollowUp = null;

    if (followUp.type === "youtube_search") {
      const query = await extractSearchQuery(message);
      await window.vsmart.system.searchYoutube(query);
      return {
        success: true,
        action: "youtube.search",
        message: await wrapResult(message, lang, history, `searched YouTube for "${query}"`, undefined),
      };
    }

    if (followUp.type === "vscode_task") {
      const result = await codingAgent(message);
      return { success: true, action: "coding.write", message: await wrapResult(message, lang, history, "wrote code in VS Code as requested", result) };
    }

    if (followUp.type === "chrome_profile") {
      const idx = await pickOption(message, followUp.profiles.map(p => p.name));

      if (idx >= 0) {
        const chosen = followUp.profiles[idx];
        await window.vsmart.system.openChromeProfile(chosen.directory);
        return {
          success: true,
          action: "system.open",
          message: await wrapResult(message, lang, history, `opened Chrome with the "${chosen.name}" profile`, undefined),
        };
      }

      const result = await systemAgent("chrome");
      return {
        success: true,
        action: "system.open",
        message: await wrapResult(
          message, lang, history,
          "opened default Chrome because the profile choice wasn't understood", result
        ),
      };
    }
  }

  const plan: Plan = await planner(message, history);
  const { intent, command } = plan;

  switch (intent) {

    case "memory": {
      const lower = command.toLowerCase();

      if (lower.startsWith("show memory") || lower.includes("what do you remember")) {
        return { success: true, action: "memory.show", message: await memoryAgent("show") };
      }

      if (lower.startsWith("recall") || lower.startsWith("what is my") || lower.startsWith("what's my")) {
        const key = lower
          .replace(/^(recall|what is my|what's my)\s*/i, "")
          .replace(/\?$/, "")
          .trim();
        return { success: true, action: "memory.get", message: await memoryAgent("get", { key }) };
      }

      const saved = await memoryAgent("save", { value: command });
      return {
        success: true,
        action: "memory.save",
        message: await wrapResult(message, lang, history, "saved this to memory", saved),
      };
    }

    case "system": {
      const lower = command.toLowerCase();

      if (lower.includes("restart") || lower.includes("reboot")) {
        pendingConfirm = "restart";
        pendingConfirmAt = Date.now();
        return {
          success: true,
          action: "system.confirm",
          message: await naturalReply({
            userMessage: message, lang, history,
            situation: "The user wants to restart the PC. Ask them to confirm (yes/no) before doing it.",
            fallback: fb.confirmRestart,
          }),
        };
      }

      if (lower.includes("shutdown") || lower.includes("shut down")) {
        pendingConfirm = "shutdown";
        pendingConfirmAt = Date.now();
        return {
          success: true,
          action: "system.confirm",
          message: await naturalReply({
            userMessage: message, lang, history,
            situation: "The user wants to shut down the PC. Ask them to confirm (yes/no) before doing it.",
            fallback: fb.confirmShutdown,
          }),
        };
      }

      const trimmedCommand = lower.trim();

      // Chrome — ask which profile if there are several.
      if (trimmedCommand === "chrome" || trimmedCommand === "browser") {
        const profiles = await window.vsmart.system.getChromeProfiles();

        if (profiles.length > 1) {
          pendingFollowUp = { type: "chrome_profile", profiles };
          pendingFollowUpAt = Date.now();
          const names = profiles.map(p => p.name).join(", ");
          return {
            success: true,
            action: "system.askProfile",
            message: await naturalReply({
              userMessage: message, lang, history,
              situation: `Chrome has several profiles: ${names}. Ask which one to open.`,
              fallback: lang === "hi" ? `बॉस, कौन सी profile खोलूं? (${names})` : `Which profile should I open, Boss? (${names})`,
            }),
          };
        }
      }

      // YouTube — open, then ask what to watch.
      if (trimmedCommand === "youtube" || trimmedCommand === "yt") {
        const result = await systemAgent("youtube");
        pendingFollowUp = { type: "youtube_search" };
        pendingFollowUpAt = Date.now();
        return {
          success: true,
          action: "system.open",
          message: await naturalReply({
            userMessage: message, lang, history,
            situation: `You opened YouTube${result ? ` (${result})` : ""}. Now ask what they want to watch.`,
            fallback: lang === "hi" ? "YouTube खोल दिया। क्या देखना चाहते हो?" : "YouTube is open. What do you want to watch?",
          }),
        };
      }

      // VS Code — open, then ask what to build.
      if (VSCODE_TRIGGER_WORDS.includes(trimmedCommand)) {
        const result = await systemAgent(command);
        pendingFollowUp = { type: "vscode_task" };
        pendingFollowUpAt = Date.now();
        return {
          success: true,
          action: "system.open",
          message: await naturalReply({
            userMessage: message, lang, history,
            situation: `You opened VS Code${result ? ` (${result})` : ""}. Now ask what they want you to do in it.`,
            fallback: lang === "hi" ? "VS Code खोल दिया। क्या करना है?" : "VS Code is open. What should I do in it?",
          }),
        };
      }

      // Any other system command: execute, then describe naturally.
      const result = await systemAgent(command);
      return {
        success: true,
        action: "system.run",
        message: await wrapResult(message, lang, history, `system command "${command}"`, result),
      };
    }

    case "vision": {
      const result = await visionAgent(command, lang);
      return { success: true, action: "vision.analyze", message: result };
    }

    case "file": {
      const result = await fileSearchAgent(command, lang);
      return { success: true, action: "file.search", message: result };
    }

    case "automation": {
      const result = await desktopControlAgent(command, lang);
      return {
        success: true,
        action: "automation.control",
        message: await wrapResult(message, lang, history, `desktop automation "${command}"`, result),
      };
    }

    case "coding": {
      const result = await codingAgent(command, history);
      return {
        success: true,
        action: "coding.write",
        message: await wrapResult(message, lang, history, "wrote the requested code", result),
      };
    }

    case "chat":
    default: {
      const reply = await chatAgent(message, lang, history);
      return { success: true, action: "chat", message: reply };
    }
  }
}