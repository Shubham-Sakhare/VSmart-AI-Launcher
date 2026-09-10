import type { ReplyLang } from "../llm/openrouter";
import { systemAgent } from "../agents/systemAgent";
import { fileSearchAgent } from "../agents/fileSearchAgent";
import { desktopControlAgent } from "../agents/desktopControlAgent";
import { visionAgent } from "../agents/visionAgent";
import { codingAgent } from "../agents/codingAgent";
import { memoryAgent } from "../agents/memoryAgent";

export interface ToolSpec {
  name: string;
  description: string;
  argsShape: string;
  risk: "low" | "medium" | "high" | "critical";
}

export const TOOLS: ToolSpec[] = [
  {
    name: "system_action",
    description:
      "Open an app, website, or system folder (Downloads/Documents/Desktop/Pictures/etc), " +
      "control volume/brightness/wifi/bluetooth, take a screenshot, open the Recycle Bin, " +
      "play/pause/stop media. Use free-form natural language in 'command' exactly as the user said it.",
    argsShape: `{ "command": string }`,
    risk: "medium"
  },
  {
    name: "file_search",
    description: "Search the user's files/documents by name, type (pdf/doc/image/etc), or rough description.",
    argsShape: `{ "query": string }`,
    risk: "low"
  },
  {
    name: "desktop_control",
    description:
      "Low-level mouse/keyboard automation: click at coordinates, type text into the focused field, press a key combo. " +
      "Prefer this after vision_analyze has found coordinates.",
    argsShape: `{ "command": string }`,
    risk: "medium"
  },
  {
    name: "vision_analyze",
    description:
      "Look at the user's current screen and answer a question about what's visible. " +
      "Also use when the user wants to click/interact with something on screen — the agent will return coordinates if possible.",
    argsShape: `{ "question": string }`,
    risk: "low"
  },
  {
    name: "coding_task",
    description: "Write, review, debug, or scaffold code / a small project based on the user's request.",
    argsShape: `{ "request": string }`,
    risk: "medium"
  },
  {
    name: "memory_save",
    description: "Explicitly save a fact the user asked to be remembered (e.g. 'remember my wifi password is X').",
    argsShape: `{ "text": string }`,
    risk: "low"
  },
  {
    name: "memory_get",
    description: "Recall a specific previously-saved fact (e.g. 'what's my wifi password').",
    argsShape: `{ "query": string }`,
    risk: "low"
  },
  {
    name: "memory_show",
    description: "List everything currently remembered about the user.",
    argsShape: `{}`,
    risk: "low"
  },
  {
    name: "request_confirmation",
    description:
      "MUST be used before any destructive/irreversible action — restart, shutdown, deleting files, " +
      "closing unsaved work. Ask the user a clear yes/no question. Do NOT call system_action directly " +
      "for these actions until the user has confirmed in a later turn.",
    argsShape: `{ "question": string, "onConfirmTool": string, "onConfirmArgs": object }`,
    risk: "low"
  },
  {
    name: "final_reply",
    description:
      "Use this when no action is needed, or once you already have the result and are ready to answer " +
      "the user directly — a normal conversational reply, like a person talking to another person.",
    argsShape: `{ "message": string }`,
    risk: "low"
  }
];

export function toolListForPrompt(): string {
  return TOOLS.map(
    t => `- ${t.name}${t.argsShape} [risk:${t.risk}]: ${t.description}`
  ).join("\n");
}

export function getToolRisk(name: string): ToolSpec["risk"] {
  return TOOLS.find(t => t.name === name)?.risk ?? "medium";
}

export async function executeTool(
  name: string,
  args: Record<string, any>,
  lang: ReplyLang
): Promise<string> {
  try {
    switch (name) {
      case "system_action":
        return await systemAgent(String(args?.command ?? ""));

      case "file_search":
        return await fileSearchAgent(String(args?.query ?? ""), lang);

      case "desktop_control":
        return await desktopControlAgent(String(args?.command ?? ""), lang);

      case "vision_analyze":
        return await visionAgent(String(args?.question ?? ""), lang);

      case "coding_task":
        return await codingAgent(String(args?.request ?? ""));

      case "memory_save":
        return await memoryAgent("save", { value: args?.text });

      case "memory_get":
        return await memoryAgent("get", { key: args?.query });

      case "memory_show":
        return await memoryAgent("show");

      case "request_confirmation":
        // Does not execute anything — agenticRouter handles the pending state.
        return JSON.stringify({
          type: "confirmation_required",
          question: args?.question ?? "Are you sure?",
          onConfirmTool: args?.onConfirmTool,
          onConfirmArgs: args?.onConfirmArgs ?? {}
        });

      case "final_reply":
        return String(args?.message ?? "");

      default:
        return `(Unknown tool "${name}" — ignoring and answering directly instead.)`;
    }
  } catch (err: any) {
    return `Tool "${name}" failed: ${err?.message ?? String(err)}`;
  }
}