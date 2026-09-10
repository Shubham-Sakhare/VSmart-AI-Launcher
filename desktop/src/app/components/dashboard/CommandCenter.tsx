import "./CommandCenter.css";
import { useEffect, useMemo, useState } from "react";
import type { Message } from "../layout/MainLayout";
import type { VoiceControls } from "../../voice/useVoice";
import DetailDrawer from "./DetailDrawer";
import { loadProfile, type UserProfile } from "../layout/ProfilePanel";

import {
  Wifi, Bluetooth, Volume2, Monitor, Moon, Lock, Sun,
  Music2, SkipBack, SkipForward, Pause, Play,
  ChevronLeft, ChevronRight, Plus, Sparkles, Code2, Palette,
  Cpu, HardDrive, LayoutGrid, ShoppingBag,
  Search, ArrowDownAZ, Clock, X, ZoomIn, RefreshCw, Rows3, Grid3x3
} from "lucide-react";

import type { DesktopItem } from "./desktopTypes";
import { useDesktopItems } from "./useDesktopItems";
import { HubTile } from "./HubTile";
import { loadCustomIcons, saveCustomIcons } from "./customIcons";
import { type HubSettings, loadHubSettings, saveHubSettings, reconcileHubSettingsFromMemory } from "./hubSettings";

interface CommandCenterProps {
  messages: Message[];
  voice: VoiceControls;
  isThinking?: boolean;
  isSpeaking?: boolean;
  onOpenChat?: () => void;
}

/** "Good Morning" / "Good Afternoon" / "Good Evening" / "Good Night" */
function timeGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 21) return "Good Evening";
  return "Good Night";
}

type SortMode = "name" | "recent";
type ItemCategory = "Folders" | "Apps" | "Files";

const APP_EXTENSIONS = new Set(["exe", "app", "msi", "lnk", "bat", "sh", "appimage"]);
// How many tiles show inline before the flat grid collapses into a
// "+N More" tile that opens the full list in a drawer.
const GRID_PREVIEW_LIMIT = 8;

// Best-effort classification: prefers an explicit item.type field when the
// DesktopItem shape provides one, otherwise falls back to guessing from
// the file extension in the name.
function classifyItem(item: DesktopItem): ItemCategory {
  if (item.type === "folder") return "Folders";
  if (item.type === "app" || item.type === "shortcut") return "Apps";

  const name = item.name || item.path || "";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex === -1) return "Folders"; // no extension → treat as folder
  const ext = name.slice(dotIndex + 1).toLowerCase();
  if (APP_EXTENSIONS.has(ext)) return "Apps";
  return "Files";
}

function groupByCategory(items: DesktopItem[]): Array<[ItemCategory, DesktopItem[]]> {
  const order: ItemCategory[] = ["Folders", "Apps", "Files"];
  const buckets: Record<ItemCategory, DesktopItem[]> = { Folders: [], Apps: [], Files: [] };
  items.forEach((item) => buckets[classifyItem(item)].push(item));
  return order.filter((cat) => buckets[cat].length > 0).map((cat) => [cat, buckets[cat]]);
}

export default function CommandCenter({ voice, onOpenChat }: CommandCenterProps) {
  const {
    items: desktopItems,
    loading: desktopLoading,
    error: desktopError,
    refresh: refreshDesktop
  } = useDesktopItems();

  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());
  const [customIcons, setCustomIcons] = useState<Record<string, string>>(() => loadCustomIcons());
  const [hubSettings, setHubSettings] = useState<HubSettings>(() => loadHubSettings());
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [showZoomSlider, setShowZoomSlider] = useState(false);
  const [now, setNow] = useState(new Date());
  const [darkMode, setDarkMode] = useState(true);
  const [wifiOn, setWifiOn] = useState(true);
  const [btOn, setBtOn] = useState(true);
  const [brightness, setBrightness] = useState(70);
  const [volume] = useState(60);
  const [playing, setPlaying] = useState(true);
  const [workspaceIndex, setWorkspaceIndex] = useState(0);

  const [drawer, setDrawer] = useState<{ open: boolean; title: string; content: React.ReactNode }>({
    open: false,
    title: "",
    content: null
  });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<UserProfile>).detail;
      setProfile(detail || loadProfile());
    };
    window.addEventListener("vsmart-profile-updated", onUpdate);
    return () => window.removeEventListener("vsmart-profile-updated", onUpdate);
  }, []);

  const openItem = async (item: DesktopItem) => {
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

  const handleRefresh = async () => {
    await refreshDesktop();
    setRefreshedAt(new Date());
  };

  // Live icon-size slider — updates hub settings immediately (tiles resize
  // as you drag) and persists to disk + broadcasts the change so any other
  // place reading hubSettings stays in sync.
  const updateIconSize = (size: number) => {
    setHubSettings((prev) => {
      const next = { ...prev, desktopIconSize: size };
      saveHubSettings(next);
      window.dispatchEvent(new CustomEvent("vsmart-hub-settings", { detail: next }));
      return next;
    });
  };

  const toggleLayout = () => {
    setHubSettings((prev) => {
      const next: HubSettings = { ...prev, appsLayout: prev.appsLayout === "list" ? "grid" : "list" };
      saveHubSettings(next);
      window.dispatchEvent(new CustomEvent("vsmart-hub-settings", { detail: next }));
      return next;
    });
  };

  useEffect(() => {
    const onHubSettings = (e: Event) => {
      const detail = (e as CustomEvent<HubSettings>).detail;
      if (detail) setHubSettings(detail);
      else setHubSettings(loadHubSettings());
    };
    window.addEventListener("vsmart-hub-settings", onHubSettings);
    return () => window.removeEventListener("vsmart-hub-settings", onHubSettings);
  }, []);

  // One-time reconciliation with the durable SQLite-backed store — picks
  // up changes made from another window/session since the localStorage
  // cache was last written.
  useEffect(() => {
    let cancelled = false;
    reconcileHubSettingsFromMemory(hubSettings).then((next) => {
      if (!cancelled && next) {
        setHubSettings(next);
        window.dispatchEvent(new CustomEvent("vsmart-hub-settings", { detail: next }));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateStr = now.toLocaleDateString([], {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const secondsAngle = (now.getSeconds() / 60) * 360;
  const minutesAngle = ((now.getMinutes() + now.getSeconds() / 60) / 60) * 360;
  const hoursAngle = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * 360;

  const displayName = profile.name?.trim() || "Operator";

  const allDesktopItems = useMemo(() => {
    let list = desktopItems;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((item) => item.displayName.toLowerCase().includes(q));
    }

    if (sortMode === "name") {
      list = [...list].sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else {
      list = [...list].sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
    }

    return list;
  }, [desktopItems, query, sortMode]);

  const groupedItems = useMemo(
    () => (hubSettings.appsLayout === "list" ? groupByCategory(allDesktopItems) : null),
    [allDesktopItems, hubSettings.appsLayout]
  );

  const renderTile = (item: DesktopItem) => (
    <HubTile
      key={item.path}
      item={item}
      layout="desktop"
      placesIconSize={40}
      desktopTextSize={hubSettings.desktopTextSize}
      desktopIconSize={hubSettings.desktopIconSize}
      customIcon={customIcons[item.path]}
      onOpen={() => openItem(item)}
      onIconChange={(url) => setIconFor(item.path, url)}
      onIconClear={() => clearIconFor(item.path)}
    />
  );

  const workspaces = [
    { key: "ai", icon: <Sparkles size={18} />, title: "AI Assistant", subtitle: "Active", accent: "ws-purple", onClick: onOpenChat },
    { key: "code", icon: <Code2 size={18} />, title: "Code", subtitle: "VS Code Project", accent: "ws-blue", onClick: undefined as (() => void) | undefined },
    { key: "design", icon: <Palette size={18} />, title: "Design", subtitle: "Figma Project", accent: "ws-orange", onClick: undefined as (() => void) | undefined }
  ];
  void workspaceIndex;

  const notifications = [
    { key: "vstore", icon: <ShoppingBag size={15} />, title: "V-Store", body: "2 apps updated successfully", time: "5m ago", accent: "notif-blue" },
    { key: "system", icon: <HardDrive size={15} />, title: "System", body: "Backup completed", time: "25m ago", accent: "notif-green" },
    { key: "workspace", icon: <LayoutGrid size={15} />, title: "Workspace", body: "AI Assistant is ready", time: "1h ago", accent: "notif-purple" }
  ];

  return (
    <div className="vhome">
      <div className="vhome-main">
        {/* Hero row: greeting + clock */}
        <div className="vhome-hero glass-panel">
          <div className="vhome-hero-left">
            <div className="vhome-logo">
              <Sparkles size={26} />
            </div>
            <div>
              <h1>
                {timeGreeting(now.getHours())}, <span className="accent-text">{displayName}</span>
              </h1>
              <p>Focus. Create. Innovate.</p>
            </div>
          </div>

          <div className="vhome-hero-right">
            <div className="vhome-clock-ring">
              <div className="clock-hand hand-hour" style={{ transform: `rotate(${hoursAngle}deg)` }} />
              <div className="clock-hand hand-min" style={{ transform: `rotate(${minutesAngle}deg)` }} />
              <div className="clock-hand hand-sec" style={{ transform: `rotate(${secondsAngle}deg)` }} />
              <div className="clock-center" />
            </div>
            <div className="vhome-clock-text">
              <span className="clock-date">{dateStr}</span>
              <span className="clock-time">{timeStr}</span>
              <span className="clock-tz">V-IND Time Zone</span>
            </div>
          </div>
        </div>

        {/* System Overview + Desktop */}
        <div className="vhome-row-two">
          <div className="vcard glass-panel">
            <div className="vcard-header">
              <span className="vicon-badge badge-cyan"><Cpu size={15} /></span>
              <h3>System Overview</h3>
            </div>

            <div className="sysoverview-body sysoverview-body-orb-only">
              <div className="sysoverview-orb">
                <div
                  className={voice.listening ? "net-orb net-orb-active" : "net-orb"}
                  onClick={voice.toggleListening}
                  role="button"
                  tabIndex={0}
                  title="Talk to V-IND AI"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      voice.toggleListening();
                    }
                  }}
                >
                  <span className="net-ring r1" />
                  <span className="net-ring r2" />
                  <span className="net-ring r3" />
                  <span className="net-dot d1" />
                  <span className="net-dot d2" />
                  <span className="net-dot d3" />
                  <span className="net-dot d4" />
                  <span className="net-core"><Sparkles size={22} /></span>
                </div>
              </div>
            </div>

            <div className="sysoverview-footer">
              <span className="status-dot" /> Performance is stable
            </div>
          </div>

          <div className="vcard glass-panel">
            <div className="vcard-header">
              <span className="vicon-badge badge-purple"><Monitor size={15} /></span>
              <h3>Desktop</h3>

              {desktopItems.length > 0 && (
                <span className="hub-item-count">{allDesktopItems.length}</span>
              )}

              {desktopItems.length > 0 && (
                <div className="hub-zoom-wrap">
                  <button
                    type="button"
                    className={`hub-sort-btn ${showZoomSlider ? "active" : ""}`}
                    title="Icon size"
                    onClick={() => setShowZoomSlider((v) => !v)}
                  >
                    <ZoomIn size={13} />
                  </button>
                  {showZoomSlider && (
                    <div className="hub-zoom-popover">
                      <input
                        type="range"
                        min={32}
                        max={64}
                        step={2}
                        value={hubSettings.desktopIconSize}
                        onChange={(e) => updateIconSize(Number(e.target.value))}
                      />
                      <span className="hub-zoom-value">{hubSettings.desktopIconSize}px</span>
                    </div>
                  )}
                </div>
              )}

              {desktopItems.length > 0 && (
                <button
                  type="button"
                  className={`hub-sort-btn ${hubSettings.appsLayout === "list" ? "active" : ""}`}
                  title={hubSettings.appsLayout === "list" ? "List view — click for grid" : "Grid view — click for list"}
                  onClick={toggleLayout}
                >
                  {hubSettings.appsLayout === "list" ? <Rows3 size={13} /> : <Grid3x3 size={13} />}
                </button>
              )}

              {desktopItems.length > 0 && (
                <button
                  type="button"
                  className={`hub-sort-btn ${sortMode === "name" ? "active" : ""}`}
                  title={sortMode === "name" ? "Sorted A–Z — click for recent" : "Sorted by recent — click for A–Z"}
                  onClick={() => setSortMode((m) => (m === "name" ? "recent" : "name"))}
                >
                  {sortMode === "name" ? <ArrowDownAZ size={13} /> : <Clock size={13} />}
                </button>
              )}

              <button
                type="button"
                className="desktop-refresh-btn"
                title="Refresh"
                onClick={handleRefresh}
                disabled={desktopLoading}
              >
                <RefreshCw size={13} className={desktopLoading ? "spin" : ""} />
              </button>
            </div>

            {desktopItems.length > 0 && (
              <div className="hub-search-row">
                <Search size={13} className="hub-search-icon" />
                <input
                  type="text"
                  className="hub-search-input"
                  placeholder="Search desktop..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button type="button" className="hub-search-clear" title="Clear search" onClick={() => setQuery("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {refreshedAt && (
              <div className="hub-refreshed-at">
                refreshed {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}

            {desktopLoading && desktopItems.length === 0 ? (
              <div className="desktop-quick-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="quick-tile-skeleton" />
                ))}
              </div>
            ) : desktopError && desktopItems.length === 0 ? (
              <div className="desktop-quick-grid">
                <div className="quick-empty">
                  Could not read Desktop
                  <button type="button" onClick={handleRefresh}>Retry</button>
                </div>
              </div>
            ) : desktopItems.length === 0 ? (
              <div className="desktop-quick-grid">
                <div className="quick-empty">
                  Desktop is empty
                  <button type="button" onClick={handleRefresh}>Refresh</button>
                </div>
              </div>
            ) : allDesktopItems.length === 0 ? (
              <div className="desktop-quick-grid">
                <div className="quick-empty">No items match "{query}"</div>
              </div>
            ) : groupedItems ? (
              // ---- List view: grouped by Folders / Apps / Files ----
              <div className="hub-grouped-scroll">
                {groupedItems.map(([category, items]) => (
                  <div key={category} className="hub-category-group">
                    <div className="hub-category-title">
                      {category} <span className="hub-category-count">{items.length}</span>
                    </div>
                    <div className="desktop-quick-grid desktop-quick-grid-list">
                      {items.map(renderTile)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // ---- Grid view: flat, with "+N More" ----
              <div className="desktop-quick-grid">
                {allDesktopItems.slice(0, GRID_PREVIEW_LIMIT).map(renderTile)}

                {allDesktopItems.length > GRID_PREVIEW_LIMIT && (
                  <button
                    type="button"
                    className="icon-tile tile-more"
                    onClick={() =>
                      setDrawer({
                        open: true,
                        title: "Desktop",
                        content: (
                          <div className="desktop-quick-grid drawer-desktop-grid">
                            {allDesktopItems.map(renderTile)}
                          </div>
                        )
                      })
                    }
                  >
                    <span className="tile-icon">+{allDesktopItems.length - GRID_PREVIEW_LIMIT}</span>
                    <span className="tile-name">More</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Workspace */}
        <div className="vcard glass-panel workspace-card">
          <div className="vcard-header">
            <span className="vicon-badge badge-orange"><LayoutGrid size={15} /></span>
            <h3>Workspace</h3>
            <div className="workspace-nav">
              <button type="button" onClick={() => setWorkspaceIndex((i) => Math.max(0, i - 1))}>
                <ChevronLeft size={15} />
              </button>
              <button type="button" onClick={() => setWorkspaceIndex((i) => Math.min(workspaces.length - 1, i + 1))}>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          <div className="workspace-strip">
            {workspaces.map((w) => (
              <button
                key={w.key}
                type="button"
                className={`workspace-tile ${w.accent}`}
                onClick={w.onClick}
              >
                <span className="workspace-icon">{w.icon}</span>
                <span className="workspace-text">
                  <strong>{w.title}</strong>
                  <small>{w.subtitle}</small>
                </span>
              </button>
            ))}
            <button type="button" className="workspace-tile workspace-new">
              <Plus size={18} />
              <span className="workspace-text">
                <strong>New Workspace</strong>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Right column */}
      <div className="vhome-side">
        <div className="vcard glass-panel control-center-card">
          <div className="vcard-header">
            <h3>Control Center</h3>
          </div>

          <div className="cc-toggle-grid">
            <button type="button" className={`cc-toggle ${wifiOn ? "on" : ""}`} onClick={() => setWifiOn((v) => !v)}>
              <Wifi size={18} />
              <span>Wi-Fi</span>
              <small>{wifiOn ? "V-IND_5G" : "Off"}</small>
            </button>
            <button type="button" className={`cc-toggle ${btOn ? "on" : ""}`} onClick={() => setBtOn((v) => !v)}>
              <Bluetooth size={18} />
              <span>Bluetooth</span>
              <small>{btOn ? "On" : "Off"}</small>
            </button>
            <button type="button" className="cc-toggle on">
              <Volume2 size={18} />
              <span>Sound</span>
              <small>{volume}%</small>
            </button>
            <button type="button" className="cc-toggle on">
              <Monitor size={18} />
              <span>Display</span>
            </button>
            <button type="button" className={`cc-toggle ${darkMode ? "on" : ""}`} onClick={() => setDarkMode((v) => !v)}>
              <Moon size={18} />
              <span>Dark Mode</span>
            </button>
            <button type="button" className="cc-toggle">
              <Lock size={18} />
              <span>Lock</span>
            </button>
          </div>

          <div className="cc-slider-row">
            <Sun size={13} />
            <input
              type="range"
              min={0}
              max={100}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
            />
            <Sun size={17} />
          </div>
        </div>

        <div className="vcard glass-panel now-playing-card">
          <div className="vcard-header">
            <h3>Now Playing</h3>
            <Music2 size={14} className="np-note-icon" />
          </div>

          <div className="np-body">
            <div className="np-art">
              <Music2 size={20} />
            </div>
            <div className="np-info">
              <strong>Horizon</strong>
              <small>V-IND Soundscape</small>
            </div>
          </div>

          <div className="np-controls">
            <button type="button"><SkipBack size={16} /></button>
            <button type="button" className="np-play" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button type="button"><SkipForward size={16} /></button>
          </div>

          <div className="np-bars">
            {Array.from({ length: 28 }).map((_, i) => (
              <span key={i} className={playing ? "np-bar animate" : "np-bar"} style={{ animationDelay: `${(i % 7) * 0.09}s` }} />
            ))}
          </div>
        </div>

        <div className="vcard glass-panel notifications-card">
          <div className="vcard-header">
            <h3>Notifications</h3>
            <button type="button" className="notif-clear">Clear All</button>
          </div>

          <div className="notif-list">
            {notifications.map((n) => (
              <div key={n.key} className="notif-item">
                <span className={`notif-icon ${n.accent}`}>{n.icon}</span>
                <div className="notif-text">
                  <strong>{n.title}</strong>
                  <small>{n.body}</small>
                </div>
                <div className="notif-right">
                  <span className="notif-time">{n.time}</span>
                  <span className="notif-dot" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <DetailDrawer open={drawer.open} title={drawer.title} onClose={() => setDrawer((d) => ({ ...d, open: false }))}>
        {drawer.content}
      </DetailDrawer>

      {voice.listening && <span className="vhome-mic-flag" aria-hidden="true" />}
    </div>
  );
}