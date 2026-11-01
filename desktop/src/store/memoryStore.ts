// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Memory Store (Zustand)
//
// Local cache of the long-term memory facts from SQLite.
// Provides: search, add, edit, delete, categorization.
// ═══════════════════════════════════════════════════════════════════════════

import { create } from "zustand";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MemoryFact {
  key:        string;
  value:      string;
  category:   string;
  created_at: string;
  updated_at: string;
}

export type MemoryCategory =
  | "preference"   // user preferences (favorite app, language, etc.)
  | "personal"     // personal info (name, email, city, etc.)
  | "work"         // work/project related
  | "reminder"     // things to remember/reminders
  | "general"      // general notes
  | "all";

// ── Store ─────────────────────────────────────────────────────────────────────
interface MemoryStoreState {
  facts:       MemoryFact[];
  loading:     boolean;
  searchQuery: string;
  category:    MemoryCategory;

  // Ops
  loadFacts:    () => Promise<void>;
  saveFact:     (key: string, value: string, category?: string) => Promise<boolean>;
  deleteFact:   (key: string) => Promise<boolean>;
  searchFacts:  (query: string, topK?: number) => Promise<MemoryFact[]>;
  clearAll:     () => Promise<void>;

  // UI
  setSearchQuery: (q: string) => void;
  setCategory:    (c: MemoryCategory) => void;

  // Selectors
  getFilteredFacts: () => MemoryFact[];
}

// ── Category auto-detection ───────────────────────────────────────────────────
function detectCategory(key: string, value: string): string {
  const text = `${key} ${value}`.toLowerCase();

  if (/prefer|favorite|favourite|like|hate|dislike|default|setting/i.test(text))
    return "preference";
  if (/name|age|birthday|city|email|phone|address|work|job|company|profession/i.test(text))
    return "personal";
  if (/project|code|task|work|client|deadline|meeting|office/i.test(text))
    return "work";
  if (/remind|remember|note|dont forget|schedule|appointment/i.test(text))
    return "reminder";
  return "general";
}

export const useMemoryStore = create<MemoryStoreState>()((set, get) => ({
  facts:       [],
  loading:     false,
  searchQuery: "",
  category:    "all",

  // ── Load all facts ──────────────────────────────────────────────────────
  loadFacts: async () => {
    set({ loading: true });
    try {
      const raw = await window.vsmart.longMemory.getAllFacts();
      // Attach auto-detected category
      const facts: MemoryFact[] = raw.map(f => ({
        ...f,
        category: detectCategory(f.key, f.value),
      }));
      set({ facts });
    } catch (e) {
      console.error("[Memory] Failed to load facts:", e);
    } finally {
      set({ loading: false });
    }
  },

  // ── Save fact ───────────────────────────────────────────────────────────
  saveFact: async (key, value, category) => {
    const cat = category ?? detectCategory(key, value);
    try {
      await window.vsmart.longMemory.saveFact(key, value);
      // Update local cache
      const now = new Date().toISOString();
      set(s => {
        const existing = s.facts.findIndex(f => f.key === key.toLowerCase());
        if (existing >= 0) {
          const updated = [...s.facts];
          updated[existing] = { key: key.toLowerCase(), value, category: cat, created_at: updated[existing].created_at, updated_at: now };
          return { facts: updated };
        }
        return { facts: [{ key: key.toLowerCase(), value, category: cat, created_at: now, updated_at: now }, ...s.facts] };
      });
      return true;
    } catch {
      return false;
    }
  },

  // ── Delete fact ─────────────────────────────────────────────────────────
  deleteFact: async (key) => {
    try {
      await window.vsmart.longMemory.deleteFact(key);
      set(s => ({ facts: s.facts.filter(f => f.key !== key) }));
      return true;
    } catch {
      return false;
    }
  },

  // ── Semantic search ─────────────────────────────────────────────────────
  searchFacts: async (query, topK = 5) => {
    try {
      const results = await window.vsmart.longMemory.searchFacts(query, topK);
      return results.map(r => ({
        key:        r.key,
        value:      r.value,
        category:   detectCategory(r.key, r.value),
        created_at: "",
        updated_at: "",
      }));
    } catch {
      return [];
    }
  },

  // ── Clear all ───────────────────────────────────────────────────────────
  clearAll: async () => {
    const { facts } = get();
    for (const f of facts) {
      try { await window.vsmart.longMemory.deleteFact(f.key); } catch { /* */ }
    }
    set({ facts: [] });
  },

  // ── UI setters ──────────────────────────────────────────────────────────
  setSearchQuery: (q) => set({ searchQuery: q }),
  setCategory:    (c) => set({ category: c }),

  // ── Filtered selector ───────────────────────────────────────────────────
  getFilteredFacts: () => {
    const { facts, searchQuery, category } = get();
    let filtered = facts;

    if (category !== "all") {
      filtered = filtered.filter(f => f.category === category);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f =>
        f.key.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q)
      );
    }

    return filtered;
  },
}));
