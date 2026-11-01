// ═══════════════════════════════════════════════════════════════════════════
// VSmart AI — Persona Settings Panel
//
// Configure the AI assistant's personality, name, tone, language, voice.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Save, Bot, RefreshCw } from "lucide-react";
import { useAppStore, type Persona } from "../../../store/appStore";
import { getProviderStatus, detectProvider } from "../../../llm/llmProvider";
import "./PersonaSettings.css";

export default function PersonaSettings() {
  const { persona, setPersona, permissions, grantPermission, revokePermission } = useAppStore();
  const [draft, setDraft]   = useState<Persona>({ ...persona });
  const [saved, setSaved]   = useState(false);
  const [provInfo, setProvInfo] = useState<ReturnType<typeof getProviderStatus> | null>(null);
  const [checking, setChecking] = useState(false);

  const update = (key: keyof Persona, value: unknown) =>
    setDraft(prev => ({ ...prev, [key]: value }));

  const save = () => {
    setPersona(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const checkProvider = async () => {
    setChecking(true);
    await detectProvider();
    setProvInfo(getProviderStatus());
    setChecking(false);
  };

  return (
    <div className="persona-settings">
      <div className="psettings-section">
        <h3 className="psettings-title"><Bot size={16} /> Assistant Identity</h3>
        <div className="psettings-row">
          <label>Name</label>
          <input
            className="psettings-input"
            value={draft.name}
            onChange={e => update("name", e.target.value)}
            placeholder="VSmart AI"
            aria-label="Assistant name"
          />
        </div>
        <div className="psettings-row">
          <label>Greeting</label>
          <input
            className="psettings-input"
            value={draft.greeting}
            onChange={e => update("greeting", e.target.value)}
            placeholder="Haan bolo, main sun raha hoon."
            aria-label="Assistant greeting"
          />
        </div>
        <div className="psettings-row">
          <label>Wake Word</label>
          <input
            className="psettings-input"
            value={draft.wakeWord}
            onChange={e => update("wakeWord", e.target.value)}
            placeholder="Hey VSmart"
            aria-label="Wake word"
          />
        </div>
      </div>

      <div className="psettings-section">
        <h3 className="psettings-title">Behavior</h3>

        <div className="psettings-row">
          <label>Tone</label>
          <div className="psettings-pills">
            {(["formal", "casual", "playful"] as Persona["tone"][]).map(t => (
              <button
                key={t}
                className={`psettings-pill ${draft.tone === t ? "active" : ""}`}
                onClick={() => update("tone", t)}
                aria-pressed={draft.tone === t}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="psettings-row">
          <label>Response Length</label>
          <div className="psettings-pills">
            {(["short", "medium", "detailed"] as Persona["responseLength"][]).map(l => (
              <button
                key={l}
                className={`psettings-pill ${draft.responseLength === l ? "active" : ""}`}
                onClick={() => update("responseLength", l)}
                aria-pressed={draft.responseLength === l}
              >
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="psettings-row">
          <label>Language</label>
          <div className="psettings-pills">
            {(["en", "hi", "hinglish"] as Persona["language"][]).map(l => (
              <button
                key={l}
                className={`psettings-pill ${draft.language === l ? "active" : ""}`}
                onClick={() => update("language", l)}
                aria-pressed={draft.language === l}
              >
                {l === "en" ? "English" : l === "hi" ? "हिन्दी" : "Hinglish"}
              </button>
            ))}
          </div>
        </div>

        <div className="psettings-row">
          <label>Voice</label>
          <div className="psettings-pills">
            <button
              className={`psettings-pill ${draft.speakingGender === "male" ? "active" : ""}`}
              onClick={() => update("speakingGender", "male")}
              aria-pressed={draft.speakingGender === "male"}
            >
              🎙 Male
            </button>
            <button
              className={`psettings-pill ${draft.speakingGender === "female" ? "active" : ""}`}
              onClick={() => update("speakingGender", "female")}
              aria-pressed={draft.speakingGender === "female"}
            >
              🎙 Female
            </button>
          </div>
        </div>

        <div className="psettings-row">
          <label>Humor</label>
          <button
            className={`psettings-toggle ${draft.humor ? "on" : "off"}`}
            onClick={() => update("humor", !draft.humor)}
            aria-label="Toggle humor"
            aria-pressed={draft.humor}
          >
            {draft.humor ? "On" : "Off"}
          </button>
        </div>
      </div>

      {/* AI Provider status */}
      <div className="psettings-section">
        <h3 className="psettings-title">AI Provider</h3>
        <div className="provider-info">
          <p className="provider-note">
            VSmart AI prefers <strong>Ollama (local, free, offline)</strong> when available.
            Falls back to <strong>OpenRouter (free tier)</strong> automatically.
          </p>
          <button
            className="psettings-btn secondary"
            onClick={checkProvider}
            disabled={checking}
          >
            <RefreshCw size={12} className={checking ? "spin" : ""} />
            {checking ? "Checking…" : "Check Provider"}
          </button>
          {provInfo && (
            <div className="provider-status">
              <div className={`provider-badge ${provInfo.isLocal ? "local" : "cloud"}`}>
                {provInfo.isLocal ? "🟢 Ollama (Local)" : "🟡 OpenRouter (Cloud)"}
              </div>
              <div className="provider-models">
                <span>Chat: {provInfo.chatModel}</span>
                <span>Coder: {provInfo.coderModel}</span>
                <span>Vision: {provInfo.visionModel}</span>
              </div>
              {provInfo.isLocal && (
                <p className="provider-note success">✓ Running locally — 100% private, no API cost</p>
              )}
              {!provInfo.isLocal && (
                <p className="provider-note">
                  Ollama not detected. Install from{" "}
                  <a
                    href="https://ollama.ai"
                    onClick={e => { e.preventDefault(); window.vsmart.openSystem("https://ollama.ai"); }}
                    className="provider-link"
                  >
                    ollama.ai
                  </a>
                  {" "}then run: <code>ollama pull llama3.2:3b</code>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Permissions */}
      <div className="psettings-section">
        <h3 className="psettings-title">Permissions</h3>
        <div className="permissions-list">
          {permissions.map(p => (
            <div key={p.key} className="perm-row">
              <div className="perm-info">
                <span className="perm-label">{p.label}</span>
                {p.requiresConfirmation && (
                  <span className="perm-confirm-badge">requires confirmation</span>
                )}
              </div>
              <button
                className={`psettings-toggle ${p.granted ? "on" : "off"}`}
                onClick={() => p.granted ? revokePermission(p.key) : grantPermission(p.key)}
                aria-label={`${p.granted ? "Revoke" : "Grant"} ${p.label}`}
                aria-pressed={p.granted}
              >
                {p.granted ? "On" : "Off"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="psettings-save-row">
        <button className="psettings-btn primary" onClick={save}>
          {saved ? "✓ Saved!" : <><Save size={13} /> Save Settings</>}
        </button>
      </div>
    </div>
  );
}
