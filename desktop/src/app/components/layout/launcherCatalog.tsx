import {
  LayoutGrid,
  LineChart,
  ClipboardList,
  Calendar,
  MessageSquare,
  Wrench,
  Sparkles,
  Bot,
} from "lucide-react";
import type { Page } from "./MainLayout";

export interface LauncherCatalogEntry {
  page: Page;
  icon: React.ReactNode;
  label: string;
}

// Every internal page that CAN show in the V-logo "VSmart Apps" panel.
export const LAUNCHER_CATALOG: LauncherCatalogEntry[] = [
  { page: "dashboard",  icon: <LayoutGrid size={22} />,   label: "Command Center" },
  { page: "jarvis",     icon: <Bot size={22} />,           label: "VSmart AI"      },
  { page: "vsmartchat", icon: <Sparkles size={22} />,      label: "VSmart Chat"    },
  { page: "agents",     icon: <LineChart size={22} />,     label: "Analysis"       },
  { page: "tasks",      icon: <ClipboardList size={22} />, label: "Tasks"          },
  { page: "calendar",   icon: <Calendar size={22} />,      label: "Calendar"       },
  { page: "memory",     icon: <MessageSquare size={22} />, label: "Memory"         },
  { page: "tools",      icon: <Wrench size={22} />,        label: "Tools & Skills" },
];

// Command Center is the home page — always pinned, can't be removed.
export const HOME_PAGE: Page = "dashboard";

export const LAUNCHER_APPS_KEY = "launcher_apps_state";

export interface LauncherAppsState {
  added: string[];
  pinned: string[];
  customIcons: Record<string, string>;
}

export const DEFAULT_LAUNCHER_STATE: LauncherAppsState = {
  added:  LAUNCHER_CATALOG.map(a => a.page),
  pinned: [HOME_PAGE],
  customIcons: {},
};

export function parseLauncherState(raw: string | null | undefined): LauncherAppsState {
  if (!raw) return DEFAULT_LAUNCHER_STATE;
  try {
    const parsed = JSON.parse(raw);
    return {
      added:       Array.isArray(parsed.added)   ? parsed.added   : DEFAULT_LAUNCHER_STATE.added,
      pinned:      Array.isArray(parsed.pinned)  ? parsed.pinned  : DEFAULT_LAUNCHER_STATE.pinned,
      customIcons: parsed.customIcons && typeof parsed.customIcons === "object"
        ? parsed.customIcons
        : {},
    };
  } catch {
    return DEFAULT_LAUNCHER_STATE;
  }
}
