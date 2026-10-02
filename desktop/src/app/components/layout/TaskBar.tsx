import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  X,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Search,
  AppWindow,
  Eye,
  EyeOff,
  FolderOpen,
  Plus,
  List,
  HardDrive,
  Globe,
  Code2,
  Calculator,
  FileText,
  Music,
  Video,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  Terminal,
  Palette,
  FileType,
  Shield,
  Gamepad2,
  Camera,
  Settings as SettingsIcon,
  Folder as FolderIcon
} from "lucide-react";
import type { Page } from "./MainLayout";
import type { VoiceControls } from "../../voice/useVoice";
import {
  LAUNCHER_CATALOG,
  HOME_PAGE,
  LAUNCHER_APPS_KEY,
  DEFAULT_LAUNCHER_STATE,
  parseLauncherState,
  type LauncherAppsState,
  type LauncherCatalogEntry
} from "./launcherCatalog";
import "./TaskBar.css";

interface TaskBarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  voice: VoiceControls;
}

interface LibraryApp {
  name: string;
  id: string;
  icon: string;
  customIcon?: string;
  pinned: boolean;
}

interface WindowsAppLite {
  name: string;
  id: string;
  icon: string;
  path?: string;
}

const SYSTEM_BTN_ICON_KEY = "vsmart_system_btn_icon";
const LAUNCHER_PINS_HIDDEN_KEY = "vsmart_launcher_pins_hidden";
const SYSTEM_PINS_HIDDEN_KEY = "vsmart_system_pins_hidden";
const TASKBAR_AUTOHIDE_KEY = "vsmart_taskbar_autohide";
const TASKBAR_POSITION_KEY = "vsmart_taskbar_position";

type TaskbarPosition = "bottom" | "top" | "left" | "right";

function appIconFallback(name: string) {
  const n = (name || "").toLowerCase();

  if (
    n.includes("chrome") ||
    n.includes("edge") ||
    n.includes("firefox") ||
    n.includes("brave") ||
    n.includes("browser")
  )
    return <Globe size={20} />;
  if (n.includes("code") || n.includes("studio") || n.includes("cursor") || n.includes("sublime") || n.includes("atom") || n.includes("dev"))
    return <Code2 size={20} />;
  if (n.includes("calc"))
    return <Calculator size={20} />;
  if (n.includes("word") || n.includes("writer") || n.includes("notepad") || n.includes("note"))
    return <FileText size={20} />;
  if (n.includes("excel") || n.includes("sheet") || n.includes("calc"))
    return <FileType size={20} />;
  if (n.includes("spotify") || n.includes("music") || n.includes("audio") || n.includes("player"))
    return <Music size={20} />;
  if (n.includes("vlc") || n.includes("video") || n.includes("movie") || n.includes("film"))
    return <Video size={20} />;
  if (n.includes("photoshop") || n.includes("illustrator") || n.includes("figma") || n.includes("canva") || n.includes("paint") || n.includes("image") || n.includes("photo"))
    return <ImageIcon size={20} />;
  if (n.includes("mail") || n.includes("outlook") || n.includes("thunderbird"))
    return <Mail size={20} />;
  if (n.includes("whatsapp") || n.includes("telegram") || n.includes("discord") || n.includes("chat") || n.includes("messeng"))
    return <MessageCircle size={20} />;
  if (n.includes("terminal") || n.includes("cmd") || n.includes("powershell") || n.includes("bash"))
    return <Terminal size={20} />;
  if (n.includes("adobe") || n.includes("design") || n.includes("draw"))
    return <Palette size={20} />;
  if (n.includes("pdf") || n.includes("acrobat") || n.includes("reader"))
    return <FileType size={20} />;
  if (n.includes("vpn") || n.includes("antivirus") || n.includes("secure") || n.includes("defender") || n.includes("lock"))
    return <Shield size={20} />;
  if (n.includes("steam") || n.includes("game") || n.includes("epic") || n.includes("xbox"))
    return <Gamepad2 size={20} />;
  if (n.includes("camera") || n.includes("webcam") || n.includes("obs"))
    return <Camera size={20} />;
  if (n.includes("setting") || n.includes("control panel") || n.includes("config"))
    return <SettingsIcon size={20} />;
  if (n.includes("explorer") || n.includes("file") || n.includes("folder"))
    return <FolderIcon size={20} />;

  return <AppWindow size={20} />;
}

function appColorFromName(name: string) {
  const str = name || "app";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsla(${hue}, 85%, 60%, 0.16)`,
    border: `hsla(${hue}, 85%, 65%, 0.28)`,
    fg: `hsl(${hue}, 90%, 72%)`,
    glow: `hsla(${hue}, 90%, 60%, 0.35)`
  };
}

function AppIcon({ src, name, size = 28 }: { src?: string; name?: string; size?: number }) {
  if (!src) {
    const c = appColorFromName(name || "");
    return (
      <div
        className="app-icon-fallback"
        style={{
          width: size,
          height: size,
          background: c.bg,
          border: `1px solid ${c.border}`,
          color: c.fg,
          boxShadow: `0 0 12px ${c.glow}`
        }}
      >
        {appIconFallback(name || "")}
      </div>
    );
  }
  return (
    <img
      src={src}
      width={size}
      height={size}
      loading="lazy"
      className="system-app-icon"
      draggable={false}
    />
  );
}

function VLogo({ size = 20 }: { size?: number }) {
  return (
    <span
      className="taskbar-vlogo"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
    >
      V
    </span>
  );
}

export default function TaskBar({ activePage, onNavigate, voice }: TaskBarProps) {
  const [startOpen, setStartOpen] = useState(false);

  // Sidebar's "Apps" nav item opens this same VSmart Apps grid — the
  // V-logo trigger was removed from the taskbar since Apps now lives
  // in the sidebar, so this event is the only way the menu opens.
  useEffect(() => {
    const onOpenAppsMenu = () => setStartOpen(true);
    window.addEventListener("vsmart-open-apps-menu", onOpenAppsMenu);
    return () => window.removeEventListener("vsmart-open-apps-menu", onOpenAppsMenu);
  }, []);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryApps, setLibraryApps] = useState<LibraryApp[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [vlogoSearch, setVlogoSearch] = useState("");

  const [addAppsOpen, setAddAppsOpen] = useState(false);
  const [addingCustomApp, setAddingCustomApp] = useState(false);

  const [addSystemOpen, setAddSystemOpen] = useState(false);
  const [addSystemMode, setAddSystemMode] = useState<"menu" | "list">("menu");
  const [installedApps, setInstalledApps] = useState<WindowsAppLite[]>([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [addingFromListId, setAddingFromListId] = useState<string | null>(null);

  const [launcherState, setLauncherState] = useState<LauncherAppsState>(DEFAULT_LAUNCHER_STATE);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [launcherMenuFor, setLauncherMenuFor] = useState<Page | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const launcherMenuRef = useRef<HTMLDivElement | null>(null);

  const [draggedLauncherPage, setDraggedLauncherPage] = useState<Page | null>(null);
  const [draggedSystemAppId, setDraggedSystemAppId] = useState<string | null>(null);

  const [systemBtnIcon, setSystemBtnIcon] = useState<string | null>(null);
  const [vlogoBtnMenuOpen, setVlogoBtnMenuOpen] = useState(false);
  const [systemBtnMenuOpen, setSystemBtnMenuOpen] = useState(false);
  const vlogoBtnMenuRef = useRef<HTMLDivElement | null>(null);
  const systemBtnMenuRef = useRef<HTMLDivElement | null>(null);

  const [launcherPinsHidden, setLauncherPinsHidden] = useState(false);
  const [systemPinsHidden, setSystemPinsHidden] = useState(false);

  const [autoHide, setAutoHide] = useState(false);
  const [taskbarHidden, setTaskbarHidden] = useState(false);
  const [position, setPosition] = useState<TaskbarPosition>("bottom");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskbarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.body.setAttribute("data-taskbar-pos", position);
    return () => {
      document.body.removeAttribute("data-taskbar-pos");
    };
  }, [position]);

  useEffect(() => {
    const el = taskbarRef.current;
    if (!el) return;

    const applySize = () => {
      if (autoHide && taskbarHidden) {
        document.body.style.setProperty("--taskbar-size", "0px");
        return;
      }
      const size = position === "left" || position === "right"
        ? el.offsetWidth
        : el.offsetHeight;
      document.body.style.setProperty("--taskbar-size", `${size}px`);
    };

    applySize();

    const ro = new ResizeObserver(applySize);
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, [position, autoHide, taskbarHidden]);

  useEffect(() => {
    return () => {
      document.body.style.removeProperty("--taskbar-size");
    };
  }, []);

  useEffect(() => {
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (
        detail.position === "top" ||
        detail.position === "left" ||
        detail.position === "right" ||
        detail.position === "bottom"
      ) {
        setPosition(detail.position);
      }
      if (typeof detail.autoHide === "boolean") {
        setAutoHide(detail.autoHide);
      }
    };
    window.addEventListener("vsmart-taskbar-settings", onSettings);
    return () => window.removeEventListener("vsmart-taskbar-settings", onSettings);
  }, []);

  useEffect(() => {
    const unsubscribe = window.vsmart.onToggleStart(() => {
      setStartOpen((prev) => !prev);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setStartOpen(false);
      setLibraryOpen(false);
      setMenuFor(null);
      setLauncherMenuFor(null);
      setVlogoBtnMenuOpen(false);
      setSystemBtnMenuOpen(false);
      setAddAppsOpen(false);
      setAddSystemOpen(false);
      setAddSystemMode("menu");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setAddAppsOpen(false);
  }, [startOpen]);

  useEffect(() => {
    setAddSystemOpen(false);
    setAddSystemMode("menu");
  }, [libraryOpen]);

  const loadLauncherState = useCallback(() => {
    window.vsmart
      .getMemory(LAUNCHER_APPS_KEY)
      .then((raw) => setLauncherState(parseLauncherState(raw)))
      .catch(() => setLauncherState(DEFAULT_LAUNCHER_STATE));
  }, []);

  const persistLauncherState = useCallback((next: LauncherAppsState) => {
    setLauncherState(next);
    window.vsmart.saveMemory(LAUNCHER_APPS_KEY, JSON.stringify(next)).catch(() => {});
    // Pinned VSmart apps now live in the Sidebar (not the taskbar) — let it
    // know immediately so pin/unpin from this launcher shows up there
    // without needing a reload.
    window.dispatchEvent(new CustomEvent("vsmart-launcher-state", { detail: next }));
  }, []);

  useEffect(() => {
    loadLauncherState();
  }, [loadLauncherState]);

  useEffect(() => {
    if (startOpen) loadLauncherState();
  }, [startOpen, loadLauncherState]);

  useEffect(() => {
    window.vsmart
      .getMemory(SYSTEM_BTN_ICON_KEY)
      .then((raw) => setSystemBtnIcon(raw || null))
      .catch(() => setSystemBtnIcon(null));

    window.vsmart
      .getMemory(LAUNCHER_PINS_HIDDEN_KEY)
      .then((raw) => setLauncherPinsHidden(raw === "1" || raw === "true"))
      .catch(() => setLauncherPinsHidden(false));

    window.vsmart
      .getMemory(SYSTEM_PINS_HIDDEN_KEY)
      .then((raw) => setSystemPinsHidden(raw === "1" || raw === "true"))
      .catch(() => setSystemPinsHidden(false));

    window.vsmart
      .getMemory(TASKBAR_AUTOHIDE_KEY)
      .then((raw) => setAutoHide(raw === "1" || raw === "true"))
      .catch(() => setAutoHide(false));

    window.vsmart
      .getMemory(TASKBAR_POSITION_KEY)
      .then((raw) => {
        if (raw === "top" || raw === "left" || raw === "right" || raw === "bottom") {
          setPosition(raw);
        }
      })
      .catch(() => setPosition("bottom"));
  }, []);

  useEffect(() => {
    window.vsmart.launcher
      .getLibraryApps()
      .then(setLibraryApps)
      .catch(() => setLibraryApps([]));
  }, []);

  useEffect(() => {
    if (!libraryOpen) return;
    let cancelled = false;
    setLibraryLoading(true);
    window.vsmart.launcher
      .getLibraryApps()
      .then((apps) => {
        if (!cancelled) setLibraryApps(apps);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryOpen]);

  const loadInstalledApps = useCallback(() => {
    setInstalledLoading(true);
    window.vsmart
      .getInstalledApps()
      .then(setInstalledApps)
      .catch(() => setInstalledApps([]))
      .finally(() => setInstalledLoading(false));
  }, []);

  useEffect(() => {
    if (!menuFor && !launcherMenuFor && !vlogoBtnMenuOpen && !systemBtnMenuOpen) return;

    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
      if (launcherMenuRef.current && !launcherMenuRef.current.contains(e.target as Node))
        setLauncherMenuFor(null);
      if (vlogoBtnMenuRef.current && !vlogoBtnMenuRef.current.contains(e.target as Node))
        setVlogoBtnMenuOpen(false);
      if (systemBtnMenuRef.current && !systemBtnMenuRef.current.contains(e.target as Node))
        setSystemBtnMenuOpen(false);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor, launcherMenuFor, vlogoBtnMenuOpen, systemBtnMenuOpen]);

  const showTaskbar = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setTaskbarHidden(false);
  }, []);

  const scheduleHide = useCallback(() => {
    if (!autoHide) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (
        startOpen ||
        libraryOpen ||
        menuFor ||
        launcherMenuFor ||
        vlogoBtnMenuOpen ||
        systemBtnMenuOpen
      ) {
        return;
      }
      setTaskbarHidden(true);
    }, 1200);
  }, [
    autoHide,
    startOpen,
    libraryOpen,
    menuFor,
    launcherMenuFor,
    vlogoBtnMenuOpen,
    systemBtnMenuOpen
  ]);

  useEffect(() => {
    if (!autoHide) {
      setTaskbarHidden(false);
      return;
    }
    scheduleHide();
  }, [autoHide, scheduleHide]);

  useEffect(() => {
    const onFocus = () => {
      window.vsmart
        .getMemory(TASKBAR_AUTOHIDE_KEY)
        .then((raw) => setAutoHide(raw === "1" || raw === "true"))
        .catch(() => {});
      window.vsmart
        .getMemory(TASKBAR_POSITION_KEY)
        .then((raw) => {
          if (raw === "top" || raw === "left" || raw === "right" || raw === "bottom") {
            setPosition(raw);
          }
        })
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const launch = (page: Page) => {
    onNavigate(page);
    setStartOpen(false);
  };

  const addedLauncherApps = useMemo(
    () => LAUNCHER_CATALOG.filter((a) => launcherState.added.includes(a.page)),
    [launcherState.added]
  );

  const notAddedLauncherApps = useMemo(
    () => LAUNCHER_CATALOG.filter((a) => !launcherState.added.includes(a.page)),
    [launcherState.added]
  );

  const filteredVlogoApps = useMemo(() => {
    const q = vlogoSearch.trim().toLowerCase();
    if (!q) return addedLauncherApps;
    return addedLauncherApps.filter(
      (a) => a.label.toLowerCase().includes(q) || a.page.toLowerCase().includes(q)
    );
  }, [addedLauncherApps, vlogoSearch]);

  const pinnedLauncherApps = useMemo(
    () =>
      launcherState.pinned
        .filter((page) => page !== HOME_PAGE)
        .map((page) => addedLauncherApps.find((a) => a.page === page))
        .filter((a): a is LauncherCatalogEntry => Boolean(a)),
    [addedLauncherApps, launcherState.pinned]
  );

  const homeEntry = LAUNCHER_CATALOG.find((a) => a.page === HOME_PAGE)!;

  const pinnedTaskbarApps = useMemo(
    () => libraryApps.filter((a) => a.pinned),
    [libraryApps]
  );

  const filteredLibraryApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return libraryApps;
    return libraryApps.filter((a) => a.name.toLowerCase().includes(q));
  }, [libraryApps, search]);

  const notAddedSystemApps = useMemo(() => {
    const existingIds = new Set(libraryApps.map((a) => a.id));
    return installedApps.filter((a) => !existingIds.has(a.id));
  }, [installedApps, libraryApps]);

  const togglePin = useCallback((app: LibraryApp) => {
    window.vsmart.launcher
      .setPinned(app.id, !app.pinned)
      .then(setLibraryApps)
      .catch(() => {});
    setMenuFor(null);
  }, []);

  const addLauncherApp = useCallback(
    (page: Page) => {
      if (launcherState.added.includes(page)) return;
      persistLauncherState({ ...launcherState, added: [...launcherState.added, page] });
    },
    [launcherState, persistLauncherState]
  );

  const removeLauncherApp = useCallback(
    (page: Page) => {
      if (page === HOME_PAGE) return;
      persistLauncherState({
        ...launcherState,
        added: launcherState.added.filter((p) => p !== page),
        pinned: launcherState.pinned.filter((p) => p !== page)
      });
      setLauncherMenuFor(null);
    },
    [launcherState, persistLauncherState]
  );

  const handleAddCustomApp = useCallback(async () => {
    setAddingCustomApp(true);
    try {
      const updated = await window.vsmart.launcher.pickAndAddCustomApp();
      setLibraryApps(updated);
    } catch {
      /* ignore */
    } finally {
      setAddingCustomApp(false);
      setAddSystemOpen(false);
      setAddSystemMode("menu");
    }
  }, []);

  const handleAddFromList = useCallback(async (app: WindowsAppLite) => {
    setAddingFromListId(app.id);
    try {
      const updated = await window.vsmart.launcher.addLibraryApps([app]);
      setLibraryApps(updated);
    } catch {
      /* ignore */
    } finally {
      setAddingFromListId(null);
    }
  }, []);

  const handleRemoveLibraryApp = useCallback((id: string) => {
    window.vsmart.launcher
      .removeLibraryApp(id)
      .then(setLibraryApps)
      .catch(() => {});
    setMenuFor(null);
  }, []);

  const openAddSystemFromList = useCallback(() => {
    setAddSystemMode("list");
    loadInstalledApps();
  }, [loadInstalledApps]);

  const launchLibraryApp = useCallback((app: LibraryApp) => {
    if (app.id.startsWith("custom:")) {
      window.vsmart.launcher.launchPath(app.id.slice("custom:".length)).catch(() => {});
    } else {
      window.vsmart.launchSystemApp(app.id);
    }
  }, []);

  const reorderSystemPinned = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setLibraryApps((prev) => {
      const pinnedIds = prev.filter((a) => a.pinned).map((a) => a.id);
      const fromIndex = pinnedIds.indexOf(draggedId);
      const toIndex = pinnedIds.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const reorderedPinned = [...pinnedIds];
      reorderedPinned.splice(fromIndex, 1);
      reorderedPinned.splice(toIndex, 0, draggedId);

      const fullOrder = [
        ...reorderedPinned,
        ...prev.filter((a) => !a.pinned).map((a) => a.id)
      ];
      window.vsmart.launcher.reorderLibraryApps(fullOrder).then(setLibraryApps).catch(() => {});

      const byId = new Map(prev.map((a) => [a.id, a]));
      return fullOrder.map((id) => byId.get(id)!).filter(Boolean);
    });
  }, []);

  const handleEditIcon = useCallback((id: string) => {
    window.vsmart.launcher
      .pickIcon(id)
      .then(setLibraryApps)
      .catch(() => {});
    setMenuFor(null);
  }, []);

  const handleOpenFileLocation = useCallback((id: string) => {
    try {
      (window.vsmart.launcher as any).openFileLocation?.(id);
    } catch {
      /* no-op */
    }
    setMenuFor(null);
  }, []);

  const toggleLauncherPin = useCallback(
    (page: Page) => {
      const isPinned = launcherState.pinned.includes(page);
      const nextPinned = isPinned
        ? launcherState.pinned.filter((p) => p !== page)
        : [...launcherState.pinned, page];
      persistLauncherState({ ...launcherState, pinned: nextPinned });
      setLauncherMenuFor(null);
    },
    [launcherState, persistLauncherState]
  );

  const reorderLauncherPinned = useCallback(
    (draggedPage: Page, targetPage: Page) => {
      if (draggedPage === targetPage) return;
      const fromIndex = launcherState.pinned.indexOf(draggedPage);
      const toIndex = launcherState.pinned.indexOf(targetPage);
      if (fromIndex === -1 || toIndex === -1) return;
      const reordered = [...launcherState.pinned];
      reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, draggedPage);
      persistLauncherState({ ...launcherState, pinned: reordered });
    },
    [launcherState, persistLauncherState]
  );

  const editLauncherIcon = useCallback(
    (page: Page) => {
      window.vsmart.launcher
        .pickImage()
        .then((dataUrl) => {
          if (!dataUrl) return;
          persistLauncherState({
            ...launcherState,
            customIcons: { ...launcherState.customIcons, [page]: dataUrl }
          });
        })
        .catch(() => {});
      setLauncherMenuFor(null);
    },
    [launcherState, persistLauncherState]
  );

  const editSystemBtnIcon = useCallback(() => {
    window.vsmart.launcher
      .pickImage()
      .then((dataUrl) => {
        if (!dataUrl) return;
        setSystemBtnIcon(dataUrl);
        window.vsmart.saveMemory(SYSTEM_BTN_ICON_KEY, dataUrl).catch(() => {});
      })
      .catch(() => {});
    setSystemBtnMenuOpen(false);
  }, []);

  const toggleSystemPinsVisibility = useCallback(() => {
    setSystemPinsHidden((prev) => {
      const next = !prev;
      window.vsmart.saveMemory(SYSTEM_PINS_HIDDEN_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
    setSystemBtnMenuOpen(false);
  }, []);

  return (
    <>
      {startOpen && (
        <div className="taskbar-overlay apps-flyout" onClick={() => setStartOpen(false)}>
          <div className="start-menu apps-flyout-panel" onClick={(e) => e.stopPropagation()}>
            <div className="start-menu-header">
              <span>VSmart Apps</span>
              <button className="start-close" onClick={() => setStartOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="app-search-row">
              {addedLauncherApps.length > 4 && (
                <div className="app-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Search VSmart apps..."
                    value={vlogoSearch}
                    onChange={(e) => setVlogoSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
              <button
                type="button"
                className={addAppsOpen ? "app-add-btn active" : "app-add-btn"}
                onClick={() => setAddAppsOpen((v) => !v)}
                title="Add apps"
              >
                <Plus size={15} />
                <span>Add</span>
              </button>
            </div>

            {addAppsOpen && (
              <div className="add-apps-panel">
                {notAddedLauncherApps.length === 0 ? (
                  <div className="add-apps-empty">All VSmart apps are already added.</div>
                ) : (
                  notAddedLauncherApps.map((app) => (
                    <button
                      key={app.page}
                      type="button"
                      className="add-apps-row"
                      onClick={() => addLauncherApp(app.page)}
                    >
                      {app.icon}
                      <span>{app.label}</span>
                      <Plus size={13} className="add-apps-row-plus" />
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="start-grid">
              {filteredVlogoApps.map((app) => {
                const custom = launcherState.customIcons[app.page];
                const isHome = app.page === HOME_PAGE;
                const isPinned = launcherState.pinned.includes(app.page);
                return (
                  <div className="pinned-app-wrap library-tile-wrap" key={app.page}>
                    <button
                      className={
                        activePage === app.page
                          ? "start-tile active system-tile"
                          : "start-tile system-tile"
                      }
                      onClick={() => launch(app.page)}
                      onContextMenu={(e) => {
                        if (isHome) return;
                        e.preventDefault();
                        setLauncherMenuFor((prev) => (prev === app.page ? null : app.page));
                      }}
                    >
                      {custom ? <AppIcon src={custom} /> : app.icon}
                      <span>{app.label}</span>
                      {isPinned && !isHome && (
                        <span className="pinned-badge" title="Pinned to taskbar" />
                      )}
                    </button>

                    {launcherMenuFor === app.page && (
                      <div className="pinned-app-menu library-menu" ref={launcherMenuRef}>
                        <button onClick={() => toggleLauncherPin(app.page)}>
                          {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                          {isPinned ? "Unpin from taskbar" : "Pin to taskbar"}
                        </button>
                        <button onClick={() => editLauncherIcon(app.page)}>
                          <Pencil size={13} /> Edit icon
                        </button>
                        {!isHome && (
                          <button className="danger" onClick={() => removeLauncherApp(app.page)}>
                            <Trash2 size={13} /> Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {libraryOpen && (
        <div className="taskbar-overlay" onClick={() => setLibraryOpen(false)}>
          <div className="start-menu" onClick={(e) => e.stopPropagation()}>
            <div className="start-menu-header">
              <span>System Apps</span>
              <button className="start-close" onClick={() => setLibraryOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="app-search-row">
              {libraryApps.length > 0 && (
                <div className="app-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Search your apps..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              )}
              <button
                type="button"
                className={addSystemOpen ? "app-add-btn active" : "app-add-btn"}
                onClick={() => {
                  setAddSystemOpen((v) => !v);
                  setAddSystemMode("menu");
                }}
                title="Add apps"
              >
                <Plus size={15} />
                <span>Add</span>
              </button>
            </div>

            {addSystemOpen && addSystemMode === "menu" && (
              <div className="add-apps-panel add-apps-source-panel">
                <button type="button" className="add-apps-row" onClick={openAddSystemFromList}>
                  <List size={16} />
                  <span>From List</span>
                </button>
                <button
                  type="button"
                  className="add-apps-row"
                  onClick={handleAddCustomApp}
                  disabled={addingCustomApp}
                >
                  <HardDrive size={16} />
                  <span>{addingCustomApp ? "Adding..." : "From System"}</span>
                </button>
              </div>
            )}

            {addSystemOpen && addSystemMode === "list" && (
              <div className="add-apps-panel">
                <button
                  type="button"
                  className="add-apps-back"
                  onClick={() => setAddSystemMode("menu")}
                >
                  ← Back
                </button>
                {installedLoading ? (
                  <div className="add-apps-empty">Scanning installed apps...</div>
                ) : notAddedSystemApps.length === 0 ? (
                  <div className="add-apps-empty">
                    All detected apps are already added. Try "From System" for others.
                  </div>
                ) : (
                  notAddedSystemApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      className="add-apps-row"
                      onClick={() => handleAddFromList(app)}
                      disabled={addingFromListId === app.id}
                    >
                      <AppIcon src={app.icon} name={app.name} size={20} />
                      <span>{app.name}</span>
                      <Plus size={13} className="add-apps-row-plus" />
                    </button>
                  ))
                )}
              </div>
            )}

            {libraryLoading && libraryApps.length === 0 ? (
              <div className="apps-loading">Loading installed apps...</div>
            ) : libraryApps.length === 0 ? (
              <div className="apps-empty">No apps added yet. Tap "Add" to bring some in.</div>
            ) : (
              <div className="start-grid">
                {filteredLibraryApps.map((app) => (
                  <div className="pinned-app-wrap library-tile-wrap" key={app.id}>
                    <button
                      className="start-tile system-tile"
                      onClick={() => launchLibraryApp(app)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenuFor((prev) => (prev === app.id ? null : app.id));
                      }}
                      title={app.name}
                    >
                      <AppIcon src={app.customIcon || app.icon} name={app.name} />
                      <span>{app.name}</span>
                      {app.pinned && <span className="pinned-badge" title="Pinned to taskbar" />}
                    </button>

                    {menuFor === app.id && (
                      <div className="pinned-app-menu library-menu" ref={menuRef}>
                        <button onClick={() => togglePin(app)}>
                          {app.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                          {app.pinned ? "Unpin from taskbar" : "Pin to taskbar"}
                        </button>
                        <button onClick={() => handleEditIcon(app.id)}>
                          <Pencil size={13} /> Edit icon
                        </button>
                        <button onClick={() => handleOpenFileLocation(app.id)}>
                          <FolderOpen size={13} /> Open file location
                        </button>
                        <button className="danger" onClick={() => handleRemoveLibraryApp(app.id)}>
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {autoHide && taskbarHidden && (
        <div
          className={`taskbar-hotedge pos-${position}`}
          onMouseEnter={showTaskbar}
        />
      )}

      <footer
        ref={taskbarRef as any}
        className={[
          "taskbar",
          `pos-${position}`,
          autoHide && taskbarHidden ? "hidden" : "",
          voice.listening ? "mic-listening" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseEnter={showTaskbar}
        onMouseLeave={scheduleHide}
      >
        <div className="taskbar-dock">
          <button
            className={
              activePage === HOME_PAGE ? "taskbar-icon active pulse" : "taskbar-icon"
            }
            onClick={() => onNavigate(HOME_PAGE)}
            title={homeEntry.label}
          >
            {launcherState.customIcons[HOME_PAGE] ? (
              <AppIcon src={launcherState.customIcons[HOME_PAGE]} size={18} />
            ) : (
              <VLogo size={20} />
            )}
            {activePage === HOME_PAGE && <span className="running-dot" />}
          </button>

          {/* Internal app-page launcher icons removed from the taskbar —
              taskbar now shows system apps only. Page navigation lives
              in the Sidebar instead. Kept here (behind `false &&`) rather
              than deleted, in case this is brought back later. */}
          {/* eslint-disable-next-line no-constant-binary-expression */}
          {false &&
            !launcherPinsHidden &&
            pinnedLauncherApps.map((app) => (
              <div className="pinned-app-wrap" key={app.page}>
                <button
                  draggable
                  onDragStart={() => setDraggedLauncherPage(app.page)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedLauncherPage)
                      reorderLauncherPinned(draggedLauncherPage, app.page);
                    setDraggedLauncherPage(null);
                  }}
                  onDragEnd={() => setDraggedLauncherPage(null)}
                  className={
                    (activePage === app.page ? "taskbar-icon active pulse" : "taskbar-icon") +
                    (draggedLauncherPage === app.page ? " dragging" : "")
                  }
                  onClick={() => onNavigate(app.page)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setLauncherMenuFor((prev) => (prev === app.page ? null : app.page));
                  }}
                  title={app.label}
                >
                  {launcherState.customIcons[app.page] ? (
                    <AppIcon src={launcherState.customIcons[app.page]} size={18} />
                  ) : (
                    app.icon
                  )}
                  {activePage === app.page && <span className="running-dot" />}
                </button>

                {launcherMenuFor === app.page && (
                  <div className="pinned-app-menu" ref={launcherMenuRef}>
                    <button onClick={() => toggleLauncherPin(app.page)}>
                      <PinOff size={13} /> Unpin from taskbar
                    </button>
                    <button onClick={() => editLauncherIcon(app.page)}>
                      <Pencil size={13} /> Edit icon
                    </button>
                    <button className="danger" onClick={() => removeLauncherApp(app.page)}>
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                )}
              </div>
            ))}

          {/* "Apps" button — replaces the old separate System-apps (Monitor)
              button. All of that button's functionality (open the System
              Apps library, right-click to edit its icon / toggle pin
              visibility) now lives here, right after the V logo, so the
              whole dock reads as one centered row like the reference UI. */}
          <div className="pinned-app-wrap">
            <button
              className="taskbar-icon apps-btn"
              onClick={() => setLibraryOpen((prev) => !prev)}
              onContextMenu={(e) => {
                e.preventDefault();
                setSystemBtnMenuOpen((prev) => !prev);
              }}
              title="System Apps"
            >
              {systemBtnIcon ? (
                <AppIcon src={systemBtnIcon} size={20} />
              ) : (
                homeEntry.icon
              )}
            </button>

            {systemBtnMenuOpen && (
              <div className="pinned-app-menu" ref={systemBtnMenuRef}>
                <button onClick={editSystemBtnIcon}>
                  <Pencil size={13} /> Edit icon
                </button>
                <div
                  className="menu-toggle-row"
                  onClick={toggleSystemPinsVisibility}
                  title={systemPinsHidden ? "Pins are hidden" : "Pins are visible"}
                >
                  <span className="menu-toggle-label">
                    {systemPinsHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    {systemPinsHidden ? "Pins hidden" : "Pins visible"}
                  </span>
                  <div className={`toggle-switch ${systemPinsHidden ? "on" : ""}`} />
                </div>
              </div>
            )}
          </div>

          {!systemPinsHidden &&
            pinnedTaskbarApps.map((app) => (
              <div className="pinned-app-wrap" key={app.id}>
                <button
                  draggable
                  onDragStart={() => setDraggedSystemAppId(app.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedSystemAppId)
                      reorderSystemPinned(draggedSystemAppId, app.id);
                    setDraggedSystemAppId(null);
                  }}
                  onDragEnd={() => setDraggedSystemAppId(null)}
                  className={
                    "taskbar-icon pinned-app" +
                    (draggedSystemAppId === app.id ? " dragging" : "")
                  }
                  title={app.name}
                  onClick={() => launchLibraryApp(app)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuFor((prev) => (prev === app.id ? null : app.id));
                  }}
                >
                  <AppIcon src={app.customIcon || app.icon} name={app.name} size={22} />
                  <span className="running-dot" />
                </button>

                {menuFor === app.id && (
                  <div className="pinned-app-menu" ref={menuRef}>
                    <button onClick={() => togglePin(app)}>
                      <PinOff size={13} /> Unpin from taskbar
                    </button>
                    <button onClick={() => handleEditIcon(app.id)}>
                      <Pencil size={13} /> Edit icon
                    </button>
                    <button onClick={() => handleOpenFileLocation(app.id)}>
                      <FolderOpen size={13} /> Open file location
                    </button>
                    <button className="danger" onClick={() => handleRemoveLibraryApp(app.id)}>
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      </footer>
    </>
  );
}