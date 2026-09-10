const CUSTOM_ICONS_KEY = "vsmart_hub_custom_icons";

export function loadCustomIcons(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CUSTOM_ICONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCustomIcons(map: Record<string, string>) {
  try {
    localStorage.setItem(CUSTOM_ICONS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  // Durable, cross-window copy — same hybrid pattern as useTheme.ts.
  window.vsmart?.saveMemory?.(CUSTOM_ICONS_KEY, JSON.stringify(map)).catch(() => {});
}

/**
 * Reconciles the localStorage cache with the durable SQLite-backed store.
 * Returns the icon map to apply if it differs from what's cached, or null
 * if nothing changed / the store is unavailable.
 */
export async function reconcileCustomIconsFromMemory(
  current: Record<string, string>
): Promise<Record<string, string> | null> {
  try {
    const raw = await window.vsmart?.getMemory?.(CUSTOM_ICONS_KEY);
    if (!raw || typeof raw !== "string") return null;
    const next = JSON.parse(raw);
    if (JSON.stringify(next) === JSON.stringify(current)) return null;
    localStorage.setItem(CUSTOM_ICONS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}