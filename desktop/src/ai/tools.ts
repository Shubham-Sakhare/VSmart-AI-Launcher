// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Tool Registry & Dispatcher
//
// Unified registry of all tools available to the AI.
// Every tool: name, description, args shape, risk level.
// executeTool() dispatches to the correct agent/service.
// ═══════════════════════════════════════════════════════════════════════════

import type { ReplyLang } from "../llm/openrouter";
import { systemAgent }         from "../agents/systemAgent";
import { fileSearchAgent }     from "../agents/fileSearchAgent";
import { desktopControlAgent } from "../agents/desktopControlAgent";
import { visionAgent }         from "../agents/visionAgent";
import { codingAgent }         from "../agents/codingAgent";
import { memoryAgent }         from "../agents/memoryAgent";

export interface ToolSpec {
  name:        string;
  description: string;
  argsShape:   string;
  risk:        "low" | "medium" | "high" | "critical";
  category:    "system" | "file" | "web" | "ai" | "memory" | "ui" | "meta";
}

export const TOOLS: ToolSpec[] = [
  // ── System & Desktop ──────────────────────────────────────────────────
  {
    name: "system_action",
    description:
      "Open an app, website, or system folder (Downloads/Documents/Desktop/Pictures/etc), " +
      "control volume/brightness/wifi/bluetooth, take a screenshot, open the Recycle Bin, " +
      "play/pause/stop media. Use free-form natural language in 'command' exactly as the user said it.",
    argsShape: `{ "command": string }`,
    risk:     "medium",
    category: "system",
  },
  {
    name: "desktop_control",
    description:
      "Low-level mouse/keyboard automation: click at coordinates, type text into the focused field, " +
      "press a key combo. Prefer this after vision_analyze has found coordinates.",
    argsShape: `{ "command": string }`,
    risk:     "medium",
    category: "system",
  },
  {
    name: "vision_analyze",
    description:
      "Capture and analyze the current screen. Answer questions about what's visible. " +
      "Returns element positions for desktop_control to interact with.",
    argsShape: `{ "question": string }`,
    risk:     "low",
    category: "system",
  },

  // ── File Intelligence ─────────────────────────────────────────────────
  {
    name: "file_search",
    description: "Search the user's files/documents by name, type (pdf/doc/image/etc), or description.",
    argsShape: `{ "query": string }`,
    risk:     "low",
    category: "file",
  },
  {
    name: "file_read",
    description: "Read and extract text content from a file (TXT, PDF, DOCX, MD, XLSX). " +
      "Requires the full file path from file_search first.",
    argsShape: `{ "path": string }`,
    risk:     "low",
    category: "file",
  },
  {
    name: "file_write",
    description: "Create or write content to a file. " +
      "Requires explicit user permission for overwriting existing files.",
    argsShape: `{ "path": string, "content": string }`,
    risk:     "medium",
    category: "file",
  },
  {
    name: "file_summarize",
    description: "Find a file, read it, and summarize its content in natural language.",
    argsShape: `{ "query": string, "question": string }`,
    risk:     "low",
    category: "file",
  },

  // ── Web & Browser ─────────────────────────────────────────────────────
  {
    name: "web_search",
    description: "Search the internet for current information, news, or any web query.",
    argsShape: `{ "query": string }`,
    risk:     "low",
    category: "web",
  },
  {
    name: "browser_open",
    description: "Open a URL or website in the default browser.",
    argsShape: `{ "url": string }`,
    risk:     "low",
    category: "web",
  },
  {
    name: "browser_automate",
    description: "Automate browser tasks: navigate pages, fill forms, click buttons, extract data. " +
      "Use Playwright. Requires user permission for sensitive pages.",
    argsShape: `{ "task": string, "url"?: string }`,
    risk:     "medium",
    category: "web",
  },

  // ── Coding ────────────────────────────────────────────────────────────
  {
    name: "coding_task",
    description: "Write, review, debug, or scaffold code / a small project based on the user's request.",
    argsShape: `{ "request": string }`,
    risk:     "medium",
    category: "ai",
  },

  // ── Memory ────────────────────────────────────────────────────────────
  {
    name: "memory_save",
    description: "Explicitly save a fact the user asked to be remembered.",
    argsShape: `{ "key": string, "value": string }`,
    risk:     "low",
    category: "memory",
  },
  {
    name: "memory_get",
    description: "Recall a specific previously-saved fact.",
    argsShape: `{ "query": string }`,
    risk:     "low",
    category: "memory",
  },
  {
    name: "memory_show",
    description: "List everything currently remembered about the user.",
    argsShape: `{}`,
    risk:     "low",
    category: "memory",
  },

  // ── RAG / Documents ───────────────────────────────────────────────────
  {
    name: "rag_query",
    description: "Query the local document knowledge base using semantic search. " +
      "Use when the user asks about content from their documents/files.",
    argsShape: `{ "query": string, "docPath"?: string }`,
    risk:     "low",
    category: "ai",
  },

  // ── Meta ──────────────────────────────────────────────────────────────
  {
    name: "request_confirmation",
    description:
      "MUST be used before any destructive/irreversible action — restart, shutdown, " +
      "deleting files, closing unsaved work. Ask the user a clear yes/no question.",
    argsShape: `{ "question": string, "onConfirmTool": string, "onConfirmArgs": object }`,
    risk:     "low",
    category: "meta",
  },
  {
    name: "final_reply",
    description:
      "Use when no action is needed, or once you have the result and are ready to reply naturally.",
    argsShape: `{ "message": string }`,
    risk:     "low",
    category: "meta",
  },
];

// ── Tool list for LLM prompt ──────────────────────────────────────────────────
export function toolListForPrompt(): string {
  return TOOLS.map(
    t => `- ${t.name}${t.argsShape} [risk:${t.risk}]: ${t.description}`
  ).join("\n");
}

// ── Get tool risk ─────────────────────────────────────────────────────────────
export function getToolRisk(name: string): ToolSpec["risk"] {
  return TOOLS.find(t => t.name === name)?.risk ?? "medium";
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  lang: ReplyLang
): Promise<string> {
  try {
    switch (name) {

      // ── System ────────────────────────────────────────────────────────
      case "system_action":
        return await systemAgent(String(args?.command ?? ""));

      case "desktop_control":
        return await desktopControlAgent(String(args?.command ?? ""), lang);

      case "vision_analyze":
        return await visionAgent(String(args?.question ?? ""), lang);

      // ── File ──────────────────────────────────────────────────────────
      case "file_search":
        return await fileSearchAgent(String(args?.query ?? ""), lang);

      case "file_read": {
        // Dynamic import to avoid loading pdf-parse etc. at startup
        const { fileReadAgent } = await import("../agents/fileReadAgent");
        return await fileReadAgent(String(args?.path ?? ""));
      }

      case "file_write": {
        const { fileWriteAgent } = await import("../agents/fileWriteAgent");
        return await fileWriteAgent(String(args?.path ?? ""), String(args?.content ?? ""));
      }

      case "file_summarize": {
        const { fileSummarizeAgent } = await import("../agents/fileSummarizeAgent");
        return await fileSummarizeAgent(String(args?.query ?? ""), String(args?.question ?? ""), lang);
      }

      // ── Web ───────────────────────────────────────────────────────────
      case "web_search": {
        const { webSearchAgent } = await import("../agents/webSearchAgent");
        return await webSearchAgent(String(args?.query ?? ""), lang);
      }

      case "browser_open": {
        const url = String(args?.url ?? "");
        await window.vsmart.openSystem(url);
        return `Opened ${url}`;
      }

      case "browser_automate": {
        const { browserAgent } = await import("../agents/browserAgent");
        return await browserAgent(String(args?.task ?? ""), String(args?.url ?? ""), lang);
      }

      // ── Coding ────────────────────────────────────────────────────────
      case "coding_task":
        return await codingAgent(String(args?.request ?? ""));

      // ── Memory ────────────────────────────────────────────────────────
      case "memory_save": {
        const key   = String(args?.key ?? args?.text ?? "");
        const value = String(args?.value ?? args?.text ?? "");
        return await memoryAgent("save", { key, value });
      }

      case "memory_get":
        return await memoryAgent("get", { key: args?.query });

      case "memory_show":
        return await memoryAgent("show");

      // ── RAG ───────────────────────────────────────────────────────────
      case "rag_query": {
        const { ragQueryAgent } = await import("../agents/ragQueryAgent");
        return await ragQueryAgent(String(args?.query ?? ""), args?.docPath as string | undefined, lang);
      }

      // ── Meta ──────────────────────────────────────────────────────────
      case "request_confirmation":
        return JSON.stringify({
          type:          "confirmation_required",
          question:      args?.question ?? "Are you sure?",
          onConfirmTool: args?.onConfirmTool,
          onConfirmArgs: args?.onConfirmArgs ?? {},
        });

      case "final_reply":
        return String(args?.message ?? "");

      default:
        return `Unknown tool "${name}" — no action taken.`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Tool "${name}" failed: ${msg}`;
  }
}
