import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Mic } from "lucide-react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import TaskBar from "./TaskBar";
import SettingsPanel from "./SettingsPanel";
import CommandCenter from "../dashboard/CommandCenter";
import CalendarPage from "../calendar/CalendarPage";
import TasksPage from "../tasks/TasksPage";
import AnalysisPage from "../analysis/AnalysisPage";
import VSmartAIPage from "../vsmartai/VSmartAIPage";
import ToolsPage from "../tools/ToolsPage";
import ChatWidget from "../chat/ChatWidget";
import { askVoiceAgent } from "../../../core/aiEngine";
import { useVoice, speak, cancelSpeech } from "../../voice/useVoice";
import type { ReplyLang, ChatHistoryMessage } from "../../../llm/openrouter";
import "./layout.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Page = "dashboard" | "agents" | "tasks" | "calendar" | "memory" | "conversations" | "tools";

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

const CONVERSATIONS_KEY = "chat_conversations";
const SIDEBAR_KEY       = "sidebar_settings";
const MAX_HISTORY       = 10;

const DEFAULT_SIDEBAR: SidebarItem[] = [
  { page: "dashboard",  label: "Home",        enabled: true },
  { page: "agents",     label: "Apps",         enabled: true },
  { page: "tasks",      label: "Files",        enabled: true },
  { page: "memory",     label: "VSmart Chat",  enabled: true },
  { page: "tools",      label: "Terminal",     enabled: true },
];

function makeTitle(messages: Message[]): string {
  const first = messages.find(m => m.sender === "You");
  if (!first) return "New Chat";
  return first.text.length > 32 ? first.text.slice(0, 32) + "…" : first.text;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MainLayout() {
  const [activePage,          setActivePage]          = useState<Page>("dashboard");
  const [chatOpen,            setChatOpen]            = useState(false);
  const [chatMinimized,       setChatMinimized]       = useState(false);
  const [settingsOpen,        setSettingsOpen]        = useState(false);
  const [conversations,       setConversations]       = useState<Conversation[]>([]);
  const [activeConvId,        setActiveConvId]        = useState<string | null>(null);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [replyLang,           setReplyLang]           = useState<ReplyLang>("en");
  const [wakeWordEnabled,     setWakeWordEnabled]     = useState(
    () => localStorage.getItem("vsmart_wakeword") === "true"
  );
  const [historyTrigger,      setHistoryTrigger]      = useState(0);
  const [sidebarEnabled,      setSidebarEnabled]      = useState(true);
  const [sidebarItems,        setSidebarItems]        = useState<SidebarItem[]>(DEFAULT_SIDEBAR);

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
      } catch { /* corrupt — use defaults */ }
    }).catch(() => {});
  }, []);

  const updateSidebarSettings = async (enabled: boolean, items: SidebarItem[]) => {
    setSidebarEnabled(enabled);
    setSidebarItems(items);
    await window.vsmart.saveMemory(SIDEBAR_KEY, JSON.stringify({ enabled, items })).catch(() => {});
  };

  // ── Conversation persistence ───────────────────────────────────────────────
  useEffect(() => {
    window.vsmart.getMemory(CONVERSATIONS_KEY).then(raw => {
      if (raw) {
        try {
          const saved: Conversation[] = JSON.parse(raw);
          setConversations(saved);
          if (saved.length > 0) setActiveConvId(saved[0].id);
        } catch { /* corrupt */ }
      }
    }).catch(() => {}).finally(() => setConversationsLoaded(true));
  }, []);

  useEffect(() => {
    if (!conversationsLoaded) return;
    window.vsmart.saveMemory(CONVERSATIONS_KEY, JSON.stringify(conversations)).catch(() => {});
  }, [conversations, conversationsLoaded]);

  // ── Open chat on vsmart-open-chat event ───────────────────────────────────
  useEffect(() => {
    const open = () => { setChatOpen(true); setChatMinimized(false); };
    window.addEventListener("vsmart-open-chat", open);
    return () => window.removeEventListener("vsmart-open-chat", open);
  }, []);

  // ── Conversation helpers ───────────────────────────────────────────────────
  const activeConv  = conversations.find(c => c.id === activeConvId) ?? null;
  const messages    = activeConv?.messages ?? [];

  const newChat = () => {
    const conv: Conversation = { id: `${Date.now()}`, title: "New Chat", messages: [], updatedAt: Date.now() };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    setChatOpen(true);
    setChatMinimized(false);
  };

  const selectConversation = (id: string) => {
    setActiveConvId(id);
    setChatOpen(true);
    setChatMinimized(false);
  };

  const deleteConversation = (id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (activeConvId === id) setActiveConvId(next[0]?.id ?? null);
      return next;
    });
  };

  const deleteConversations = (ids: string[]) => {
    setConversations(prev => {
      const next = prev.filter(c => !ids.includes(c.id));
      if (activeConvId && ids.includes(activeConvId)) setActiveConvId(next[0]?.id ?? null);
      return next;
    });
  };

  // ── Voice command handler ─────────────────────────────────────────────────
  // This is the VOICE AGENT path — executes real system actions and speaks back.
  // VSmart Chat (VSmartAIPage) has its own separate path via askSmartChat().
  const sendCommand = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setChatOpen(true);
    setChatMinimized(false);

    let convId = activeConvId;
    if (!convId) {
      const conv: Conversation = { id: `${Date.now()}`, title: "New Chat", messages: [], updatedAt: Date.now() };
      setConversations(prev => [conv, ...prev]);
      convId = conv.id;
      setActiveConvId(convId);
    }

    // Append user message
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const msgs = [...c.messages, { sender: "You" as const, text }];
      return { ...c, messages: msgs, title: c.title === "New Chat" ? makeTitle(msgs) : c.title, updatedAt: Date.now() };
    }));

    const history: ChatHistoryMessage[] = (activeConv?.messages ?? [])
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.sender === "You" ? "user" as const : "assistant" as const, content: m.text }));

    const ttsLang = replyLang === "hi" ? "hi-IN" : "en-IN";

    const deliver = (reply: string) => {
      if (!reply.trim()) return;
      setConversations(prev => prev.map(c =>
        c.id === convId
          ? { ...c, messages: [...c.messages, { sender: "VSmart" as const, text: reply }], updatedAt: Date.now() }
          : c
      ));
      cancelSpeech();
      speak(reply, ttsLang);
    };

    try {
      const result = await askVoiceAgent(text, replyLang, history);
      deliver(result.message ?? "Done.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      deliver(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [activeConvId, activeConv, replyLang]);

  // ── Voice hook ────────────────────────────────────────────────────────────
  const voice = useVoice({
    onCommand: sendCommand,
    lang: replyLang === "hi" ? "hi-IN" : "en-IN",
    wakeWordEnabled,
  });

  // Auto-open chat when voice becomes active
  useEffect(() => {
    if (voice.listening || voice.transcribing) {
      setChatOpen(true);
      setChatMinimized(false);
    }
  }, [voice.listening, voice.transcribing]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNavigate = (page: Page) => {
    if (page === "conversations") {
      setChatOpen(true);
      setChatMinimized(false);
      setHistoryTrigger(t => t + 1);
      return;
    }
    setActivePage(page);
  };

  const renderPage = () => {
    switch (activePage) {
      case "dashboard":  return <CommandCenter messages={messages} voice={voice} onOpenChat={() => { setChatOpen(true); setChatMinimized(false); }} />;
      case "agents":     return <AnalysisPage />;
      case "tasks":      return <TasksPage />;
      case "calendar":   return <CalendarPage />;
      case "memory":     return <VSmartAIPage replyLang={replyLang} voice={voice} />;
      case "tools":      return <ToolsPage />;
      default:           return <CommandCenter messages={messages} voice={voice} onOpenChat={() => { setChatOpen(true); setChatMinimized(false); }} />;
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
          <section className="page-content">{renderPage()}</section>
        </main>
      </div>

      <TaskBar activePage={activePage} onNavigate={handleNavigate} voice={voice} />

      <ChatWidget
        open={chatOpen}
        minimized={chatMinimized}
        messages={messages}
        onSend={sendCommand}
        voice={voice}
        replyLang={replyLang}
        onLangChange={setReplyLang}
        onMinimizeToggle={() => setChatMinimized(p => !p)}
        onClose={() => setChatOpen(false)}
        conversations={conversations}
        activeConversationId={activeConvId}
        onNewChat={newChat}
        onSelectConversation={selectConversation}
        onDeleteConversation={deleteConversation}
        onDeleteConversations={deleteConversations}
        historyTrigger={historyTrigger}
      />

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

      {!chatOpen && (
        <div className="ask-vind-dock">
          <button className="ask-vind-pill" onClick={() => { setChatOpen(true); setChatMinimized(false); }} title="VSmart Voice AI">
            <span className="ask-vind-icon-badge"><MessageSquare size={15} /></span>
            <span>VSmart Voice AI</span>
          </button>
          <button
            className={voice.listening ? "ask-vind-mic listening" : "ask-vind-mic"}
            onClick={voice.toggleListening}
            title="Talk to VSmart"
          >
            <span className="ask-vind-mic-ring" aria-hidden="true" />
            <span className="ask-vind-mic-core"><Mic size={16} /></span>
          </button>
        </div>
      )}
    </div>
  );
}
