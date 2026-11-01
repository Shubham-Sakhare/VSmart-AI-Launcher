// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - File Read Agent
//
// Reads content from local files: TXT, PDF, DOCX, MD, CSV, JSON.
// Uses the Electron main process for file access.
// ═══════════════════════════════════════════════════════════════════════════

// Max chars to return from a single file read (avoids overwhelming the LLM)
const MAX_CHARS = 8000;

export async function fileReadAgent(filePath: string): Promise<string> {
  if (!filePath.trim()) {
    return "No file path provided.";
  }

  try {
    // Request file read via IPC (fileIntelligence IPC handler)
    const result = await window.vsmart.fileIntelligence.readFile(filePath);

    if (!result.success) {
      return `Could not read file: ${result.error ?? "Unknown error"}`;
    }

    const content = result.content ?? "";
    const trimmed = content.length > MAX_CHARS
      ? content.slice(0, MAX_CHARS) + `\n\n[... file truncated at ${MAX_CHARS} characters ...]`
      : content;

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return `File: ${filePath}\nType: ${ext.toUpperCase()}\nSize: ${content.length} characters\n\n${trimmed}`;

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Failed to read "${filePath}": ${msg}`;
  }
}
