// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Web Search Agent
//
// Searches the internet and returns a concise, AI-synthesized answer.
//
// Uses SearXNG (free, open-source, self-hostable metasearch engine) or
// falls back to DuckDuckGo instant answers (free API, no key needed).
//
// ₹0 cost. No API key required.
// ═══════════════════════════════════════════════════════════════════════════

import { callChat, type ApiMessage } from "../llm/llmProvider";
import type { ReplyLang } from "../llm/openrouter";

// ── DuckDuckGo Instant Answer API (completely free) ───────────────────────────
const DDG_API = "https://api.duckduckgo.com/";

interface DDGResult {
  Abstract?:         string;
  AbstractText?:     string;
  AbstractSource?:   string;
  AbstractURL?:      string;
  Answer?:           string;
  AnswerType?:       string;
  Definition?:       string;
  DefinitionURL?:    string;
  RelatedTopics?:    { Text?: string; FirstURL?: string }[];
  Results?:          { Text?: string; FirstURL?: string }[];
  Type?:             string;
}

async function ddgInstantAnswer(query: string): Promise<string[]> {
  try {
    const url = `${DDG_API}?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data: DDGResult = await res.json();
    const snippets: string[] = [];

    if (data.Answer)        snippets.push(`Answer: ${data.Answer}`);
    if (data.AbstractText)  snippets.push(`${data.AbstractText} (${data.AbstractURL ?? data.AbstractSource ?? "DDG"})`);
    if (data.Definition)    snippets.push(`Definition: ${data.Definition} (${data.DefinitionURL ?? ""})`);

    const topics = [...(data.RelatedTopics ?? []), ...(data.Results ?? [])];
    for (const t of topics.slice(0, 5)) {
      if (t.Text) snippets.push(`• ${t.Text}${t.FirstURL ? ` [${t.FirstURL}]` : ""}`);
    }

    return snippets;
  } catch {
    return [];
  }
}

// ── DuckDuckGo HTML scrape for richer results (fallback) ─────────────────────
async function ddgWebSnippets(query: string): Promise<string[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VSmart-JARVIS/1.0)" },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const html  = await res.text();
    const snippets: string[] = [];

    // Extract result titles and snippets
    const titleRe   = /<a class="result__a"[^>]*>([^<]+)<\/a>/g;
    const snippetRe = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;
    const titles:   string[] = [];
    const snips:    string[] = [];

    let m: RegExpExecArray | null;
    while ((m = titleRe.exec(html)) !== null && titles.length < 6) {
      titles.push(m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&"));
    }
    while ((m = snippetRe.exec(html)) !== null && snips.length < 6) {
      snips.push(m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&"));
    }

    for (let i = 0; i < Math.min(titles.length, snips.length, 5); i++) {
      snippets.push(`[${i + 1}] ${titles[i]}: ${snips[i]}`);
    }

    return snippets;
  } catch {
    return [];
  }
}

// ── Main web search agent ─────────────────────────────────────────────────────
export async function webSearchAgent(
  query: string,
  lang:  ReplyLang = "en"
): Promise<string> {

  if (!query.trim()) return "No search query provided.";

  // Try instant answers first (fast, accurate for facts/definitions)
  let snippets = await ddgInstantAnswer(query);

  // Fall back to HTML scrape for richer results
  if (snippets.length < 2) {
    const webSnips = await ddgWebSnippets(query);
    snippets = [...snippets, ...webSnips];
  }

  if (snippets.length === 0) {
    return `Web search for "${query}" returned no results. Try rephrasing.`;
  }

  const langHint = lang === "hi" ? "Respond in Hindi." : "Respond in English.";

  // Synthesize answer with AI
  const msgs: ApiMessage[] = [
    {
      role: "system",
      content: `You are a research assistant. ${langHint}
Based on the search results provided, give a concise, accurate answer to the query.
Mention sources when relevant. Don't pad. Be direct.`,
    },
    {
      role: "user",
      content: `Query: ${query}\n\nSearch Results:\n${snippets.join("\n")}`,
    },
  ];

  try {
    const answer = await callChat(msgs, 512);
    return `🌐 **Web Search**: "${query}"\n\n${answer}`;
  } catch {
    // If AI synthesis fails, return raw snippets
    return `🌐 **"${query}"**\n\n${snippets.join("\n")}`;
  }
}
