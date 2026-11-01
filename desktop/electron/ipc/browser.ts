// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Browser Automation IPC Handler
// ═══════════════════════════════════════════════════════════════════════════

import { ipcMain } from "electron";
import { automateBrowser, closeBrowser } from "../services/browserAutomationService.js";

export function registerBrowserIPC(): void {
  ipcMain.handle("browser:automate", async (_event, task: { task: string; url?: string }) => {
    try {
      return await automateBrowser(task);
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("browser:close", async () => {
    try {
      await closeBrowser();
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
