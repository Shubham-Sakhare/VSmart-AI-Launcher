// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Task Store (Zustand)
//
// Manages multi-step task execution state:
//   • Task queue and history
//   • Step tracking with status per step
//   • Running tool status
//   • Progress notifications
// ═══════════════════════════════════════════════════════════════════════════

import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "waiting_confirmation";

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_confirmation";

export interface TaskStep {
  id:          string;
  description: string;
  tool?:       string;
  args?:       Record<string, unknown>;
  status:      StepStatus;
  result?:     string;
  error?:      string;
  startedAt?:  number;
  completedAt?:number;
}

export interface Task {
  id:             string;
  title:          string;
  description:    string;
  steps:          TaskStep[];
  status:         TaskStatus;
  currentStepIdx: number;
  createdAt:      number;
  updatedAt:      number;
  completedAt?:   number;
  result?:        string;
  error?:         string;
  cancelFn?:      () => void;   // Not persisted, set at runtime
}

// ── Store ─────────────────────────────────────────────────────────────────────
interface TaskStoreState {
  tasks:         Task[];
  activeTaskId:  string | null;
  historyTasks:  Task[];       // Completed/failed tasks (last 50)

  // Task lifecycle
  createTask:     (title: string, description: string, steps: Omit<TaskStep, "id" | "status">[]) => Task;
  startTask:      (taskId: string, cancelFn?: () => void) => void;
  cancelTask:     (taskId: string) => void;
  completeTask:   (taskId: string, result?: string) => void;
  failTask:       (taskId: string, error: string) => void;

  // Step management
  startStep:      (taskId: string, stepIdx: number) => void;
  completeStep:   (taskId: string, stepIdx: number, result: string) => void;
  failStep:       (taskId: string, stepIdx: number, error: string) => void;
  skipStep:       (taskId: string, stepIdx: number) => void;
  waitConfirmStep:(taskId: string, stepIdx: number) => void;

  // Selectors
  getActiveTask:  () => Task | null;
  getTask:        (id: string) => Task | null;
  getRunningTool: () => string | null;
}

function stepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

function taskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useTaskStore = create<TaskStoreState>()((set, get) => ({
  tasks:        [],
  activeTaskId: null,
  historyTasks: [],

  // ── Create ──────────────────────────────────────────────────────────────
  createTask: (title, description, rawSteps) => {
    const steps: TaskStep[] = rawSteps.map(s => ({
      ...s,
      id:     stepId(),
      status: "pending",
    }));
    const task: Task = {
      id:             taskId(),
      title,
      description,
      steps,
      status:         "queued",
      currentStepIdx: 0,
      createdAt:      Date.now(),
      updatedAt:      Date.now(),
    };
    set(s => ({ tasks: [task, ...s.tasks], activeTaskId: task.id }));
    return task;
  },

  // ── Start ───────────────────────────────────────────────────────────────
  startTask: (taskId, cancelFn) => {
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          status:    "running",
          cancelFn,
          updatedAt: Date.now(),
        }
      ),
      activeTaskId: taskId,
    }));
  },

  // ── Cancel ──────────────────────────────────────────────────────────────
  cancelTask: (taskId) => {
    const task = get().tasks.find(t => t.id === taskId);
    task?.cancelFn?.();
    set(s => {
      const updated = s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          status:    "cancelled" as TaskStatus,
          updatedAt: Date.now(),
          steps:     t.steps.map(st =>
            st.status === "pending" || st.status === "running"
              ? { ...st, status: "skipped" as StepStatus }
              : st
          ),
        }
      );
      const done  = updated.find(t => t.id === taskId)!;
      const rest  = updated.filter(t => t.id !== taskId);
      return {
        tasks:        rest,
        historyTasks: [done, ...s.historyTasks].slice(0, 50),
        activeTaskId: rest.find(t => t.status === "running")?.id ?? null,
      };
    });
  },

  // ── Complete ────────────────────────────────────────────────────────────
  completeTask: (taskId, result) => {
    set(s => {
      const updated = s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          status:      "completed" as TaskStatus,
          result,
          updatedAt:   Date.now(),
          completedAt: Date.now(),
        }
      );
      const done  = updated.find(t => t.id === taskId)!;
      const rest  = updated.filter(t => t.id !== taskId);
      return {
        tasks:        rest,
        historyTasks: [done, ...s.historyTasks].slice(0, 50),
        activeTaskId: rest.find(t => t.status === "running")?.id ?? null,
      };
    });
  },

  // ── Fail ────────────────────────────────────────────────────────────────
  failTask: (taskId, error) => {
    set(s => {
      const updated = s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          status:    "failed" as TaskStatus,
          error,
          updatedAt: Date.now(),
        }
      );
      const done  = updated.find(t => t.id === taskId)!;
      const rest  = updated.filter(t => t.id !== taskId);
      return {
        tasks:        rest,
        historyTasks: [done, ...s.historyTasks].slice(0, 50),
        activeTaskId: rest.find(t => t.status === "running")?.id ?? null,
      };
    });
  },

  // ── Step: start ─────────────────────────────────────────────────────────
  startStep: (taskId, stepIdx) => {
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          currentStepIdx: stepIdx,
          updatedAt:      Date.now(),
          steps: t.steps.map((st, i) =>
            i === stepIdx ? { ...st, status: "running" as StepStatus, startedAt: Date.now() } : st
          ),
        }
      ),
    }));
  },

  // ── Step: complete ──────────────────────────────────────────────────────
  completeStep: (taskId, stepIdx, result) => {
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          updatedAt: Date.now(),
          steps: t.steps.map((st, i) =>
            i === stepIdx
              ? { ...st, status: "completed" as StepStatus, result, completedAt: Date.now() }
              : st
          ),
        }
      ),
    }));
  },

  // ── Step: fail ──────────────────────────────────────────────────────────
  failStep: (taskId, stepIdx, error) => {
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          updatedAt: Date.now(),
          steps: t.steps.map((st, i) =>
            i === stepIdx
              ? { ...st, status: "failed" as StepStatus, error, completedAt: Date.now() }
              : st
          ),
        }
      ),
    }));
  },

  // ── Step: skip ──────────────────────────────────────────────────────────
  skipStep: (taskId, stepIdx) => {
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          steps: t.steps.map((st, i) =>
            i === stepIdx ? { ...st, status: "skipped" as StepStatus } : st
          ),
        }
      ),
    }));
  },

  // ── Step: wait confirmation ─────────────────────────────────────────────
  waitConfirmStep: (taskId, stepIdx) => {
    set(s => ({
      tasks: s.tasks.map(t =>
        t.id !== taskId ? t : {
          ...t,
          status: "waiting_confirmation" as TaskStatus,
          steps: t.steps.map((st, i) =>
            i === stepIdx ? { ...st, status: "waiting_confirmation" as StepStatus } : st
          ),
        }
      ),
    }));
  },

  // ── Selectors ───────────────────────────────────────────────────────────
  getActiveTask: () => {
    const { tasks, activeTaskId } = get();
    return tasks.find(t => t.id === activeTaskId) ?? null;
  },

  getTask: (id) => get().tasks.find(t => t.id === id) ?? null,

  getRunningTool: () => {
    const { tasks, activeTaskId } = get();
    const task = tasks.find(t => t.id === activeTaskId);
    if (!task) return null;
    const runningStep = task.steps.find(s => s.status === "running");
    return runningStep?.tool ?? null;
  },
}));
