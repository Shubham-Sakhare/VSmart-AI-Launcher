// Detects special system-control phrases and dispatches to the right action.
// Covers English, Hindi, and Hinglish command patterns.
// Anything that doesn't match falls back to the generic app/website opener (openSystem).

function extractNumber(text: string): number | null {
  const match = text.match(/(\d{1,3})/);
  return match ? parseInt(match[1], 10) : null;
}

const OFF_WORDS = ["off", "band", "bandh", "disable", "bund", "बंद"];
const ON_WORDS  = ["on", "chalu", "chalo", "enable", "shuru", "चालू", "start"];

function isOff(text: string): boolean {
  return OFF_WORDS.some(w => text.includes(w));
}
function isOn(text: string): boolean {
  return ON_WORDS.some(w => text.includes(w));
}

export async function systemAgent(target: string): Promise<string> {
  const lower = target.toLowerCase();

  try {

    // ---- Volume ----
    if (lower.includes("volume") || lower.includes("awaaz") || lower.includes("आवाज़")) {
      const pct = extractNumber(lower);
      if (pct !== null) return await window.vsmart.systemControl("setVolume", pct);
      // relative: "volume badha" / "volume ghata"
      if (/badha|badhao|zyada|increase|up/.test(lower))
        return await window.vsmart.systemControl("setVolume", 80);
      if (/ghata|ghataao|kam|decrease|down/.test(lower))
        return await window.vsmart.systemControl("setVolume", 30);
      if (isOff(lower) || /mute|silent/.test(lower))
        return await window.vsmart.systemControl("mediaMute");
    }

    // ---- Mute (standalone) ----
    if (/\b(mute|unmute|silent)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaMute");
    }

    // ---- Brightness ----
    if (lower.includes("brightness") || lower.includes("chamak") || lower.includes("रोशनी")) {
      const pct = extractNumber(lower);
      if (pct !== null) return await window.vsmart.systemControl("setBrightness", pct);
      if (/badha|badhao|zyada|increase|up/.test(lower))
        return await window.vsmart.systemControl("setBrightness", 80);
      if (/ghata|ghataao|kam|decrease|down/.test(lower))
        return await window.vsmart.systemControl("setBrightness", 30);
    }

    // ---- Wi-Fi ----
    if (lower.includes("wifi") || lower.includes("wi-fi") || lower.includes("internet") || lower.includes("network")) {
      if (isOff(lower)) return await window.vsmart.systemControl("wifiOff");
      if (isOn(lower))  return await window.vsmart.systemControl("wifiOn");
    }

    // ---- Bluetooth ----
    if (lower.includes("bluetooth") || lower.includes("ब्लूटूथ")) {
      if (isOff(lower)) return await window.vsmart.systemControl("bluetoothOff");
      if (isOn(lower))  return await window.vsmart.systemControl("bluetoothOn");
    }

    // ---- Media controls ----
    // Play / pause: "play karo", "pause karo", "chalu karo music", "rok do"
    if (
      /\b(play|resume)\b/.test(lower) && !/\bplayback\b/.test(lower) ||
      /\b(pause|rok|roko|रोको)\b/.test(lower) && !/\bscreenshot\b/.test(lower)
    ) {
      return await window.vsmart.systemControl("mediaPlayPause");
    }

    // Stop media: "stop karo", "band karo music" — but not "wifi band karo"
    if (
      /\bstop\b/.test(lower) && /\b(music|song|video|media|gaana|gana)\b/.test(lower)
    ) {
      return await window.vsmart.systemControl("mediaStop");
    }

    // Next track: "next song", "agli gaana", "skip"
    if (/\b(next|skip|agla|agli)\b/.test(lower) && /\b(song|gaana|gana|track|music)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaNext");
    }

    // Previous track: "previous song", "pichla gaana"
    if (/\b(previous|prev|back|pichla|pichli)\b/.test(lower) && /\b(song|gaana|gana|track|music)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaPrev");
    }

    // ---- Screenshot ----
    if (lower.includes("screenshot") || lower.includes("screen shot") || lower.includes("स्क्रीनशॉट")) {
      return await window.vsmart.systemControl("screenshot");
    }

    // ---- Recycle Bin ----
    if (lower.includes("recycle bin") || lower.includes("trash") || lower.includes("recycle")) {
      return await window.vsmart.systemControl("recycleBin");
    }

    // ---- Window management ----
    // Minimize: "window chhota karo", "minimize karo", "choti kar"
    if (/\b(minimize|chhota|chota|choti)\b/.test(lower) && !/\ball\b/.test(lower)) {
      return await window.vsmart.systemControl("windowMinimize");
    }
    if (/minimize all|sab minimize|saari windows/.test(lower)) {
      return await window.vsmart.systemControl("windowMinimizeAll");
    }
    // Maximize: "bada karo", "maximize"
    if (/\b(maximize|bada|bara)\b/.test(lower)) {
      return await window.vsmart.systemControl("windowMaximize");
    }
    // Close window: "window band karo", "close this window" — but not "close app" (that's openSystem)
    if (/\b(close|band)\b/.test(lower) && /\b(window|tab)\b/.test(lower)) {
      return await window.vsmart.systemControl("windowClose");
    }
    // Show desktop: "desktop dikhao", "show desktop"
    if (/\b(show desktop|desktop dikhao|desktop pe jao)\b/.test(lower)) {
      return await window.vsmart.systemControl("windowShowDesktop");
    }

    // ---- Notepad + write text ----
    // e.g. "notepad mein likho hello world" / "notepad kholo aur type karo X"
    if (lower.includes("notepad")) {
      const quoted = target.match(/["']([^"']+)["']/);
      let textToWrite = quoted?.[1];

      if (!textToWrite) {
        // Strip trigger words; remainder is the text to write
        textToWrite = lower
          .replace(/\bnotepad\b/g, " ")
          .replace(/\b(mein|me|aur|and)\b/g, " ")
          .replace(/\b(likho|likh|likhna|write|type|karo)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      if (textToWrite) {
        return await window.vsmart.systemControl("writeNotepad", textToWrite);
      }

      return await window.vsmart.openSystem("notepad");
    }

    // ---- Special folders ----
    const folderKeywords = ["download", "document", "picture", "music", "song", "video"];
    // "desktop" handled above for window management; also handle "open desktop folder"
    if (lower.includes("desktop folder") || folderKeywords.some(f => lower.includes(f))) {
      return await window.vsmart.systemControl("openFolder", lower);
    }

    // ---- Restart / Shutdown — confirmation is handled by agenticRouter before this runs ----
    if (lower.includes("restart") || lower.includes("reboot") || lower.includes("dobara chalu")) {
      return await window.vsmart.systemControl("restart");
    }
    if (lower.includes("shutdown") || lower.includes("shut down") || lower.includes("band kar pc") || lower.includes("pc band")) {
      return await window.vsmart.systemControl("shutdown");
    }
    if (lower.includes("cancel shutdown") || lower.includes("shutdown cancel")) {
      return await window.vsmart.systemControl("cancelShutdown");
    }

    // ---- Fallback: generic app / website opener ----
    return await window.vsmart.openSystem(target);

  } catch {
    return `I could not do that. Please try again.`;
  }
}
