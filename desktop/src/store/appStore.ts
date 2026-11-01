// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Global App Store (Zustand)
//
// Single source of truth for:
//   • AI assistant state (idle/listening/thinking/executing/speaking/error)
//   • Active persona configuration
//   • Notification queue
//   • Permission system
// ═══════════════════════════════════════════════════════════════════════════

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── AI Assistant States ───────────────────────────────────────────────────────
export type AssistantState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "PLANNING"
  | "EXECUTING"
  | "SPEAKING"
  | "COMPLETED"
  | "ERROR";

// ── Persona Configuration ────────────────────────────────────────────────────
export interface Persona {
  name: string;           // "VSmart AI" | "VSmart" | custom
  greeting: string;       // How the assistant introduces itself
  tone: "formal" | "casual" | "playful";
  language: "en" | "hi" | "hinglish";
  responseLength: "short" | "medium" | "detailed";
  humor: boolean;         // Allow light humor in responses
  speakingGender: "male" | "female";
  wakeWord: string;       // "Hey VSmart" | custom
}

// ── Notification ─────────────────────────────────────────────────────────────
export interface AppNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: number;
  autoClose?: number;    // ms before auto-dismiss (0 = manual)
  action?: {
    label: string;
    callback: string;    // serialized action name
  };
}

// ── Permission entry ─────────────────────────────────────────────────────────
export interface Permission {
  key: string;
  label: string;
  granted: boolean;
  requiresConfirmation: boolean;
}

// ── Store Interface ───────────────────────────────────────────────────────────
interface AppStore {
  // Assistant State
  assistantState:    AssistantState;
  statusMessage:     string;
  setAssistantState: (state: AssistantState, msg?: string) => void;

  // Persona
  persona:     Persona;
  setPersona:  (persona: Partial<Persona>) => void;

  // Notifications
  notifications:    AppNotification[];
  addNotification:  (n: Omit<AppNotification, "id" | "timestamp">) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  // Permissions
  permissions:     Permission[];
  grantPermission: (key: string) => void;
  revokePermission:(key: string) => void;
  hasPermission:   (key: string) => boolean;

  // UI preferences
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;

  // Sidebar
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
}

// ── Default persona ───────────────────────────────────────────────────────────
const DEFAULT_PERSONA: Persona = {
  name: "Iris",
  greeting: "Haan bolo, main sun rahi hoon.",
  tone: "casual",
  language: "hinglish",
  responseLength: "short",
  humor: true,
  speakingGender: "female",
  wakeWord: "Hey Iris",
};

// ── Default permissions ───────────────────────────────────────────────────────
const DEFAULT_PERMISSIONS: Permission[] = [
  { key: "microphone",       label: "Microphone",        granted: true,  requiresConfirmation: false },
  { key: "file_read",        label: "Read Files",         granted: true,  requiresConfirmation: false },
  { key: "file_write",       label: "Write Files",        granted: true,  requiresConfirmation: true  },
  { key: "browser_open",     label: "Open Browser",       granted: true,  requiresConfirmation: false },
  { key: "browser_automate", label: "Browser Automation", granted: true,  requiresConfirmation: true  },
  { key: "app_launch",       label: "Launch Apps",        granted: true,  requiresConfirmation: false },
  { key: "system_control",   label: "System Controls",    granted: true,  requiresConfirmation: false },
  { key: "restart_shutdown", label: "Restart / Shutdown", granted: false, requiresConfirmation: true  },
  { key: "clipboard",        label: "Clipboard Access",   granted: true,  requiresConfirmation: false },
  { key: "notifications",    label: "Notifications",      granted: true,  requiresConfirmation: false },
  { key: "web_search",       label: "Web Search",         granted: true,  requiresConfirmation: false },
  { key: "code_execute",     label: "Execute Code",       granted: false, requiresConfirmation: true  },
];

// ── Store ─────────────────────────────────────────────────────────────────────
export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // Assistant state
      assistantState:    "IDLE",
      statusMessage:     "",
      setAssistantState: (state, msg = "") =>
        set({ assistantState: state, statusMessage: msg }),

      // Persona
      persona: DEFAULT_PERSONA,
      setPersona: (partial) =>
        set(s => ({ persona: { ...s.persona, ...partial } })),

      // Notifications
      notifications: [],
      addNotification: (n) => {
        const notification: AppNotification = {
          ...n,
          id:        `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
        };
        set(s => ({ notifications: [notification, ...s.notifications].slice(0, 50) }));
        if (n.autoClose && n.autoClose > 0) {
          setTimeout(() => get().dismissNotification(notification.id), n.autoClose);
        }
      },
      dismissNotification: (id) =>
        set(s => ({ notifications: s.notifications.filter(n => n.id !== id) })),
      clearNotifications: () => set({ notifications: [] }),

      // Permissions
      permissions:     DEFAULT_PERMISSIONS,
      grantPermission: (key) =>
        set(s => ({
          permissions: s.permissions.map(p => p.key === key ? { ...p, granted: true } : p),
        })),
      revokePermission: (key) =>
        set(s => ({
          permissions: s.permissions.map(p => p.key === key ? { ...p, granted: false } : p),
        })),
      hasPermission: (key) =>
        get().permissions.find(p => p.key === key)?.granted ?? false,

      // Theme
      theme:    "dark",
      setTheme: (t) => set({ theme: t }),

      // Sidebar
      sidebarCollapsed:    false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    {
      name:    "vsmart-app-store",
      partialize: (s) => ({
        persona:          s.persona,
        permissions:      s.permissions,
        theme:            s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
);
