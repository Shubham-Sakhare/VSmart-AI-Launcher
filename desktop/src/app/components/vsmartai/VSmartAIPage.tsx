import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Sparkles, Send, Paperclip, ImageIcon, Lightbulb, ListChecks,
  Plus, Trash2, MessageSquare, X, Copy, Check, Pencil, Maximize2,
  Square, RotateCcw, ChevronDown, ChevronUp
} from "lucide-react";
import { askVSmart } from "../../../core/aiEngine";
import type { ReplyLang, ChatHistoryMessage } from "../../../llm/openrouter";
import { renderLiteMarkdown } from "./MarkdownLite";
import "./VSmartAIPage.css";

interface ChatMessage {
  id: string;
  sender: "You" | "VSmart";
  text: string;
  ts: number;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_KEY = "vsai_sessions";

// AI replies longer than this get a "expand" button that opens the side panel.
const LONG_RESULT_THRESHOLD = 600;

// AI replies longer than this (in chars) are collapsed inline in the bubble
// itself (full markdown still renders — we just clamp the height) with a
// "Show more" toggle, instead of butchering the text mid-word/mid-markdown.
const INLINE_COLLAPSE_THRESHOLD = 900;

const QUICK_ACTIONS = [
  { label: "Create Image", icon: <ImageIcon size={14} />, prompt: "Describe how I could create an image of " },
  { label: "Brainstorm", icon: <Lightbulb size={14} />, prompt: "Help me brainstorm ideas for " },
  { label: "Make a plan", icon: <ListChecks size={14} />, prompt: "Help me make a plan for " }
];

// Robust clipboard copy — Electron renderers sometimes run without a
// "secure context" (no https), which makes navigator.clipboard undefined
// or reject silently. Fall back to a hidden textarea + execCommand so
// copy always works regardless of that.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error("clipboard api unavailable");
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function VSmartAIPage({ replyLang = "en" }: { replyLang?: ReplyLang }) {

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // edit & resend
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  // side panel for long AI results
  const [panelMsg, setPanelMsg] = useState<ChatMessage | null>(null);
  const [panelCopied, setPanelCopied] = useState(false);

  // inline "Show more / Show less" state per long AI bubble
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Bumped every time the user hits Stop — send() checks this after the
  // await resolves and, if it changed, discards the (still-completing)
  // response instead of writing it into the session. There's no abort
  // support in askAI today, so this can't cancel the network call itself,
  // but it stops a stale/unwanted reply from appearing after Stop is hit.
  const genTokenRef = useRef(0);

  // Load saved sessions once.
  useEffect(() => {
    (async () => {
      try {
        const raw = await window.vsmart.getMemory(STORAGE_KEY);
        if (raw) setSessions(JSON.parse(raw));
      } catch {
        // no history yet
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist sessions whenever they change.
  useEffect(() => {
    if (!loaded) return;
    window.vsmart.saveMemory(STORAGE_KEY, JSON.stringify(sessions)).catch(() => {});
  }, [sessions, loaded]);

  const activeSession = sessions.find(s => s.id === activeId) ?? null;
  const messages = activeSession?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [messages, loading]);

  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // Auto-grow the composer textarea as the user types, capped by CSS
  // (max-height + overflow-y: auto on .vsai-input-box textarea).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const startNewChat = () => {
    setActiveId(null);
    setInput("");
    setAttachedFile(null);
    setPanelMsg(null);
    cancelEdit();
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const handleFilePick = () => fileInputRef.current?.click();

  const copyMessage = async (msg: ChatMessage) => {
    const ok = await copyText(msg.text);
    if (ok) {
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((prev) => (prev === msg.id ? null : prev)), 1500);
    }
  };

  const copyPanel = async () => {
    if (!panelMsg) return;
    const ok = await copyText(panelMsg.text);
    if (ok) {
      setPanelCopied(true);
      setTimeout(() => setPanelCopied(false), 1500);
    }
  };

  // ----- edit & resend (only for "You" messages) -----
  const startEdit = (msg: ChatMessage) => {
    setEditingId(msg.id);
    setEditingText(msg.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const confirmEdit = () => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    setEditingId(null);
    setEditingText("");
    send(trimmed);
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setAttachedFile({ name: file.name, content: text.slice(0, 8000) }); // cap to keep prompt reasonable
    } catch {
      setAttachedFile({ name: file.name, content: "" });
    }

    e.target.value = "";
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && !attachedFile) || loading) return;

    const promptForAI = attachedFile
      ? `${trimmed}\n\n[Attached file: ${attachedFile.name}]\n${attachedFile.content}`
      : trimmed;

    const displayText = attachedFile
      ? `${trimmed}${trimmed ? "\n" : ""}📎 ${attachedFile.name}`
      : trimmed;

    const userMsg: ChatMessage = { id: `${Date.now()}-u`, sender: "You", text: displayText, ts: Date.now() };

    let sessionId = activeId;

    if (!sessionId) {
      sessionId = `${Date.now()}`;
      const title = trimmed.slice(0, 40) || attachedFile?.name || "New chat";
      setSessions(prev => [
        { id: sessionId!, title, messages: [userMsg], updatedAt: Date.now() },
        ...prev
      ]);
      setActiveId(sessionId);
    } else {
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, messages: [...s.messages, userMsg], updatedAt: Date.now() } : s
      ));
    }

    // Build history from the session as it was *before* this new message
    // (the setSessions calls above are async, so `messages`/`activeSession`
    // still reflect the prior state here).
    const priorMessages = activeSession?.messages ?? [];
    const history: ChatHistoryMessage[] = priorMessages
      .slice(-10)
      .map((m) => ({
        role: m.sender === "You" ? ("user" as const) : ("assistant" as const),
        content: m.text
      }));

    setInput("");
    setAttachedFile(null);
    setLoading(true);

    const myToken = ++genTokenRef.current;

    try {
      const result = await askVSmart(promptForAI, replyLang, history);
      const reply = result.message ?? "Done.";
      if (genTokenRef.current !== myToken) return; // stopped — drop this reply
      const aiMsg: ChatMessage = { id: `${Date.now()}-a`, sender: "VSmart", text: reply, ts: Date.now() };
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, messages: [...s.messages, aiMsg], updatedAt: Date.now() } : s
      ));
    } catch (err) {
      if (genTokenRef.current !== myToken) return; // stopped — drop this error
      // Show the real reason instead of a generic message — rate limits,
      // timeouts, and missing API keys all need different fixes from the
      // user, so swallowing the error made every failure look the same.
      const reason = err instanceof Error ? err.message : "Unknown error.";
      const aiMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        sender: "VSmart",
        text: `Something went wrong reaching the AI: ${reason}`,
        ts: Date.now()
      };
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, messages: [...s.messages, aiMsg], updatedAt: Date.now() } : s
      ));
    } finally {
      if (genTokenRef.current === myToken) setLoading(false);
    }
  };

  // Stop button: bump the token so the in-flight send() ignores its result,
  // and drop the spinner immediately so the UI feels responsive.
  const stopGenerating = () => {
    genTokenRef.current++;
    setLoading(false);
  };

  // Regenerate: find the user message right before this AI message, remove
  // this AI reply from the session, and re-send that user text.
  const regenerate = (aiMsg: ChatMessage) => {
    if (!activeSession || loading) return;
    const idx = activeSession.messages.findIndex(m => m.id === aiMsg.id);
    if (idx <= 0) return;
    const userMsg = activeSession.messages[idx - 1];
    if (userMsg.sender !== "You") return;

    const sid = activeSession.id;
    setSessions(prev => prev.map(s =>
      s.id === sid ? { ...s, messages: s.messages.slice(0, idx) } : s
    ));
    send(userMsg.text);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const isEmpty = messages.length === 0;
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="vsai-page">

      {/* Chat history sidebar */}
      <div className="vsai-history">
        <button className="vsai-new-chat" onClick={startNewChat}>
          <Plus size={15} /> New Chat
        </button>

        <div className="vsai-history-list">
          {sortedSessions.length === 0 && (
            <p className="vsai-history-empty">No conversations yet.</p>
          )}

          {sortedSessions.map(s => (
            <div
              key={s.id}
              className={s.id === activeId ? "vsai-history-item active" : "vsai-history-item"}
              onClick={() => setActiveId(s.id)}
            >
              <MessageSquare size={13} />
              <span className="vsai-history-title">{s.title}</span>
              <button className="vsai-history-delete" onClick={(e) => deleteSession(s.id, e)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat column */}
      <div className="vsai-main">

        {isEmpty ? (

          <div className="vsai-welcome">
            <div className="vsai-orb" />
            <h2>Ready to Create Something New?</h2>

            <div className="vsai-quick-actions">
              {QUICK_ACTIONS.map(qa => (
                <button key={qa.label} className="vsai-pill" onClick={() => setInput(qa.prompt)}>
                  {qa.icon} {qa.label}
                </button>
              ))}
            </div>
          </div>

        ) : (

          <div className="vsai-messages">
            {messages.map(m => {
              const isUser = m.sender === "You";
              const isEditingThis = editingId === m.id;
              const isLong = !isUser && m.text.length > LONG_RESULT_THRESHOLD;
              const isCollapsible = !isUser && m.text.length > INLINE_COLLAPSE_THRESHOLD;
              const isExpanded = expandedIds.has(m.id);

              return (
                <div key={m.id} className={isUser ? "vsai-msg-row user" : "vsai-msg-row ai"}>
                  {m.sender === "VSmart" && (
                    <div className="vsai-avatar"><Sparkles size={14} /></div>
                  )}

                  {isEditingThis ? (
                    <div className="vsai-bubble vsai-bubble-edit">
                      <textarea
                        ref={editInputRef}
                        className="vsai-edit-textarea"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            confirmEdit();
                          }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        rows={2}
                      />
                      <div className="vsai-edit-actions">
                        <button onClick={confirmEdit} title="Send edited message">
                          <Send size={13} />
                        </button>
                        <button onClick={cancelEdit} title="Cancel edit">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="vsai-bubble">
                      <div className="vsai-bubble-top">
                        {m.sender === "VSmart" && <span className="vsai-bubble-sender">VSmart</span>}
                        <div className="vsai-bubble-btns">
                          {isLong && (
                            <button
                              type="button"
                              className="vsai-copy-btn"
                              title="Open full result in side panel"
                              onClick={() => setPanelMsg(m)}
                            >
                              <Maximize2 size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="vsai-copy-btn"
                            title="Copy message"
                            onClick={() => copyMessage(m)}
                          >
                            {copiedId === m.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                          {isUser && (
                            <button
                              type="button"
                              className="vsai-copy-btn"
                              title="Edit & resend"
                              onClick={() => startEdit(m)}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {!isUser && (
                            <button
                              type="button"
                              className="vsai-copy-btn"
                              title="Regenerate response"
                              disabled={loading}
                              onClick={() => regenerate(m)}
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {m.sender === "VSmart" ? (
                        <>
                          <div className={isCollapsible && !isExpanded ? "vsai-bubble-text collapsed" : "vsai-bubble-text"}>
                            {renderLiteMarkdown(m.text)}
                          </div>
                          {isCollapsible && (
                            <button
                              type="button"
                              className="vsai-show-more-btn"
                              onClick={() => toggleExpanded(m.id)}
                            >
                              {isExpanded ? <>Show less <ChevronUp size={12} /></> : <>Show more <ChevronDown size={12} /></>}
                            </button>
                          )}
                        </>
                      ) : (
                        <p>{m.text}</p>
                      )}
                      <span className="vsai-bubble-time">{formatTime(m.ts)}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="vsai-msg-row ai">
                <div className="vsai-avatar"><Sparkles size={14} /></div>
                <div className="vsai-bubble vsai-typing">
                  <span /><span /><span />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

        )}

        <div className="vsai-input-wrap">

          {attachedFile && (
            <div className="vsai-attachment-chip">
              <Paperclip size={12} />
              <span>{attachedFile.name}</span>
              <button onClick={() => setAttachedFile(null)}><X size={12} /></button>
            </div>
          )}

          <div className="vsai-input-box">

            <Sparkles size={16} className="vsai-input-icon" />

            <textarea
              ref={textareaRef}
              placeholder="Ask Anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
            />

            {loading ? (
              <button
                className="vsai-send-btn vsai-stop-btn"
                onClick={stopGenerating}
                title="Stop generating"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="vsai-send-btn"
                onClick={() => send(input)}
                disabled={!input.trim() && !attachedFile}
              >
                <Send size={16} />
              </button>
            )}
          </div>

          <div className="vsai-input-footer">
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={handleFileChange}
              accept=".txt,.md,.csv,.json,.js,.ts,.tsx,.py,.log,.html,.css"
            />
            <span className="vsai-attach-btn" onClick={handleFilePick}>
              <Paperclip size={13} /> Attach
            </span>
            <span className="vsai-footer-note">VSmart AI — informational only, always double-check important answers.</span>
          </div>
        </div>

      </div>

      {/* Side panel for long AI results */}
      {panelMsg && (
        <div className="vsai-side-panel">
          <div className="vsai-side-panel-header">
            <span>Full Result</span>
            <div className="vsai-side-panel-actions">
              <button onClick={copyPanel} title="Copy full result">
                {panelCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button onClick={() => setPanelMsg(null)} title="Close panel">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="vsai-side-panel-body">
            {renderLiteMarkdown(panelMsg.text)}
          </div>
        </div>
      )}

    </div>
  );
}