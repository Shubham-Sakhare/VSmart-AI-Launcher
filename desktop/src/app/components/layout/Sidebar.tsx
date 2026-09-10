import { useEffect, useState } from "react";
import "./sidebar.css";
import {
  Home,
  Grid3x3,
  FolderClosed,
  Briefcase,
  TerminalSquare,
  Settings as SettingsIcon,
  PinOff,
  Plus
} from "lucide-react";
import type { Page } from "./MainLayout";
import type { VoiceControls } from "../../voice/useVoice";
import { useDesktopItems } from "../dashboard/useDesktopItems";
import { HubTile } from "../dashboard/HubTile";
import { loadCustomIcons, saveCustomIcons } from "../dashboard/customIcons";
import type { DesktopItem } from "../dashboard/desktopTypes";
import {
  LAUNCHER_CATALOG,
  HOME_PAGE,
  LAUNCHER_APPS_KEY,
  DEFAULT_LAUNCHER_STATE,
  parseLauncherState,
  type LauncherAppsState
} from "./launcherCatalog";

interface SidebarItem {
  page: Page;
  label: string;
  enabled: boolean;
}

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  voice: VoiceControls;
  sidebarEnabled: boolean;
  sidebarItems: SidebarItem[];
  onOpenSettings: () => void;
}

// Matches the reference UI exactly: Home / Apps / Files / Workspace /
// Terminal / Settings. Each is mapped onto the closest existing app page
// so the nav stays fully functional — only "Settings" opens the Settings
// panel directly instead of navigating.
const NAV_ITEMS: { page: Page; icon: React.ReactNode; label: string }[] = [
  { page: "dashboard", icon: <Home size={19} />, label: "Home" },
  { page: "agents", icon: <Grid3x3 size={19} />, label: "Apps" },
  { page: "tasks", icon: <FolderClosed size={19} />, label: "Files" },
  { page: "memory", icon: <Briefcase size={19} />, label: "Workspace" },
  { page: "tools", icon: <TerminalSquare size={19} />, label: "Terminal" }
];

export default function Sidebar({
  activePage,
  onNavigate,
  voice,
  sidebarEnabled,
  sidebarItems,
  onOpenSettings
}: SidebarProps) {
  void voice;
  const { places, loading: placesLoading } = useDesktopItems();
  const [customIcons, setCustomIcons] = useState<Record<string, string>>(() => loadCustomIcons());

  // Same pinned-apps state the Apps flyout writes to
  // (window.vsmart.saveMemory(LAUNCHER_APPS_KEY, ...)) — pinning an app
  // there now surfaces right here, inline in the main nav list (next to
  // Home / Apps / Files...), not as a separate section.
  const [launcherState, setLauncherState] = useState<LauncherAppsState>(DEFAULT_LAUNCHER_STATE);

  useEffect(() => {
    window.vsmart
      .getMemory(LAUNCHER_APPS_KEY)
      .then((raw) => setLauncherState(parseLauncherState(raw)))
      .catch(() => setLauncherState(DEFAULT_LAUNCHER_STATE));

    const onLauncherState = (e: Event) => {
      const detail = (e as CustomEvent<LauncherAppsState>).detail;
      if (detail) setLauncherState(detail);
    };
    window.addEventListener("vsmart-launcher-state", onLauncherState);
    return () => window.removeEventListener("vsmart-launcher-state", onLauncherState);
  }, []);

  const persistLauncherState = (next: LauncherAppsState) => {
    setLauncherState(next);
    window.vsmart.saveMemory(LAUNCHER_APPS_KEY, JSON.stringify(next)).catch(() => {});
    window.dispatchEvent(new CustomEvent("vsmart-launcher-state", { detail: next }));
  };

  const unpinApp = (page: Page) => {
    persistLauncherState({
      ...launcherState,
      pinned: launcherState.pinned.filter((p) => p !== page)
    });
  };

  // Home is always pinned by default — it already has its own nav item,
  // so it's excluded here to avoid a duplicate entry.
  const pinnedLauncherApps = LAUNCHER_CATALOG.filter(
    (a) => a.page !== HOME_PAGE && launcherState.pinned.includes(a.page)
  );

  if (!sidebarEnabled) {
    return null;
  }

  const visibleItems = NAV_ITEMS.filter(item =>
    sidebarItems.some(
      setting =>
        setting.page === item.page &&
        setting.enabled
    )
  );

  const openPlace = async (item: DesktopItem) => {
    try {
      await window.vsmart.system.openDesktopItem(item.path);
    } catch {
      /* ignore */
    }
  };

  const setIconFor = (path: string, dataUrl: string) => {
    setCustomIcons((prev) => {
      const next = { ...prev, [path]: dataUrl };
      saveCustomIcons(next);
      return next;
    });
  };

  const clearIconFor = (path: string) => {
    setCustomIcons((prev) => {
      const next = { ...prev };
      delete next[path];
      saveCustomIcons(next);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-circle">V</div>
        <div>
          <h2>VSmartOS</h2>
          <span>V-IND | Built for the Future</span>
        </div>
      </div>

      <nav className="menu">
        {visibleItems.map(item => (
          <button
            key={item.page}
            className={activePage === item.page ? "menu-item active" : "menu-item"}
            onClick={() => {
              // "Apps" doesn't navigate to a page directly — it opens the
              // same VSmart Apps grid that used to live behind the V-logo
              // in the taskbar. Picking an app inside that grid is what
              // actually navigates to its section.
              if (item.page === "agents") {
                window.dispatchEvent(new Event("vsmart-open-apps-menu"));
                return;
              }
              onNavigate(item.page);
            }}
          >
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {activePage === item.page && <span className="menu-item-active-dot" />}
          </button>
        ))}

        {/* Apps pinned from the Apps flyout land right here, inline with
            Home / Apps / Files / etc — not as a separate section below. */}
        {pinnedLauncherApps.map((app) => (
          <div className="menu-item-wrap" key={app.page}>
            <button
              className={activePage === app.page ? "menu-item active" : "menu-item"}
              onClick={() => onNavigate(app.page)}
            >
              <span className="menu-icon">
                {launcherState.customIcons[app.page] ? (
                  <img src={launcherState.customIcons[app.page]} alt="" />
                ) : (
                  app.icon
                )}
              </span>
              <span className="menu-label">{app.label}</span>
            </button>
            <button
              type="button"
              className="menu-item-unpin"
              title="Unpin"
              onClick={(e) => {
                e.stopPropagation();
                unpinApp(app.page);
              }}
            >
              <PinOff size={12} />
            </button>
          </div>
        ))}

        <button className="menu-item" onClick={onOpenSettings}>
          <span className="menu-icon"><SettingsIcon size={19} /></span>
          <span className="menu-label">Settings</span>
        </button>
      </nav>

      {places.length > 0 && (
        <div className="sb-places">
          <div className="sb-places-title">
            <span>Places</span>
            <span className="sb-places-title-line" />
            <button type="button" className="sb-places-add" title="Add place">
              <Plus size={11} />
            </button>
          </div>
          <div className="sb-places-list">
            {!placesLoading &&
              places.map((p) => (
                <HubTile
                  key={p.placeId || p.path}
                  item={p}
                  layout="place"
                  placesIconSize={20}
                  desktopTextSize={14}
                  desktopIconSize={20}
                  customIcon={customIcons[p.path]}
                  onOpen={() => openPlace(p)}
                  onIconChange={(url) => setIconFor(p.path, url)}
                  onIconClear={() => clearIconFor(p.path)}
                />
              ))}
          </div>
        </div>
      )}
    </aside>
  );
}