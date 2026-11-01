import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Sparkles } from "lucide-react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import TaskBar from "./TaskBar";
import SettingsPanel from "./SettingsPanel";
import CommandCenter from "../dashboard/CommandCenter";
import CalendarPage from "../calendar/CalendarPage";
import TasksPage from "../tasks/TasksPage";
import AnalysisPage from "../analysis/AnalysisPage";
import ToolsPage from "../tools/ToolsPage";
import JarvisPage from "../jarvis/JarvisPage";
import MemoryPage from "../jarvis/MemoryPage";
import PersonaSettings from "../jarvis/PersonaSettings";
import NotificationStack from "../jarvis/NotificationStack";
import VSmartAIPage from "../vsmartai/VSmartAIPage";
import { useVoice, setPreferredGender } from "../../voice/useVoice";
import { useAppStore } from "../../../store/appStore";
import { useConversationStore } from "../../../store/conversationStore";
import type { ReplyLang } from "../../../llm/openrouter";
import "./layout.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Page =
  | "dashboard" | "agents" | "tasks" | "calendar"
  | "jarvis" | "memory" | "settings"
  | "vsmartchat" | "tools";

// Legacy types kept for CommandCenter / ChatPanel / ChatWidget compatibility.
export interface Message {
  sender: "You" | "VSmart";
  text: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

interface SidebarItem {
  page: Page;
  label: string;
  enabled: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_KEY = "sidebar_settings";

const DEFAULT_SIDEBAR: SidebarItem[] = [
  { page: "dashboard",  label: "Home",         enabled: true },
  { page: "jarvis",     label: "VSmart AI",    enabled: true },
  { page: "vsmartchat", label: "VSmart Chat",  enabled: true },
  { page: "agents",     label: "Apps",         enabled: true },
  { page: "tasks",      label: "Files",        enabled: true },
  { page: "memory",     label: "Memory",       enabled: true },
  { page: "tools",      label: "Terminal",     enabled: true },
  { page: "settings",   label: "AI Settings",  enabled: true },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MainLayout() {
  const [activePage,    setActivePage]    = useState<Page>("jarvis");
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [sidebarEnabled,  setSidebarEnabled]  = useState(true);
  const [sidebarItems,    setSidebarItems]    = useState<SidebarItem[]>(DEFAULT_SIDEBAR);
  // Floating VSmart AI popup (pill button in bottom-right)
  const [jarvisPopup,   setJarvisPopup]   = useState(false);

  // ── Global stores ──────────────────────────────────────────────────────────
  const { persona, setAssistantState, addNotification } = useAppStore();
  const { replyLang, setReplyLang } = useConversationStore();

  // Sync voice gender from persona
  useEffect(() => {
    setPreferredGender(persona.speakingGender);
  }, [persona.speakingGender]);

  // ── Sidebar settings persistence ──────────────────────────────────────────
  useEffect(() => {
    window.vsmart.getMemory(SIDEBAR_KEY).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        setSidebarEnabled(saved.enabled ?? true);
        const byPage: Record<string, SidebarItem> = {};
        (saved.items ?? []).forEach((it: SidebarItem) => { byPage[it.page] = it; });
        setSidebarItems(DEFAULT_SIDEBAR.map(d => ({ ...d, enabled: byPage[d.page]?.enabled ?? d.enabled })));
      } catch { /* use defaults */ }
    }).catch(() => {});
  }, []);

  const updateSidebarSettings = async (enabled: boolean, items: SidebarItem[]) => {
    setSidebarEnabled(enabled);
    setSidebarItems(items);
    await window.vsmart.saveMemory(SIDEBAR_KEY, JSON.stringify({ enabled, items })).catch(() => {});
  };

  // ── Listen for scheduler task-fired events ────────────────────────────────
  useEffect(() => {
    if (!window.vsmart?.scheduler?.onTaskFired) return;
    const unsub = window.vsmart.scheduler.onTaskFired((task) => {
      addNotification({
        type:      "info",
        title:     `Reminder: ${task.title}`,
        message:   task.description || task.command,
        autoClose: 8000,
      });
    });
    return unsub;
  }, [addNotification]);

  // ── Voice hook ────────────────────────────────────────────────────────────
  // The voice hook lives here so mic state is available globally (Sidebar mic
  // button, TaskBar etc.).  The actual command handler is swappable via a ref —
  // JarvisPage registers its own sendMessage when it mounts, so voice commands
  // always land in the active JarvisPage regardless of which page is visible.
  const [wakeWordEnabled, setWakeWordEnabled] = useState(
    () => localStorage.getItem("vsmart_wakeword") === "true"
  );

  // JarvisPage writes its sendMessage into this ref on every render.
  const voiceCommandHandlerRef = useRef<(text: string) => Promise<void>>(
    async (_text: string) => { /* no-op until JarvisPage registers */ }
  );

  const handleVoiceCommand = useCallback((text: string) => {
    void voiceCommandHandlerRef.current(text);
  }, []);

  const voice = useVoice({
    onCommand: handleVoiceCommand,
    lang: replyLang === "hi" ? "hi-IN" : "en-IN",
    wakeWordEnabled,
  });

  // Reflect voice state into assistant state
  useEffect(() => {
    if (voice.listening)         setAssistantState("LISTENING");
    else if (voice.transcribing) setAssistantState("THINKING", "Transcribing…");
  }, [voice.listening, voice.transcribing, setAssistantState]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNavigate = (page: Page) => {
    setActivePage(page);
  };

  const renderPage = () => {
    switch (activePage) {
      case "dashboard":  return (
        <CommandCenter
          messages={[]}
          voice={voice}
          onOpenChat={() => setActivePage("jarvis")}
        />
      );
      case "jarvis":      return <JarvisPage voice={voice} onRegisterVoiceHandler={voiceCommandHandlerRef} />;
      case "vsmartchat":  return <VSmartAIPage />;
      case "agents":      return <AnalysisPage />;
      case "tasks":       return <TasksPage />;
      case "calendar":    return <CalendarPage />;
      case "memory":      return <MemoryPage />;
      case "settings":    return <PersonaSettings />;
      case "tools":       return <ToolsPage />;
      default:            return <JarvisPage voice={voice} onRegisterVoiceHandler={voiceCommandHandlerRef} />;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <div className="layout-row">
        <Sidebar
          activePage={activePage}
          onNavigate={handleNavigate}
          voice={voice}
          sidebarEnabled={sidebarEnabled}
          sidebarItems={sidebarItems}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="main-content">
          <Topbar onOpenSettings={() => setSettingsOpen(true)} />
          <section className={`page-content${
            activePage === "jarvis" ? " page-jarvis" :
            activePage === "vsmartchat" ? " page-vsmartchat" : ""
          }`}>
            {renderPage()}
          </section>
        </main>
      </div>

      <TaskBar activePage={activePage} onNavigate={handleNavigate} voice={voice} />

      {/* ── VSmart AI floating pill (bottom-right, always visible) ────────── */}
      <div className="ask-vind-dock">
        <button
          className="ask-vind-pill"
          onClick={() => setJarvisPopup(v => !v)}
          title="VSmart AI"
        >
          <span className="ask-vind-icon-badge">
            <Sparkles size={15} />
          </span>
          <span>VSmart AI</span>
        </button>
        <button
          className={voice.listening ? "ask-vind-mic listening" : "ask-vind-mic"}
          onClick={voice.toggleListening}
          title={voice.listening ? "Stop listening" : `Talk to ${persona.name}`}
          aria-label={voice.listening ? "Stop listening" : `Talk to ${persona.name}`}
        >
          <span className="ask-vind-mic-ring" aria-hidden="true" />
          <span className="ask-vind-mic-core">
            {voice.listening ? <MicOff size={15} /> : <Mic size={15} />}
          </span>
        </button>
      </div>

      {/* ── VSmart AI floating popup ─────────────────────────────────────── */}
      {jarvisPopup && (
        <div className="jarvis-popup-overlay" onClick={() => setJarvisPopup(false)}>
          <div className="jarvis-popup-panel" onClick={e => e.stopPropagation()}>
            <JarvisPage
              voice={voice}
              onRegisterVoiceHandler={voiceCommandHandlerRef}
              popupMode
              onClosePopup={() => setJarvisPopup(false)}
            />
          </div>
        </div>
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        replyLang={replyLang}
        onLangChange={setReplyLang}
        wakeWordEnabled={wakeWordEnabled}
        onWakeWordChange={(v: boolean) => {
          localStorage.setItem("vsmart_wakeword", String(v));
          setWakeWordEnabled(v);
        }}
        sidebarEnabled={sidebarEnabled}
        sidebarItems={sidebarItems}
        onSidebarChange={updateSidebarSettings}
      />

      {/* Global notification stack */}
      <NotificationStack />
    </div>
  );
}
