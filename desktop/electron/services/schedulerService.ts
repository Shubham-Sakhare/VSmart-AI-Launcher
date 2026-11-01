// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Automation Scheduler Service (Electron Main)
//
// Manages scheduled and recurring tasks:
//   • One-time reminders
//   • Recurring tasks (daily, weekly, custom cron)
//   • Persistent storage in SQLite
//   • Desktop notifications
//   • Background execution
// ═══════════════════════════════════════════════════════════════════════════

import { Notification, BrowserWindow } from "electron";
import Database  from "better-sqlite3";
import path      from "path";
import fs        from "fs";
import { app }   from "electron";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ScheduledTask {
  id:          string;
  title:       string;
  description: string;
  type:        "once" | "recurring";
  command:     string;     // The command/task to execute
  schedule:    string;     // ISO date string (once) or cron expression (recurring)
  enabled:     boolean;
  lastRun?:    string;
  nextRun?:    string;
  createdAt:   string;
  logs:        string[];
}

// ── Database setup ────────────────────────────────────────────────────────────
const dataDir = app.isPackaged ? app.getPath("userData") : process.cwd();
const dbPath  = path.join(dataDir, "vsmart-memory.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Create scheduler table if not exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    type        TEXT NOT NULL DEFAULT 'once',
    command     TEXT NOT NULL,
    schedule    TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run    TEXT,
    next_run    TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logs        TEXT DEFAULT '[]'
  )
`).run();

// ── Active timers (in-memory) ─────────────────────────────────────────────────
const activeTimers = new Map<string, ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>();
let mainWindowRef: (() => BrowserWindow | null) | null = null;

export function setMainWindowRef(fn: () => BrowserWindow | null): void {
  mainWindowRef = fn;
}

// ── Cron-like schedule parser (simple, no external dep) ──────────────────────
// Supports:
//   ISO date string       → one-time at that date
//   "daily HH:MM"         → every day at time
//   "weekly MON HH:MM"    → every week on day at time
//   "hourly"              → every hour
//   "Xm" / "Xh"          → every X minutes/hours
function parseSchedule(schedule: string): { type: "once" | "interval"; ms: number; nextDate?: Date } {
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(schedule)) {
    const d  = new Date(schedule);
    const ms = d.getTime() - Date.now();
    return { type: "once", ms: Math.max(ms, 1000), nextDate: d };
  }

  // "Xm" every X minutes
  const minMatch = schedule.match(/^(\d+)m$/i);
  if (minMatch) return { type: "interval", ms: parseInt(minMatch[1]) * 60 * 1000 };

  // "Xh" every X hours
  const hrMatch = schedule.match(/^(\d+)h$/i);
  if (hrMatch) return { type: "interval", ms: parseInt(hrMatch[1]) * 60 * 60 * 1000 };

  // "hourly"
  if (/hourly/i.test(schedule)) return { type: "interval", ms: 60 * 60 * 1000 };

  // "daily HH:MM"
  const dailyMatch = schedule.match(/daily\s+(\d{1,2}):(\d{2})/i);
  if (dailyMatch) {
    const [_, hh, mm] = dailyMatch;
    const next = nextOccurrence(parseInt(hh), parseInt(mm));
    return { type: "interval", ms: 24 * 60 * 60 * 1000, nextDate: next };
  }

  // "weekly MON HH:MM"
  const weeklyMatch = schedule.match(/weekly\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2}):(\d{2})/i);
  if (weeklyMatch) {
    const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
    const targetDay = dayMap[weeklyMatch[1].toLowerCase()];
    const hh = parseInt(weeklyMatch[2]);
    const mm = parseInt(weeklyMatch[3]);
    const next = nextWeeklyOccurrence(targetDay, hh, mm);
    return { type: "interval", ms: 7 * 24 * 60 * 60 * 1000, nextDate: next };
  }

  // Default: 1 minute
  return { type: "interval", ms: 60 * 1000 };
}

function nextOccurrence(hour: number, minute: number): Date {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function nextWeeklyOccurrence(targetDay: number, hour: number, minute: number): Date {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  const daysUntil = (targetDay - now.getDay() + 7) % 7 || 7;
  next.setDate(now.getDate() + daysUntil);
  return next;
}

// ── Notify via desktop notification + IPC to renderer ────────────────────────
function fireTaskNotification(task: ScheduledTask): void {
  // Desktop notification
  if (Notification.isSupported()) {
    new Notification({
      title:   `VSmart AI: ${task.title}`,
      body:    task.description || task.command,
      silent:  false,
    }).show();
  }

  // Send to renderer via IPC
  const win = mainWindowRef?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send("scheduler:task-fired", {
      id:          task.id,
      title:       task.title,
      description: task.description,
      command:     task.command,
    });
  }
}

// ── Log task execution ────────────────────────────────────────────────────────
function logTaskRun(taskId: string, message: string): void {
  try {
    const row = db.prepare("SELECT logs FROM scheduled_tasks WHERE id = ?").get(taskId) as { logs: string } | undefined;
    const logs: string[] = JSON.parse(row?.logs ?? "[]");
    logs.unshift(`[${new Date().toISOString()}] ${message}`);
    db.prepare("UPDATE scheduled_tasks SET logs = ?, last_run = ? WHERE id = ?")
      .run(JSON.stringify(logs.slice(0, 50)), new Date().toISOString(), taskId);
  } catch { /* non-fatal */ }
}

// ── Schedule a task ───────────────────────────────────────────────────────────
export function scheduleTask(task: ScheduledTask): void {
  const { type, ms, nextDate } = parseSchedule(task.schedule);

  // Clear existing timer
  cancelTask(task.id);

  // Update next_run in DB
  if (nextDate) {
    db.prepare("UPDATE scheduled_tasks SET next_run = ? WHERE id = ?")
      .run(nextDate.toISOString(), task.id);
  }

  const run = () => {
    logTaskRun(task.id, `Fired: ${task.command}`);
    fireTaskNotification(task);

    // Update next_run for recurring
    if (type === "interval") {
      const nextRun = new Date(Date.now() + ms);
      db.prepare("UPDATE scheduled_tasks SET next_run = ? WHERE id = ?")
        .run(nextRun.toISOString(), task.id);
    }
  };

  let delay = ms;
  if (nextDate) {
    delay = Math.max(nextDate.getTime() - Date.now(), 1000);
  }

  if (type === "once") {
    const timer = setTimeout(() => {
      run();
      activeTimers.delete(task.id);
      // Mark as completed
      db.prepare("UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?").run(task.id);
    }, delay);
    activeTimers.set(task.id, timer);
  } else {
    // First fire after delay, then every ms
    const firstTimer = setTimeout(() => {
      run();
      const interval = setInterval(run, ms);
      activeTimers.set(task.id, interval);
    }, delay);
    activeTimers.set(task.id, firstTimer);
  }
}

// ── Cancel a task ─────────────────────────────────────────────────────────────
export function cancelTask(id: string): void {
  const timer = activeTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
    clearInterval(timer as ReturnType<typeof setInterval>);
    activeTimers.delete(id);
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
export function createScheduledTask(task: Omit<ScheduledTask, "logs">): ScheduledTask {
  const full: ScheduledTask = { ...task, logs: [] };
  db.prepare(`
    INSERT INTO scheduled_tasks (id, title, description, type, command, schedule, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(full.id, full.title, full.description, full.type, full.command, full.schedule, full.enabled ? 1 : 0, full.createdAt);

  if (full.enabled) scheduleTask(full);
  return full;
}

export function getAllScheduledTasks(): ScheduledTask[] {
  const rows = db.prepare("SELECT * FROM scheduled_tasks ORDER BY created_at DESC").all() as {
    id: string; title: string; description: string; type: string; command: string;
    schedule: string; enabled: number; last_run: string | null; next_run: string | null;
    created_at: string; logs: string;
  }[];

  return rows.map(r => ({
    id:          r.id,
    title:       r.title,
    description: r.description,
    type:        r.type as "once" | "recurring",
    command:     r.command,
    schedule:    r.schedule,
    enabled:     !!r.enabled,
    lastRun:     r.last_run ?? undefined,
    nextRun:     r.next_run ?? undefined,
    createdAt:   r.created_at,
    logs:        JSON.parse(r.logs ?? "[]"),
  }));
}

export function deleteScheduledTask(id: string): boolean {
  cancelTask(id);
  const result = db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
  return result.changes > 0;
}

export function toggleScheduledTask(id: string, enabled: boolean): boolean {
  db.prepare("UPDATE scheduled_tasks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  if (!enabled) {
    cancelTask(id);
  } else {
    const row = db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as ScheduledTask | undefined;
    if (row) scheduleTask(row);
  }
  return true;
}

// ── Initialize — re-arm all enabled tasks on startup ─────────────────────────
export function initScheduler(getMainWindow: () => BrowserWindow | null): void {
  mainWindowRef = getMainWindow;

  const tasks = getAllScheduledTasks();
  let armed = 0;
  for (const task of tasks) {
    if (task.enabled) {
      scheduleTask(task);
      armed++;
    }
  }
  console.log(`[Scheduler] Initialized: ${armed} tasks armed, ${tasks.length} total`);
}
