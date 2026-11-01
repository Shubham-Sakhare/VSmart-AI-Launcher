// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Memory Management Page
//
// Full UI for viewing, searching, editing, and deleting long-term memories.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Search, Trash2, Edit2, Plus, Brain, Tag, RefreshCw, X, Check } from "lucide-react";
import { useMemoryStore, type MemoryCategory, type MemoryFact } from "../../../store/memoryStore";
import "./MemoryPage.css";

const CATEGORIES: { key: MemoryCategory; label: string; icon: string }[] = [
  { key: "all",        label: "All",         icon: "🧠" },
  { key: "preference", label: "Preferences", icon: "⚙️" },
  { key: "personal",   label: "Personal",    icon: "👤" },
  { key: "work",       label: "Work",        icon: "💼" },
  { key: "reminder",   label: "Reminders",   icon: "📌" },
  { key: "general",    label: "General",     icon: "📝" },
];

export default function MemoryPage() {
  const {
    loading, searchQuery, category,
    loadFacts, saveFact, deleteFact, clearAll,
    setSearchQuery, setCategory, getFilteredFacts,
  } = useMemoryStore();

  const [editingKey, setEditingKey]   = useState<string | null>(null);
  const [editValue,  setEditValue]    = useState("");
  const [addKey,     setAddKey]       = useState("");
  const [addValue,   setAddValue]     = useState("");
  const [showAdd,    setShowAdd]      = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void loadFacts();
  }, []);

  const filtered = getFilteredFacts();

  const handleEdit = (fact: MemoryFact) => {
    setEditingKey(fact.key);
    setEditValue(fact.value);
  };

  const saveEdit = async () => {
    if (!editingKey) return;
    await saveFact(editingKey, editValue);
    setEditingKey(null);
    setEditValue("");
  };

  const handleAdd = async () => {
    if (!addKey.trim() || !addValue.trim()) return;
    await saveFact(addKey.trim(), addValue.trim());
    setAddKey("");
    setAddValue("");
    setShowAdd(false);
  };

  const handleDelete = async (key: string) => {
    if (window.confirm(`Delete memory: "${key}"?`)) {
      await deleteFact(key);
    }
  };

  const handleClearAll = async () => {
    if (confirmClear) {
      await clearAll();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 5000);
    }
  };

  return (
    <div className="memory-page">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="memory-header">
        <div className="memory-title">
          <Brain size={20} />
          <span>Long-Term Memory</span>
          <span className="memory-count">{filtered.length}</span>
        </div>
        <div className="memory-header-actions">
          <button
            className="mem-btn secondary"
            onClick={() => void loadFacts()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh memories"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
          </button>
          <button
            className="mem-btn add"
            onClick={() => setShowAdd(v => !v)}
            title="Add memory"
            aria-label="Add new memory"
          >
            <Plus size={13} /> Add
          </button>
          <button
            className={`mem-btn danger ${confirmClear ? "confirm" : ""}`}
            onClick={handleClearAll}
            title={confirmClear ? "Click again to confirm clear" : "Clear all memories"}
            aria-label="Clear all memories"
          >
            <Trash2 size={13} />
            {confirmClear ? "Confirm?" : "Clear All"}
          </button>
        </div>
      </div>

      {/* ── Add new memory ─────────────────────────────────────────────── */}
      {showAdd && (
        <div className="memory-add-form">
          <input
            className="mem-input"
            placeholder="Memory key (e.g. user_name, favorite_color)"
            value={addKey}
            onChange={e => setAddKey(e.target.value)}
            aria-label="Memory key"
          />
          <input
            className="mem-input"
            placeholder="Value"
            value={addValue}
            onChange={e => setAddValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && void handleAdd()}
            aria-label="Memory value"
          />
          <div className="mem-add-actions">
            <button className="mem-btn add" onClick={() => void handleAdd()}>
              <Check size={13} /> Save
            </button>
            <button className="mem-btn secondary" onClick={() => setShowAdd(false)}>
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Search & filter ────────────────────────────────────────────── */}
      <div className="memory-filters">
        <div className="memory-search-wrap">
          <Search size={13} className="search-icon" />
          <input
            className="memory-search"
            placeholder="Search memories…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search memories"
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="memory-cats" role="tablist">
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              className={`mem-cat ${category === c.key ? "active" : ""}`}
              onClick={() => setCategory(c.key)}
              role="tab"
              aria-selected={category === c.key}
            >
              <span>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Facts grid ─────────────────────────────────────────────────── */}
      <div className="memory-grid" role="list">
        {loading && (
          <div className="memory-loading">
            <RefreshCw size={20} className="spin" />
            <p>Loading memories…</p>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="memory-empty">
            <Brain size={32} opacity={0.25} />
            <p>No memories yet</p>
            <p className="memory-empty-sub">
              Say things like "Remember my name is …" or "My favorite app is …"
            </p>
          </div>
        )}

        {filtered.map(fact => (
          <div key={fact.key} className="memory-card" role="listitem">
            <div className="memory-card-header">
              <span className="memory-key">
                <Tag size={10} />
                {fact.key}
              </span>
              <span className={`memory-cat-badge cat-${fact.category}`}>
                {CATEGORIES.find(c => c.key === fact.category)?.icon ?? "📝"}
                {fact.category}
              </span>
            </div>

            {editingKey === fact.key ? (
              <div className="memory-edit-row">
                <input
                  className="mem-input edit-input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && void saveEdit()}
                  autoFocus
                  aria-label={`Edit value for ${fact.key}`}
                />
                <div className="memory-edit-actions">
                  <button className="mem-btn add" onClick={() => void saveEdit()}>
                    <Check size={12} />
                  </button>
                  <button className="mem-btn secondary" onClick={() => setEditingKey(null)}>
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="memory-value">{fact.value}</p>
            )}

            <div className="memory-card-footer">
              <span className="memory-date">
                Updated {formatDate(fact.updated_at)}
              </span>
              <div className="memory-card-actions">
                <button
                  className="mem-icon-btn"
                  onClick={() => handleEdit(fact)}
                  title="Edit"
                  aria-label={`Edit ${fact.key}`}
                >
                  <Edit2 size={11} />
                </button>
                <button
                  className="mem-icon-btn danger"
                  onClick={() => void handleDelete(fact.key)}
                  title="Delete"
                  aria-label={`Delete ${fact.key}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.round((now.getTime() - d.getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400)return `${Math.round(diff / 3600)}h ago`;
    return d.toLocaleDateString("en-IN");
  } catch { return iso; }
}
