// systemAgent.ts
// Keyword router for system-level commands.
// Covers English, Hindi, Hinglish, and Marathi.
// Falls back to the generic app/website opener for anything unrecognised.

function extractNumber(text: string): number | null {
  const match = text.match(/(\d{1,3})/);
  return match ? parseInt(match[1], 10) : null;
}

const OFF_WORDS = ["off", "band", "bandh", "disable", "bund", "बंद", "बंद कर", "kami kar", "kami karo"];
const ON_WORDS  = ["on", "chalu", "chalo", "enable", "shuru", "चालू", "start", "chalu kar", "chalu karo", "vad"];

function isOff(text: string): boolean { return OFF_WORDS.some(w => text.includes(w)); }
function isOn(text: string):  boolean { return ON_WORDS.some(w => text.includes(w));  }

export async function systemAgent(target: string): Promise<string> {
  const lower = target.toLowerCase();

  try {

    // ── Volume ────────────────────────────────────────────────────────────────
    if (
      lower.includes("volume") || lower.includes("awaaz") || lower.includes("आवाज़") ||
      lower.includes("awaz") || lower.includes("aavaz") || lower.includes("aavaaz")
    ) {
      const pct = extractNumber(lower);
      if (pct !== null) return await window.vsmart.systemControl("setVolume", pct);
      if (/badha|badhao|zyada|increase|up|vad|vadhav/.test(lower))
        return await window.vsmart.systemControl("volumeUp");
      if (/ghata|ghataao|kam|decrease|down|kami|kami kar/.test(lower))
        return await window.vsmart.systemControl("volumeDown");
      if (isOff(lower) || /mute|silent/.test(lower))
        return await window.vsmart.systemControl("mediaMute");
    }

    // ── Mute (standalone) ────────────────────────────────────────────────────
    if (/\b(mute|unmute|silent|chup karo|band kar)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaMute");
    }

    // ── Brightness ───────────────────────────────────────────────────────────
    if (
      lower.includes("brightness") || lower.includes("chamak") ||
      lower.includes("रोशनी") || lower.includes("prakash") || lower.includes("उजेड")
    ) {
      const pct = extractNumber(lower);
      if (pct !== null) return await window.vsmart.systemControl("setBrightness", pct);
      if (/badha|badhao|zyada|increase|up|vad|vadhav|jast|jast karo/.test(lower))
        return await window.vsmart.systemControl("brightnessUp");
      if (/ghata|ghataao|kam|decrease|down|kami|kami kar|kami karo/.test(lower))
        return await window.vsmart.systemControl("brightnessDown");
    }

    // ── Wi-Fi: require explicit on/off word ──────────────────────────────────
    if (
      (lower.includes("wifi") || lower.includes("wi-fi")) &&
      (isOff(lower) || isOn(lower))
    ) {
      if (isOff(lower)) return await window.vsmart.systemControl("wifiOff");
      return await window.vsmart.systemControl("wifiOn");
    }
    if (
      (lower.includes("internet") || lower.includes("network")) &&
      (isOff(lower) || isOn(lower))
    ) {
      if (isOff(lower)) return await window.vsmart.systemControl("wifiOff");
      return await window.vsmart.systemControl("wifiOn");
    }

    // ── Bluetooth ────────────────────────────────────────────────────────────
    if (lower.includes("bluetooth") || lower.includes("ब्लूटूथ")) {
      if (isOff(lower)) return await window.vsmart.systemControl("bluetoothOff");
      if (isOn(lower))  return await window.vsmart.systemControl("bluetoothOn");
    }

    // ── Media — play / pause ──────────────────────────────────────────────────
    if (
      (/\b(play|resume|chalu kar|bajao)\b/.test(lower) && !/\bplayback\b/.test(lower)) ||
      (/\b(pause|rok|roko|थांब|थांबव)\b/.test(lower) && !/\bscreenshot\b/.test(lower))
    ) {
      return await window.vsmart.systemControl("mediaPlayPause");
    }
    if (/\bstop\b/.test(lower) && /\b(music|song|video|media|gaana|gana|git)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaStop");
    }
    if (/\b(next|skip|agla|agli|pudhe)\b/.test(lower) && /\b(song|gaana|gana|track|music)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaNext");
    }
    if (/\b(previous|prev|back|pichla|pichli|maage)\b/.test(lower) && /\b(song|gaana|gana|track|music)\b/.test(lower)) {
      return await window.vsmart.systemControl("mediaPrev");
    }

    // ── Screenshot ───────────────────────────────────────────────────────────
    if (
      lower.includes("screenshot") || lower.includes("screen shot") ||
      lower.includes("स्क्रीनशॉट") || lower.includes("screen capture")
    ) {
      return await window.vsmart.systemControl("screenshot");
    }

    // ── Lock PC ──────────────────────────────────────────────────────────────
    if (
      /\b(lock|lock karo|lock kar do|pc lock|computer lock|screen lock)\b/.test(lower)
    ) {
      // Win+L shortcut
      await window.vsmart.desktopControl.pressKey("win+l");
      return "PC lock kar diya.";
    }

    // ── Recycle Bin ──────────────────────────────────────────────────────────
    if (lower.includes("recycle bin") || lower.includes("trash") || lower.includes("recycle")) {
      return await window.vsmart.systemControl("recycleBin");
    }

    // ── Window management ────────────────────────────────────────────────────
    if (/\b(minimize|chhota|chota|choti|lahan karo)\b/.test(lower) && !/\ball\b/.test(lower)) {
      return await window.vsmart.systemControl("windowMinimize");
    }
    if (/minimize all|sab minimize|saari windows|sare minimize/.test(lower)) {
      return await window.vsmart.systemControl("windowMinimizeAll");
    }
    if (/\b(maximize|bada|bara|motha karo)\b/.test(lower)) {
      return await window.vsmart.systemControl("windowMaximize");
    }
    if (/\b(close|band)\b/.test(lower) && /\b(window|tab|vindow)\b/.test(lower)) {
      return await window.vsmart.systemControl("windowClose");
    }
    if (/\b(show desktop|desktop dikhao|desktop pe jao|desktop dakhva)\b/.test(lower)) {
      return await window.vsmart.systemControl("windowShowDesktop");
    }

    // ── Notepad ──────────────────────────────────────────────────────────────
    if (lower.includes("notepad")) {
      const quoted = target.match(/["']([^"']+)["']/);
      let textToWrite = quoted?.[1];
      if (!textToWrite) {
        textToWrite = lower
          .replace(/\bnotepad\b/g, " ")
          .replace(/\b(mein|me|aur|and|madhe|madhe lihiva)\b/g, " ")
          .replace(/\b(likho|likh|likhna|write|type|karo|lihiva)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      if (textToWrite) return await window.vsmart.systemControl("writeNotepad", textToWrite);
      return await window.vsmart.openSystem("notepad");
    }

    // ── Special folders ──────────────────────────────────────────────────────
    const folderKeywords = ["download", "document", "picture", "music", "song", "video"];
    if (lower.includes("desktop folder") || folderKeywords.some(f => lower.includes(f))) {
      return await window.vsmart.systemControl("openFolder", lower);
    }

    // ── Restart / Shutdown ───────────────────────────────────────────────────
    if (lower.includes("restart") || lower.includes("reboot") || lower.includes("dobara chalu") || lower.includes("punarstart")) {
      return await window.vsmart.systemControl("restart");
    }
    if (
      lower.includes("shutdown") || lower.includes("shut down") ||
      lower.includes("band kar pc") || lower.includes("pc band") ||
      lower.includes("band kar do pc") || lower.includes("computer band karo")
    ) {
      return await window.vsmart.systemControl("shutdown");
    }
    if (lower.includes("cancel shutdown") || lower.includes("shutdown cancel")) {
      return await window.vsmart.systemControl("cancelShutdown");
    }

    // ── Fallback: generic app / website opener ───────────────────────────────
    return await window.vsmart.openSystem(target);

  } catch (err) {
    console.error("[systemAgent] error:", err);
    return "Yeh nahi ho paya — ek baar aur try karo.";
  }
}
