// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Conversation Store (Zustand)
//
// Manages all chat conversations — both voice-agent and smart-chat paths.
// Persists to SQLite via the memory IPC bridge.
// ═══════════════════════════════════════════════════════════════════════════

import { create } from "zustand";
import type { ReplyLang } from "../llm/openrouter";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Message {
  id:         string;
  sender:     "user" | "assistant";
  text:       string;
  timestamp:  number;
  type?:      "text" | "error" | "system" | "tool_result";
  toolName?:  string;
  streaming?: boolean;   // true while tokens are still arriving
}

export interface Conversation {
  id:         string;
  title:      string;
  messages:   Message[];
  createdAt:  number;
  updatedAt:  number;
  model?:     string;    // which LLM was used
  mode:       "voice" | "chat";  // voice-agent or smart-chat
}

// ── Persistence key ───────────────────────────────────────────────────────────
const PERSISTENCE_KEY = "jarvis_conversations_v2";

// ── Helper ────────────────────────────────────────────────────────────────────
function makeTitle(messages: Message[]): string {
  const first = messages.find(m => m.sender === "user");
  if (!first) return "New Chat";
  return first.text.length > 36 ? first.text.slice(0, 36) + "…" : first.text;
}

// ── Store ─────────────────────────────────────────────────────────────────────
interface ConversationStore {
  conversations:  Conversation[];
  activeId:       string | null;
  replyLang:      ReplyLang;
  loaded:         boolean;

  // Loading
  loadConversations:  () => Promise<void>;
  saveConversations:  () => Promise<void>;

  // CRUD
  newConversation:    (mode: "voice" | "chat") => Conversation;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  deleteConversations:(ids: string[]) => void;
  clearAll:           () => void;

  // Messages
  appendUserMessage:    (convId: string, text: string) => string;
  appendAssistantMsg:   (convId: string, text: string, type?: Message["type"]) => string;
  updateMessage:        (convId: string, msgId: string, text: string) => void;
  setMessageStreaming:  (convId: string, msgId: string, streaming: boolean) => void;
  deleteMessage:        (convId: string, msgId: string) => void;

  // Language
  setReplyLang: (lang: ReplyLang) => void;

  // Selectors
  getActiveConversation: () => Conversation | null;
  getHistory: (convId: string, maxMessages?: number) => { role: "user" | "assistant"; content: string }[];
}

export const useConversationStore = create<ConversationStore>()((set, get) => ({
  conversations: [],
  activeId:      null,
  replyLang:     "en",
  loaded:        false,

  // ── Load from SQLite ────────────────────────────────────────────────────
  loadConversations: async () => {
    try {
      const raw = await window.vsmart.getMemory(PERSISTENCE_KEY);
      if (raw) {
        const saved: Conversation[] = JSON.parse(raw);
        set({
          conversations: saved,
          activeId:      saved[0]?.id ?? null,
          loaded:        true,
        });
        return;
      }
    } catch { /* start fresh */ }
    set({ loaded: true });
  },

  // ── Save to SQLite ──────────────────────────────────────────────────────
  saveConversations: async () => {
    const { conversations } = get();
    try {
      // Keep max 100 conversations, max 200 messages each
      const trimmed = conversations.slice(0, 100).map(c => ({
        ...c,
        messages: c.messages.slice(-200),
      }));
      await window.vsmart.saveMemory(PERSISTENCE_KEY, JSON.stringify(trimmed));
    } catch { /* non-fatal */ }
  },

  // ── New conversation ────────────────────────────────────────────────────
  newConversation: (mode) => {
    const conv: Conversation = {
      id:        `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title:     "New Chat",
      messages:  [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode,
    };
    set(s => ({
      conversations: [conv, ...s.conversations],
      activeId:      conv.id,
    }));
    void get().saveConversations();
    return conv;
  },

  // ── Select ──────────────────────────────────────────────────────────────
  selectConversation: (id) => set({ activeId: id }),

  // ── Delete one ─────────────────────────────────────────────────────────
  deleteConversation: (id) => {
    set(s => {
      const next = s.conversations.filter(c => c.id !== id);
      return {
        conversations: next,
        activeId: s.activeId === id ? (next[0]?.id ?? null) : s.activeId,
      };
    });
    void get().saveConversations();
  },

  // ── Delete multiple ─────────────────────────────────────────────────────
  deleteConversations: (ids) => {
    const idSet = new Set(ids);
    set(s => {
      const next = s.conversations.filter(c => !idSet.has(c.id));
      return {
        conversations: next,
        activeId: idSet.has(s.activeId ?? "") ? (next[0]?.id ?? null) : s.activeId,
      };
    });
    void get().saveConversations();
  },

  // ── Clear all ───────────────────────────────────────────────────────────
  clearAll: () => {
    set({ conversations: [], activeId: null });
    void get().saveConversations();
  },

  // ── Append user message ─────────────────────────────────────────────────
  appendUserMessage: (convId, text) => {
    const msgId = `msg-${Date.now()}-u`;
    const msg: Message = {
      id:        msgId,
      sender:    "user",
      text,
      timestamp: Date.now(),
      type:      "text",
    };
    set(s => ({
      conversations: s.conversations.map(c => {
        if (c.id !== convId) return c;
        const msgs = [...c.messages, msg];
        return {
          ...c,
          messages:  msgs,
          title:     c.title === "New Chat" ? makeTitle(msgs) : c.title,
          updatedAt: Date.now(),
        };
      }),
    }));
    void get().saveConversations();
    return msgId;
  },

  // ── Append assistant message ────────────────────────────────────────────
  appendAssistantMsg: (convId, text, type = "text") => {
    const msgId = `msg-${Date.now()}-a`;
    const msg: Message = {
      id:        msgId,
      sender:    "assistant",
      text,
      timestamp: Date.now(),
      type,
    };
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id === convId
          ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
          : c
      ),
    }));
    void get().saveConversations();
    return msgId;
  },

  // ── Update message text (for streaming) ────────────────────────────────
  updateMessage: (convId, msgId, text) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : {
          ...c,
          messages: c.messages.map(m => m.id === msgId ? { ...m, text } : m),
        }
      ),
    }));
  },

  // ── Set streaming flag ──────────────────────────────────────────────────
  setMessageStreaming: (convId, msgId, streaming) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : {
          ...c,
          messages: c.messages.map(m => m.id === msgId ? { ...m, streaming } : m),
        }
      ),
    }));
  },

  // ── Delete message ──────────────────────────────────────────────────────
  deleteMessage: (convId, msgId) => {
    set(s => ({
      conversations: s.conversations.map(c =>
        c.id !== convId ? c : {
          ...c,
          messages: c.messages.filter(m => m.id !== msgId),
        }
      ),
    }));
    void get().saveConversations();
  },

  // ── Set reply language ──────────────────────────────────────────────────
  setReplyLang: (lang) => set({ replyLang: lang }),

  // ── Selectors ───────────────────────────────────────────────────────────
  getActiveConversation: () => {
    const { conversations, activeId } = get();
    return conversations.find(c => c.id === activeId) ?? null;
  },

  getHistory: (convId, maxMessages = 12) => {
    const conv = get().conversations.find(c => c.id === convId);
    if (!conv) return [];
    return conv.messages
      .slice(-maxMessages)
      .filter(m => m.type !== "system")
      .map(m => ({ role: m.sender, content: m.text }));
  },
}));
