// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Browser Automation Agent (Renderer side)
//
// Delegates browser automation tasks to the Electron main process
// via IPC (where Playwright runs). Returns results to AI.
// ═══════════════════════════════════════════════════════════════════════════

import type { ReplyLang } from "../llm/openrouter";

export async function browserAgent(
  task:  string,
  url:   string,
  lang:  ReplyLang = "en"
): Promise<string> {

  if (!task.trim() && !url.trim()) {
    return "No browser task or URL provided.";
  }

  try {
    const result = await window.vsmart.browser.automate({ task, url });

    if (!result.success) {
      return `Browser task failed: ${result.error ?? "Unknown error"}`;
    }

    const parts: string[] = [];
    if (result.url)     parts.push(`URL: ${result.url}`);
    if (result.title)   parts.push(`Page: ${result.title}`);
    if (result.content) parts.push(`Content:\n${result.content.slice(0, 3000)}`);
    if (result.data)    parts.push(`Extracted:\n${JSON.stringify(result.data, null, 2).slice(0, 1000)}`);

    return parts.length > 0
      ? parts.join("\n")
      : "Browser task completed.";

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Browser automation error: ${msg}`;
  }
}
