import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  Link2,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";
import "./ProfilePanel.css";

/* ===================== LOCAL BRAND ICONS ===================== */

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.303-5.467-1.334-5.467-5.93 0-1.31.468-2.38 1.236-3.22-.124-.303-.536-1.523.117-3.176 0 0 1.008-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.29-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.873.118 3.176.77.84 1.235 1.91 1.235 3.22 0 4.61-2.807 5.625-5.48 5.922.43.37.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .32.217.694.825.576C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.792l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function LinkedinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function InstagramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function YoutubeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

/* ===================== TYPES & HELPERS ===================== */

export interface SocialLink {
  id: string;
  label: string;
  url: string;
  icon: "github" | "twitter" | "linkedin" | "instagram" | "youtube" | "website" | "link";
}

export interface UserProfile {
  name: string;
  email: string;
  profession: string;
  dob: string;
  photo: string | null;
  socials: SocialLink[];
}

const PROFILE_KEY = "vsmart_user_profile";

const DEFAULT_PROFILE: UserProfile = {
  name: "Operator",
  email: "",
  profession: "",
  dob: "",
  photo: null,
  socials: []
};

export function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(p: UserProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  window.dispatchEvent(new CustomEvent("vsmart-profile-updated", { detail: p }));
  // Durable, cross-window copy — same hybrid pattern as useTheme.ts.
  window.vsmart?.saveMemory?.(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
}

/**
 * Reconciles the localStorage cache with the durable SQLite-backed store.
 * Returns the profile to apply if it differs from what's cached, or null
 * if nothing changed / the store is unavailable.
 */
export async function reconcileProfileFromMemory(current: UserProfile): Promise<UserProfile | null> {
  try {
    const raw = await window.vsmart?.getMemory?.(PROFILE_KEY);
    if (!raw || typeof raw !== "string") return null;
    const next: UserProfile = { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    if (JSON.stringify(next) === JSON.stringify(current)) return null;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

const ICON_OPTIONS: SocialLink["icon"][] = [
  "github",
  "twitter",
  "linkedin",
  "instagram",
  "youtube",
  "website",
  "link"
];

function SocialIcon({ icon, size = 16 }: { icon: SocialLink["icon"]; size?: number }) {
  switch (icon) {
    case "github":
      return <GithubIcon size={size} />;
    case "twitter":
      return <XIcon size={size} />;
    case "linkedin":
      return <LinkedinIcon size={size} />;
    case "instagram":
      return <InstagramIcon size={size} />;
    case "youtube":
      return <YoutubeIcon size={size} />;
    case "website":
      return <Globe size={size} />;
    default:
      return <Link2 size={size} />;
  }
}

/* ===================== COMPONENT ===================== */

interface ProfilePanelProps {
  open: boolean;
  onClose: () => void;
}

export default function ProfilePanel({ open, onClose }: ProfilePanelProps) {
  const [profile, setProfile] = useState<UserProfile>(loadProfile);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [hasKey, setHasKey] = useState(false);
  const [socialScroll, setSocialScroll] = useState(0);
  const [addSocialOpen, setAddSocialOpen] = useState(false);
  const [newSocial, setNewSocial] = useState<{ label: string; url: string; icon: SocialLink["icon"] }>({
    label: "",
    url: "",
    icon: "link"
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const p = loadProfile();
      setProfile(p);
      setDraft(p);
      setEditing(false);
      window.vsmart.apiKey.has().then(setHasKey).catch(() => setHasKey(false));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  if (!open) return null;

  const data = editing ? draft : profile;
  const socials = data.socials || [];
  const pageSize = 4;
  const maxScroll = Math.max(0, socials.length - pageSize);
  const visibleSocials = socials.slice(socialScroll, socialScroll + pageSize);

  const startEdit = () => {
    setDraft({ ...profile, socials: [...(profile.socials || [])] });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(profile);
    setEditing(false);
    setAddSocialOpen(false);
  };

  const saveEdit = () => {
    const next = {
      ...draft,
      name: draft.name.trim() || "Operator",
      email: draft.email.trim(),
      profession: draft.profession.trim(),
      dob: draft.dob.trim()
    };
    saveProfile(next);
    setProfile(next);
    setEditing(false);
    setAddSocialOpen(false);
  };

  const onPhotoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (editing) setDraft((d) => ({ ...d, photo: url }));
      else {
        const next = { ...profile, photo: url };
        saveProfile(next);
        setProfile(next);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removePhoto = () => {
    if (editing) setDraft((d) => ({ ...d, photo: null }));
    else {
      const next = { ...profile, photo: null };
      saveProfile(next);
      setProfile(next);
    }
  };

  const addSocial = () => {
    if (!newSocial.url.trim()) return;
    let url = newSocial.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const item: SocialLink = {
      id: `${Date.now()}`,
      label: newSocial.label.trim() || newSocial.icon,
      url,
      icon: newSocial.icon
    };
    setDraft((d) => ({ ...d, socials: [...(d.socials || []), item] }));
    setNewSocial({ label: "", url: "", icon: "link" });
    setAddSocialOpen(false);
  };

  const removeSocial = (id: string) => {
    setDraft((d) => ({ ...d, socials: (d.socials || []).filter((s) => s.id !== id) }));
  };

  const openSocial = (url: string) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
  };

  const llms = [
    { name: "Hunyuan (Hy3)", connected: true },
    { name: "Qwen3-Coder", connected: true }
  ];

  return (
    <div className="profile-panel-overlay">
      <div className="profile-panel glossy-card" ref={panelRef}>
        <div className="profile-panel-header">
          <span>PROFILE</span>
          <div className="profile-panel-actions">
            {!editing ? (
              <button className="pp-icon-btn" title="Edit" onClick={startEdit}>
                <Pencil size={14} />
              </button>
            ) : (
              <>
                <button className="pp-icon-btn ok" title="Save" onClick={saveEdit}>
                  <Check size={14} />
                </button>
                <button className="pp-icon-btn" title="Cancel" onClick={cancelEdit}>
                  <X size={14} />
                </button>
              </>
            )}
            <button className="pp-icon-btn" title="Close" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Photo */}
        <div className="pp-photo-wrap">
          <div className="pp-photo">
            {data.photo ? (
              <img src={data.photo} alt="Profile" />
            ) : (
              <span className="pp-photo-fallback">{(data.name || "O").charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="pp-photo-btns">
            <button className="pp-chip" onClick={() => fileRef.current?.click()}>
              <Camera size={12} /> {data.photo ? "Change" : "Add photo"}
            </button>
            {data.photo && (
              <button className="pp-chip danger" onClick={removePhoto}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onPhotoPick}
          />
        </div>

        {/* Fields */}
        <div className="pp-fields">
          <label>
            <span>Name</span>
            {editing ? (
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Your name"
              />
            ) : (
              <p>{data.name || "Operator"}</p>
            )}
          </label>
          <label>
            <span>Email</span>
            {editing ? (
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="you@email.com"
              />
            ) : (
              <p>{data.email || "—"}</p>
            )}
          </label>
          <label>
            <span>Profession</span>
            {editing ? (
              <input
                value={draft.profession}
                onChange={(e) => setDraft({ ...draft, profession: e.target.value })}
                placeholder="e.g. Developer"
              />
            ) : (
              <p>{data.profession || "—"}</p>
            )}
          </label>
          <label>
            <span>Date of birth</span>
            {editing ? (
              <input
                type="date"
                value={draft.dob}
                onChange={(e) => setDraft({ ...draft, dob: e.target.value })}
              />
            ) : (
              <p>{data.dob || "—"}</p>
            )}
          </label>
        </div>

        {/* API key status */}
        <div className="pp-section">
          <div className="pp-section-title">API Key</div>
          <div className="pp-status-row">
            <span className={`pp-dot ${hasKey ? "on" : "off"}`} />
            <span className="pp-status-text">{hasKey ? "Active" : "Inactive"}</span>
            <em className="pp-status-sub">{hasKey ? "Connected" : "Not connected"}</em>
          </div>
        </div>

        {/* LLM status */}
        <div className="pp-section">
          <div className="pp-section-title">LLM Status</div>
          <div className="pp-llm-list">
            {llms.map((m) => (
              <div key={m.name} className="pp-llm-item">
                <span className={`pp-dot ${m.connected ? "on" : "off"}`} />
                <span className="pp-llm-name">{m.name}</span>
                <em className="pp-status-sub">{m.connected ? "Connected" : "Not connected"}</em>
              </div>
            ))}
          </div>
        </div>

        {/* Socials */}
        <div className="pp-section">
          <div className="pp-section-title-row">
            <div className="pp-section-title">Social</div>
            {editing && (
              <button className="pp-chip" onClick={() => setAddSocialOpen((v) => !v)}>
                <Plus size={12} /> Add
              </button>
            )}
          </div>

          {/* ===== Icon Picker (user can select icon while adding) ===== */}
          {addSocialOpen && editing && (
            <div className="pp-add-social">
              <div className="pp-icon-pick">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    className={newSocial.icon === ic ? "active" : ""}
                    onClick={() => setNewSocial({ ...newSocial, icon: ic })}
                    title={ic}
                  >
                    <SocialIcon icon={ic} size={14} />
                  </button>
                ))}
              </div>
              <input
                placeholder="Label (optional)"
                value={newSocial.label}
                onChange={(e) => setNewSocial({ ...newSocial, label: e.target.value })}
              />
              <input
                placeholder="https://..."
                value={newSocial.url}
                onChange={(e) => setNewSocial({ ...newSocial, url: e.target.value })}
              />
              <button className="pp-chip ok" onClick={addSocial}>
                Save link
              </button>
            </div>
          )}

          <div className="pp-social-row">
            {socials.length > pageSize && (
              <button
                className="pp-scroll-btn"
                disabled={socialScroll <= 0}
                onClick={() => setSocialScroll((s) => Math.max(0, s - 1))}
              >
                <ChevronLeft size={14} />
              </button>
            )}

            <div className="pp-social-icons">
              {visibleSocials.length === 0 && (
                <span className="pp-empty">No social links</span>
              )}
              {visibleSocials.map((s) => (
                <div key={s.id} className="pp-social-item">
                  <button
                    className="pp-social-btn"
                    title={s.label || s.url}
                    onClick={() => openSocial(s.url)}
                  >
                    <SocialIcon icon={s.icon} size={16} />
                  </button>
                  {editing && (
                    <button
                      className="pp-social-del"
                      title="Remove"
                      onClick={() => removeSocial(s.id)}
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {socials.length > pageSize && (
              <button
                className="pp-scroll-btn"
                disabled={socialScroll >= maxScroll}
                onClick={() => setSocialScroll((s) => Math.min(maxScroll, s + 1))}
              >
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}