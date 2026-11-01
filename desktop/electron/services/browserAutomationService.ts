// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Browser Automation Service (Electron Main Process)
//
// Uses Playwright to automate browser tasks:
//   • Open URLs
//   • Search websites
//   • Click elements
//   • Fill forms
//   • Extract text/data
//   • Take page screenshots
//
// Playwright is FREE and open-source. Browser: Chromium (bundled free).
// ═══════════════════════════════════════════════════════════════════════════

import { app }     from "electron";
import path        from "path";
import fs          from "fs";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BrowserTask {
  task:  string;   // Natural language task description
  url?:  string;   // Starting URL (optional)
}

export interface BrowserResult {
  success:  boolean;
  url?:     string;
  title?:   string;
  content?: string;
  data?:    unknown;
  error?:   string;
}

// ── Playwright availability check ─────────────────────────────────────────────
let playwrightAvailable: boolean | null = null;

async function checkPlaywright(): Promise<boolean> {
  if (playwrightAvailable !== null) return playwrightAvailable;
  try {
    await import("playwright");
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
    console.warn("[Browser] Playwright not installed. Run: npm install playwright && npx playwright install chromium");
  }
  return playwrightAvailable;
}

// ── Browser instance management ───────────────────────────────────────────────
let browserInstance: import("playwright").Browser | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  const pw = await import("playwright");

  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  // User data dir for persistent sessions
  const userDataDir = path.join(app.getPath("userData"), "browser-profile");
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  browserInstance = await pw.chromium.launch({
    headless:        false,  // Visible browser (user can see what AI is doing)
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  browserInstance.on("disconnected", () => { browserInstance = null; });

  return browserInstance;
}

// ── Close browser ─────────────────────────────────────────────────────────────
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// ── Content extraction helpers ────────────────────────────────────────────────
async function extractMainContent(page: import("playwright").Page): Promise<string> {
  return page.evaluate(() => {
    // Remove noise elements
    ["nav","header","footer","script","style","aside","iframe","noscript",
     ".ad","#ad","[class*='ad-']","[id*='ad-']","[class*='cookie']",
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Try article/main first
    const main = document.querySelector("article,main,[role='main'],.content,.post");
    const src  = main ?? document.body;

    return (src?.innerText ?? "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 5000);
  });
}

// ── Main task executor ────────────────────────────────────────────────────────
export async function automateBrowser(task: BrowserTask): Promise<BrowserResult> {
  const available = await checkPlaywright();
  if (!available) {
    // Fallback: just open the URL with shell open
    if (task.url) {
      const { shell } = await import("electron");
      await shell.openExternal(task.url);
      return { success: true, url: task.url, content: `Opened ${task.url} in default browser.` };
    }
    return { success: false, error: "Playwright not installed. Install it for browser automation." };
  }

  let page: import("playwright").Page | null = null;

  try {
    const browser = await getBrowser();
    const ctx     = await browser.newContext({
      viewport:   { width: 1280, height: 800 },
      userAgent:  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      locale:     "en-IN",
    });
    page = await ctx.newPage();

    const lo   = task.task.toLowerCase();
    const tUrl = task.url ?? "";

    // ── Route task ───────────────────────────────────────────────────────

    // 1. Open URL directly
    if (tUrl && /^https?:\/\//i.test(tUrl)) {
      await page.goto(tUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      const title   = await page.title();
      const content = await extractMainContent(page);
      return { success: true, url: page.url(), title, content };
    }

    // 2. YouTube search
    if (/youtube/.test(lo) && /search|find|play/i.test(lo)) {
      const q = extractSearchQuery(task.task, "youtube");
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const title = await page.title();
      // Extract video titles
      const videos = await page.$$eval("ytd-video-renderer #video-title", (els) =>
        (els as HTMLElement[]).slice(0, 5).map(el => el.textContent?.trim() ?? "")
      ).catch(() => [] as string[]);
      return { success: true, url: page.url(), title, content: `YouTube results:\n${videos.join("\n")}` };
    }

    // 3. Google search
    if (/google|search/i.test(lo) || (lo.includes("search") && !tUrl)) {
      const q = extractSearchQuery(task.task, "google");
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const title = await page.title();
      // Extract search result snippets
      const results = await page.$$eval("div.BNeawe, span.BNeawe", (els) =>
        (els as HTMLElement[]).slice(0, 6).map(el => el.textContent?.trim() ?? "").filter(t => t.length > 30)
      ).catch(() => [] as string[]);
      return { success: true, url: page.url(), title, content: results.join("\n") };
    }

    // 4. Open a website by name
    if (/open|go to|navigate|visit/i.test(lo)) {
      const site = extractSiteName(task.task);
      if (site) {
        const url = site.includes(".") ? `https://${site}` : `https://www.${site}.com`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        const title   = await page.title();
        const content = await extractMainContent(page);
        return { success: true, url: page.url(), title, content };
      }
    }

    // 5. Read/extract page content (given URL)
    if (tUrl) {
      const urlToOpen = /^https?:\/\//i.test(tUrl) ? tUrl : `https://${tUrl}`;
      await page.goto(urlToOpen, { waitUntil: "domcontentloaded", timeout: 15000 });
      const title   = await page.title();
      const content = await extractMainContent(page);
      return { success: true, url: page.url(), title, content };
    }

    // 6. Generic: open browser with a web search
    const searchQ = task.task;
    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(searchQ)}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    const title   = await page.title();
    const content = await extractMainContent(page);
    return { success: true, url: page.url(), title, content };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Browser] Task failed:", msg);
    return { success: false, error: msg };
  } finally {
    // Close page but keep browser open for next task
    await page?.close().catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractSearchQuery(task: string, platform: string): string {
  // Remove platform name and action words to get the clean query
  return task
    .replace(new RegExp(platform, "gi"), "")
    .replace(/\b(search|find|look up|look for|play|open|on|in|at|using)\b/gi, "")
    .trim() || task;
}

function extractSiteName(task: string): string | null {
  // "open youtube.com" → "youtube.com"
  const m = task.match(/(?:open|go to|visit|navigate to)\s+([a-z0-9.-]+\.[a-z]{2,})/i)
    ?? task.match(/(?:open|go to|visit|navigate to)\s+([a-z0-9]+)/i);
  return m?.[1] ?? null;
}
