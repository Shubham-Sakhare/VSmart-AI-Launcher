// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - File Intelligence IPC Handler
// ═══════════════════════════════════════════════════════════════════════════

import { ipcMain } from "electron";
import { readFile, writeFile, listDirectory } from "../services/fileIntelligenceService.js";

export function registerFileIntelligenceIPC(): void {
  ipcMain.handle("fileintel:read", async (_event, filePath: string) => {
    return readFile(filePath);
  });

  ipcMain.handle("fileintel:write", async (_event, filePath: string, content: string) => {
    return writeFile(filePath, content);
  });

  ipcMain.handle("fileintel:listDir", async (_event, dirPath: string, maxDepth?: number) => {
    try {
      return { success: true, files: listDirectory(dirPath, maxDepth) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
