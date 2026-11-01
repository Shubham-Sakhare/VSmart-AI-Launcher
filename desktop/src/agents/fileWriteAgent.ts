// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - File Write Agent
//
// Writes content to a file via the Electron main process.
// Always verifies the write completed successfully.
// ═══════════════════════════════════════════════════════════════════════════

export async function fileWriteAgent(filePath: string, content: string): Promise<string> {
  if (!filePath.trim()) {
    return "No file path provided.";
  }
  if (content === undefined) {
    return "No content to write.";
  }

  try {
    const result = await window.vsmart.fileIntelligence.writeFile(filePath, content);

    if (!result.success) {
      return `Could not write file: ${result.error ?? "Unknown error"}`;
    }

    return `✓ File written: ${filePath} (${content.length} characters)`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Failed to write "${filePath}": ${msg}`;
  }
}
