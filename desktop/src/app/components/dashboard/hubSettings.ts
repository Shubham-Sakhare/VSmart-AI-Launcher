export const HUB_SETTINGS_KEY = "vsmart_hub_settings";

export interface HubSettings {
  placesIconSize: number;
  desktopTextSize: number;
  desktopIconSize: number;
  appsGridCols: number;
  appsLayout: "grid" | "list";
  showPlaces: boolean;
  showDesktop: boolean;
}

export const DEFAULT_HUB_SETTINGS: HubSettings = {
  placesIconSize: 22,
  desktopTextSize: 10,
  desktopIconSize: 48,
  appsGridCols: 3,
  appsLayout: "grid",
  showPlaces: true,
  showDesktop: true
};

export function clampHubValue(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const clamp = clampHubValue;

export function loadHubSettings(): HubSettings {
  try {
    const raw = localStorage.getItem(HUB_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_HUB_SETTINGS };
    const p = JSON.parse(raw);
    return {
      placesIconSize: clamp(Number(p.placesIconSize) || 22, 14, 36),
      desktopTextSize: clamp(Number(p.desktopTextSize) || 10, 8, 16),
      desktopIconSize: clamp(Number(p.desktopIconSize) || 48, 32, 72),
      appsGridCols: clamp(Number(p.appsGridCols) || 3, 2, 6),
      appsLayout: p.appsLayout === "list" ? "list" : "grid",
      showPlaces: p.showPlaces !== false,
      showDesktop: p.showDesktop !== false
    };
  } catch {
    return { ...DEFAULT_HUB_SETTINGS };
  }
}

export function saveHubSettings(settings: HubSettings) {
  try {
    localStorage.setItem(HUB_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore — settings just won't persist across reloads */
  }
  // Durable, cross-window copy — same hybrid pattern as useTheme.ts:
  // localStorage gives instant sync reads, window.vsmart gives a source
  // of truth that survives across app windows/reinstalls.
  window.vsmart?.saveMemory?.(HUB_SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
}

/**
 * Reconciles the in-memory/localStorage copy with the durable SQLite-backed
 * store. Returns the settings to apply if they differ from what's cached,
 * or null if nothing changed / the store is unavailable.
 */
export async function reconcileHubSettingsFromMemory(current: HubSettings): Promise<HubSettings | null> {
  try {
    const raw = await window.vsmart?.getMemory?.(HUB_SETTINGS_KEY);
    if (!raw || typeof raw !== "string") return null;
    const parsed = JSON.parse(raw);
    const next: HubSettings = {
      placesIconSize: clamp(Number(parsed.placesIconSize) || 22, 14, 36),
      desktopTextSize: clamp(Number(parsed.desktopTextSize) || 10, 8, 16),
      desktopIconSize: clamp(Number(parsed.desktopIconSize) || 48, 32, 72),
      appsGridCols: clamp(Number(parsed.appsGridCols) || 3, 2, 6),
      appsLayout: parsed.appsLayout === "list" ? "list" : "grid",
      showPlaces: parsed.showPlaces !== false,
      showDesktop: parsed.showDesktop !== false
    };
    if (JSON.stringify(next) === JSON.stringify(current)) return null;
    localStorage.setItem(HUB_SETTINGS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}