import { useEffect, useState } from "react";
import "./topbar.css";
import ProfilePanel, { loadProfile, reconcileProfileFromMemory, type UserProfile } from "./ProfilePanel";

import {
  Bell,
  Search,
  Wifi,
  Bluetooth,
  ChevronDown,
  UserCircle2
} from "lucide-react";

interface TopbarProps {
  onOpenSettings: () => void;
}

export default function Topbar({ onOpenSettings }: TopbarProps) {
  void onOpenSettings;
  const [now, setNow] = useState(new Date());
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());
  const [wifiOn, setWifiOn] = useState(true);
  const [btOn, setBtOn] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<UserProfile>).detail;
      if (detail) setProfile(detail);
      else setProfile(loadProfile());
    };
    window.addEventListener("vsmart-profile-updated", onUpdate);
    setProfile(loadProfile());
    return () => window.removeEventListener("vsmart-profile-updated", onUpdate);
  }, []);

  // One-time reconciliation with the durable SQLite-backed store — picks
  // up profile changes made from another window/session.
  useEffect(() => {
    let cancelled = false;
    reconcileProfileFromMemory(profile).then((next) => {
      if (!cancelled && next) {
        setProfile(next);
        window.dispatchEvent(new CustomEvent("vsmart-profile-updated", { detail: next }));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateStr = now.toLocaleDateString([], {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const displayName = profile.name?.trim() || "Operator";

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <div className="search-box">
            <Search size={18} />
            <input type="text" placeholder="Search anything..." />
            <span className="search-kbd">⌘K</span>
          </div>
        </div>

        <div className="topbar-center" />

        <div className="topbar-right">
          <button
            type="button"
            className={`icon-btn ${wifiOn ? "on" : ""}`}
            title="Wi-Fi"
            onClick={() => setWifiOn((v) => !v)}
          >
            <Wifi size={18} />
          </button>

          <button
            type="button"
            className={`icon-btn ${btOn ? "on" : ""}`}
            title="Bluetooth"
            onClick={() => setBtOn((v) => !v)}
          >
            <Bluetooth size={18} />
          </button>

          <button className="icon-btn" title="Notifications">
            <Bell size={18} />
          </button>

          <button
            type="button"
            className="profile-block profile-trigger"
            onClick={() => setProfileOpen((v) => !v)}
            title="Profile"
          >
            {profile.photo ? (
              <img src={profile.photo} alt="" className="profile-avatar" />
            ) : (
              <UserCircle2 size={34} className="profile" />
            )}
            <span className="profile-label">{displayName}</span>
            <ChevronDown size={14} className="profile-chevron" />
          </button>

          <div className="clock-block">
            <span className="clock-date">{dateStr}</span>
            <span className="clock-time">{timeStr}</span>
          </div>
        </div>
      </header>

      <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}