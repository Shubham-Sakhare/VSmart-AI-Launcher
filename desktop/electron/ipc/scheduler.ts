// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Scheduler IPC Handler
// ═══════════════════════════════════════════════════════════════════════════

import { ipcMain } from "electron";
import {
  createScheduledTask,
  getAllScheduledTasks,
  deleteScheduledTask,
  toggleScheduledTask,
} from "../services/schedulerService.js";
import type { ScheduledTask } from "../services/schedulerService.js";

export function registerSchedulerIPC(): void {
  // Get all tasks
  ipcMain.handle("scheduler:getAll", async () => {
    return getAllScheduledTasks();
  });

  // Create a new task
  ipcMain.handle("scheduler:create", async (_event, task: Omit<ScheduledTask, "logs">) => {
    try {
      return { success: true, task: createScheduledTask(task) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Delete a task
  ipcMain.handle("scheduler:delete", async (_event, id: string) => {
    return { success: deleteScheduledTask(id) };
  });

  // Toggle enabled/disabled
  ipcMain.handle("scheduler:toggle", async (_event, id: string, enabled: boolean) => {
    return { success: toggleScheduledTask(id, enabled) };
  });
}
