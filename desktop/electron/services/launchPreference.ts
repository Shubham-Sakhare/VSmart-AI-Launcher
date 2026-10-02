import { app, dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";

// Tracks whether we've already asked the user "This Time / All Time" so we
// only ask once (not on every launch). Stored as a tiny JSON flag file next
// to the API key store, in the user's own AppData - never touches the
// installer or the .exe itself.
const PREF_FILE = path.join(app.getPath("userData"), "vsmart-launch-pref.json");

interface LaunchPref {
  asked: boolean;
  autostart: boolean;
}

function readPref(): LaunchPref {
  try {
    const raw = fs.readFileSync(PREF_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { asked: false, autostart: false };
  }
}

function writePref(pref: LaunchPref) {
  try {
    fs.writeFileSync(PREF_FILE, JSON.stringify(pref));
  } catch (error) {
    console.error("Failed to write launch preference:", error);
  }
}

export function setAutostart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath("exe"),
  });
  writePref({ asked: true, autostart: enabled });
}

export function getAutostart(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

// Shows the "This Time / All Time" prompt on first launch only. Safe to
// call every time app starts - it no-ops after the first run (or after the
// user has answered once).
export function promptLaunchPreferenceIfNeeded(mainWindow: BrowserWindow): void {
  const pref = readPref();
  if (pref.asked) return;

  const result = dialog.showMessageBoxSync(mainWindow, {
    type: "question",
    buttons: ["This Time", "All Time"],
    defaultId: 0,
    cancelId: 0,
    title: "VSmart AI",
    message: "How should VSmart AI open?",
    detail:
      "This Time: open normally just for now, launch manually next time.\n" +
      "All Time: automatically open VSmart AI whenever you log in to Windows.",
  });

  const wantsAutostart = result === 1;
  setAutostart(wantsAutostart);
}