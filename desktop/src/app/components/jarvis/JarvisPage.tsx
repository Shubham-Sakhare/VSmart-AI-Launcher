// ═══════════════════════════════════════════════════════════════════════════
// VSmart AI — Main Chat Page
//
// The primary VSmart AI interface:
//   • AI orb showing current state
//   • Streaming chat with human-like Indian persona
//   • Voice input button (global — works from any page)
//   • Task progress sidebar
//   • Status bar showing model/provider
//
// Typed messages: the planner decides first. Actions (open app, files,
// screenshot, memory, coding...) go through the agent orchestrator; plain
// conversation keeps the streaming chat experience.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Mic, MicOff, Send, Cpu, Zap, Wifi, WifiOff, Trash2, Plus, X, RotateCcw, MessageSquare } from "lucide-react";
import JarvisOrb            from "./JarvisOrb";
import TaskProgressPanel    from "./TaskProgressPanel";
import MarkdownLite         from "../vsmartai/MarkdownLite";
import { useAppStore }      from "../../../store/appStore";
import { useConversationStore, type Message } from "../../../store/conversationStore";
import { useTaskStore }     from "../../../store/taskStore";
import { streamChat }       from "../../../llm/llmProvider";
import { getProviderStatus, detectProvider } from "../../../llm/llmProvider";
import { buildSystemPrompt, getThinkingFiller } from "../../../core/persona";
import { planner }          from "../../../ai/planner";
import { orchestrate }      from "../../../ai/orchestrator";
import { factExtractorAgent } from "../../../agents/factExtractorAgent";
import type { VoiceControls }  from "../../voice/useVoice";
import type { ApiMessage, ReplyLang } from "../../../llm/openrouter";
import "./JarvisPage.css";

interface JarvisPageProps {
  voice: VoiceControls;
  // Ref provided by MainLayout — JarvisPage writes its sendMessage into this
  // so voice commands transcribed anywhere in the app are handled here.
  onRegisterVoiceHandler?: MutableRefObject<(text: string) => Promise<void>>;
  // Kept for backward compatibility (not used internally).
  onCommand?: (text: string) => Promise<void>;
  // When true, renders in compact floating popup mode (no outer bg, close btn)
  popupMode?: boolean;
  onClosePopup?: () => void;
}

export default function JarvisPage({ voice, onRegisterVoiceHandler, popupMode, onClosePopup }: JarvisPageProps) {
  const { assistantState, setAssistantState, persona } = useAppStore();
  const {
    conversations, activeId, replyLang,
    loadConversations, newConversation, selectConversation, deleteConversation,
    clearAll,
    appendUserMessage, appendAssistantMsg, updateMessage, setMessageStreaming,
    getActiveConversation, getHistory,
  } = useConversationStore();
  const { tasks } = useTaskStore();

  const [input,         setInput]         = useState("");
  const [showHistory,   setShowHistory]   = useState(false);
  const [providerLabel, setProviderLabel] = useState("Loading…");
  const [isLocal,       setIsLocal]       = useState(false);
  const [showTasks,     setShowTasks]     = useState(false);
  const [confirmClear,  setConfirmClear]  = useState(false);

  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const genToken   = useRef(0);

  const activeConv    = getActiveConversation();
  const messages      = activeConv?.messages ?? [];
  const hasActiveTasks= tasks.length > 0;

  // ── Load conversations on mount ───────────────────────────────────────────
  useEffect(() => {
    void loadConversations();
  }, []);

  // ── Check provider on mount ───────────────────────────────────────────────
  useEffect(() => {
    detectProvider().then(() => {
      const ps = getProviderStatus();
      setProviderLabel(ps.isLocal ? `Ollama · ${ps.chatModel}` : `OpenRouter · ${ps.chatModel.split("/").pop() ?? ps.chatModel}`);
      setIsLocal(ps.isLocal);
    });
  }, []);

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Reflect voice state into assistant state ──────────────────────────────
  useEffect(() => {
    if (voice.listening)    setAssistantState("LISTENING");
    else if (voice.transcribing) setAssistantState("THINKING", "Transcribing…");
  }, [voice.listening, voice.transcribing]);

  // ── Send a typed message ──────────────────────────────────────────────────
  // 1) planner decides what the user wants
  // 2) action  -> orchestrator (agents), reply appended in one go
  // 3) chat    -> streaming reply with persona
  const sendMessage = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setInput("");

    // Ensure active conversation
    let convId = activeId;
    if (!convId) {
      const conv = newConversation("chat");
      convId = conv.id;
    }

    // History BEFORE this message (so the current message isn't duplicated)
    const priorHistory = getHistory(convId, 12).map(h => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    }));

    appendUserMessage(convId, t);

    const myToken = ++genToken.current;
    setAssistantState("THINKING");

    // ── 1) What does the user want? ──────────────────────────────────────
    let intent = "chat";
    try {
      intent = (await planner(t, priorHistory)).intent;
    } catch { /* planner failed -> treat as chat */ }

    if (myToken !== genToken.current) return;

    // ── 2) Action -> agent path ──────────────────────────────────────────
    if (intent !== "chat") {
      setAssistantState("THINKING", "Working on it…");
      try {
        const result = await orchestrate(t, replyLang as ReplyLang, priorHistory);
        if (myToken !== genToken.current) return;

        appendAssistantMsg(convId, result.message || "Done.", "text");
        setAssistantState(result.success ? "COMPLETED" : "ERROR");
      } catch (e) {
        if (myToken !== genToken.current) return;
        const errMsg = e instanceof Error ? e.message : "Something went wrong.";
        appendAssistantMsg(convId, `Error: ${errMsg}`, "text");
        setAssistantState("ERROR", errMsg);
      }
      setTimeout(() => setAssistantState("IDLE"), 2000);
      return;
    }

    // ── 3) Chat -> streaming path ────────────────────────────────────────
    const msgId = appendAssistantMsg(convId, "", "text");
    setMessageStreaming(convId, msgId, true);

    let accumulated = "";
    const memFacts = await getMemoryFacts(t);
    const sysPrompt = buildSystemPrompt(persona, replyLang, memFacts);

    const msgs: ApiMessage[] = [
      { role: "system", content: sysPrompt },
      ...priorHistory,
      { role: "user", content: t },
    ];

    try {
      await streamChat(msgs, (_delta, acc) => {
        if (myToken !== genToken.current) return;
        accumulated = acc;
        setAssistantState("SPEAKING", "Responding…");
        updateMessage(convId!, msgId, accumulated);
      });

      if (myToken !== genToken.current) return;

      setMessageStreaming(convId, msgId, false);
      setAssistantState("COMPLETED");
      setTimeout(() => setAssistantState("IDLE"), 2000);

      // Learn facts about the user in the background (LLM-based extractor)
      void factExtractorAgent(t, accumulated, replyLang as ReplyLang);

    } catch (e) {
      if (myToken !== genToken.current) return;
      const errMsg = e instanceof Error ? e.message : "Something went wrong.";
      updateMessage(convId!, msgId, `Error: ${errMsg}`);
      setMessageStreaming(convId, msgId, false);
      setAssistantState("ERROR", errMsg);
      setTimeout(() => setAssistantState("IDLE"), 3000);
    }
  }, [activeId, replyLang, persona]);

  // ── Register sendMessage as the global voice command handler ─────────────
  // MainLayout passes a ref — we write our sendMessage into it so voice
  // transcriptions (from useVoice in MainLayout) always route here.
  useEffect(() => {
    if (onRegisterVoiceHandler) {
      onRegisterVoiceHandler.current = sendMessage;
    }
  }, [onRegisterVoiceHandler, sendMessage]);

  // ── Handle textarea keyboard ──────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // ── Stop generation ───────────────────────────────────────────────────────
  const stopGeneration = () => {
    genToken.current++;
    setAssistantState("IDLE");
  };

  // ── File attach ───────────────────────────────────────────────────────────
  const attachFile = () => {
    const el = document.createElement("input");
    el.type   = "file";
    el.accept = ".txt,.pdf,.docx,.md,.csv,.json,.xlsx";
    el.onchange = (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = (reader.result as string).slice(0, 6000);
        setInput(prev => `${prev}\n\n[Attached: ${file.name}]\n${content}`);
      };
      reader.readAsText(file);
    };
    el.click();
  };

  const isGenerating = assistantState === "THINKING" || assistantState === "SPEAKING";

  return (
    <div className={`jarvis-page${popupMode ? " popup-mode" : ""}`}>

      {/* ── Sidebar: conversation history ─────────────────────────── */}
      <div className={`jarvis-sidebar ${showHistory ? "open" : ""}`}>

        {/* Header row */}
        <div className="jarvis-sidebar-header">
          <button
            className="jarvis-new-chat-btn"
            onClick={() => { newConversation("chat"); setShowHistory(false); }}
          >
            <Plus size={13} /> New Chat
          </button>
          <button
            className="jarvis-sidebar-close"
            onClick={() => setShowHistory(false)}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Conversation list */}
        <div className="jarvis-conv-list">
          {conversations.length === 0 && (
            <div className="jarvis-conv-empty">
              <MessageSquare size={28} />
              <p>No conversations yet</p>
              <span>Start a new chat above</span>
            </div>
          )}
          {conversations.map(c => (
            <div
              key={c.id}
              className={`jarvis-conv-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => { selectConversation(c.id); setShowHistory(false); }}
            >
              <div className="jarvis-conv-item-body">
                <span className="jarvis-conv-title">{c.title}</span>
                <span className="jarvis-conv-time">
                  {new Date(c.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </span>
              </div>
              <button
                className="jarvis-conv-delete"
                onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                aria-label="Delete conversation"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>

        {/* Footer: clear all */}
        {conversations.length > 0 && (
          <div className="jarvis-sidebar-footer">
            {confirmClear ? (
              <div className="jarvis-clear-confirm">
                <span>Delete all {conversations.length} chats?</span>
                <div className="jarvis-clear-confirm-btns">
                  <button
                    className="jarvis-clear-yes"
                    onClick={() => { clearAll(); setConfirmClear(false); }}
                  >
                    Yes, delete
                  </button>
                  <button
                    className="jarvis-clear-no"
                    onClick={() => setConfirmClear(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="jarvis-clear-all-btn"
                onClick={() => setConfirmClear(true)}
              >
                <RotateCcw size={12} />
                Clear all history
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="jarvis-main" onClick={() => setShowHistory(false)}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="jarvis-header">
          <button
            className="jarvis-history-toggle"
            onClick={(e) => { e.stopPropagation(); setShowHistory(v => !v); }}
            title="Conversation history"
          >
            ☰
          </button>

          {/* Orb */}
          <JarvisOrb
            state={assistantState}
            micLevel={voice.micLevel}
            size={64}
          />

          <div className="jarvis-header-info">
            <span className="jarvis-name">{persona.name}</span>
            <span className={`jarvis-provider ${isLocal ? "local" : "cloud"}`}>
              {isLocal ? <Wifi size={10} /> : <WifiOff size={10} />}
              {providerLabel}
            </span>
          </div>

          {/* Task panel toggle */}
          {hasActiveTasks && (
            <button
              className={`jarvis-tasks-toggle ${showTasks ? "active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setShowTasks(v => !v); }}
              title="Task progress"
            >
              <Cpu size={14} />
              <span className="tasks-badge">{tasks.length}</span>
            </button>
          )}

          {/* Close button — only in popup mode */}
          {popupMode && onClosePopup && (
            <button
              className="jarvis-popup-close"
              onClick={onClosePopup}
              title="Close"
              aria-label="Close VSmart AI"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Task progress panel (overlay) ──────────────────────────── */}
        {showTasks && (
          <div className="jarvis-task-overlay" onClick={(e) => e.stopPropagation()}>
            <TaskProgressPanel />
          </div>
        )}

        {/* ── Messages ───────────────────────────────────────────────── */}
        <div className="jarvis-messages">
          {messages.length === 0 && (
            <div className="jarvis-welcome">
              <div className="jarvis-welcome-orb">
                <JarvisOrb state="IDLE" size={100} />
              </div>
              <h2 className="jarvis-welcome-title">{persona.name}</h2>
              <p className="jarvis-welcome-sub">{persona.greeting}</p>
              <div className="jarvis-suggestions">
                {getSuggestions(persona.language, replyLang).map((s, i) => (
                  <button
                    key={i}
                    className="jarvis-suggestion-chip"
                    onClick={() => void sendMessage(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} personaName={persona.name} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* ── Status bar ─────────────────────────────────────────────── */}
        {voice.errorMsg && (
          <div className="jarvis-status-bar error">{voice.errorMsg}</div>
        )}
        {voice.interimText && !voice.errorMsg && (
          <div className="jarvis-status-bar listening">
            <span className="status-dot" />
            {voice.interimText}
          </div>
        )}
        {assistantState === "THINKING" && !voice.interimText && (
          <div className="jarvis-status-bar thinking">
            <span className="status-spinner" />
            {getThinkingFiller(persona, replyLang)}
          </div>
        )}

        {/* ── Input ──────────────────────────────────────────────────── */}
        <div className="jarvis-input-area">
          <div className="jarvis-input-row">
            <textarea
              ref={inputRef}
              className="jarvis-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${persona.name}… (Enter to send, Shift+Enter for newline)`}
              rows={1}
              disabled={isGenerating}
              aria-label={`Message ${persona.name}`}
            />

            {/* Attach file */}
            <button
              className="jarvis-input-btn attach"
              onClick={attachFile}
              title="Attach file (TXT, PDF, DOCX, MD)"
              aria-label="Attach file"
            >
              📎
            </button>

            {/* Mic / Stop */}
            {isGenerating ? (
              <button
                className="jarvis-input-btn stop"
                onClick={stopGeneration}
                title="Stop generation"
                aria-label="Stop"
              >
                <span className="stop-square" />
              </button>
            ) : (
              <button
                className={`jarvis-input-btn mic ${voice.listening ? "listening" : ""}`}
                onClick={voice.toggleListening}
                title={voice.listening ? "Stop listening" : `Talk to ${persona.name}`}
                aria-label={voice.listening ? "Stop listening" : "Start listening"}
              >
                {voice.listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}

            {/* Send */}
            <button
              className="jarvis-input-btn send"
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || isGenerating}
              title="Send message"
              aria-label="Send"
            >
              {isGenerating ? <Zap size={16} /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message bubble component ──────────────────────────────────────────────────
function MessageBubble({ msg, personaName }: { msg: Message; personaName: string }) {
  const isUser = msg.sender === "user";

  const copyText = () => {
    try {
      const el = document.createElement("textarea");
      el.value = msg.text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    } catch { /* fallback */ }
  };

  return (
    <div className={`jarvis-msg ${isUser ? "user-msg" : "ai-msg"} ${msg.streaming ? "streaming" : ""}`}>
      <div className="msg-avatar">
        {isUser ? "You" : personaName.slice(0, 1)}
      </div>
      <div className="msg-content">
        {isUser ? (
          <p className="msg-text">{msg.text}</p>
        ) : (
          <MarkdownLite text={msg.text || (msg.streaming ? "…" : "")} />
        )}
        {msg.streaming && <span className="msg-cursor" />}
        {!isUser && !msg.streaming && msg.text && (
          <button className="msg-copy" onClick={copyText} title="Copy" aria-label="Copy message">
            📋
          </button>
        )}
        <span className="msg-time">
          {new Date(msg.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

// ── Memory context for prompts ────────────────────────────────────────────────
async function getMemoryFacts(query: string): Promise<string> {
  try {
    const facts = await window.vsmart.longMemory.searchFacts(query, 5);
    if (!facts?.length) return "";
    return facts.map(f => `• ${f.key}: ${f.value}`).join("\n");
  } catch { return ""; }
}

// ── Welcome suggestions by language ──────────────────────────────────────────
function getSuggestions(lang: string, replyLang: string): string[] {
  const hi = lang === "hi" || replyLang === "hi";
  if (hi) return [
    "Chrome kholo",
    "Screenshot lo",
    "Volume thoda badha do",
    "Mera naam yaad rakh",
    "Aaj ka weather kya hai?",
    "VS Code kholo aur project dekho",
  ];
  return [
    "Open Chrome",
    "Take a screenshot",
    "Turn volume up a bit",
    "Remember my name",
    "What's the weather today?",
    "Open VS Code and check my project",
  ];
}