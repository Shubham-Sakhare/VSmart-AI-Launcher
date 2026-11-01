// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - RAG Query Agent (Local, Free)
//
// Implements local Retrieval-Augmented Generation:
//   1. Read the document
//   2. Split into chunks
//   3. Find relevant chunks using TF-IDF similarity (same as memoryDB)
//   4. Feed relevant chunks to AI for answer generation
//
// No vector DB required for basic use. Works offline.
// For production-scale use, this could upgrade to Chroma/Qdrant.
// ═══════════════════════════════════════════════════════════════════════════

import { callChat, type ApiMessage } from "../llm/llmProvider";
import type { ReplyLang } from "../llm/openrouter";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Chunk {
  text:   string;
  index:  number;
  score?: number;
}

// ── Chunking ──────────────────────────────────────────────────────────────────
const CHUNK_SIZE     = 600;  // characters per chunk
const CHUNK_OVERLAP  = 100;  // overlap between adjacent chunks

function splitIntoChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;

  while (i < text.length) {
    const end   = Math.min(i + CHUNK_SIZE, text.length);
    // Try to break at sentence boundary
    let breakAt = end;
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastLine   = text.lastIndexOf("\n", end);
      breakAt = Math.max(lastPeriod, lastLine, i + CHUNK_SIZE - CHUNK_OVERLAP);
    }

    chunks.push({ text: text.slice(i, breakAt).trim(), index: chunks.length });
    i = breakAt - CHUNK_OVERLAP;
    if (i <= 0) i = end;
  }

  return chunks.filter(c => c.text.length > 50);
}

// ── TF-IDF based relevance scoring ────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0900-\u097f]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function tfIdfScore(query: string, chunk: string): number {
  const qTokens = new Set(tokenize(query));
  const cTokens = tokenize(chunk);

  if (cTokens.length === 0) return 0;

  let matches = 0;
  for (const t of cTokens) {
    if (qTokens.has(t)) matches++;
  }

  // TF = term frequency in chunk, normalized
  const tf = matches / cTokens.length;

  // Simple boost for exact phrase match
  const phraseBoost = chunk.toLowerCase().includes(query.toLowerCase().slice(0, 20)) ? 0.2 : 0;

  return tf + phraseBoost;
}

function rankChunks(query: string, chunks: Chunk[], topK = 4): Chunk[] {
  return chunks
    .map(c => ({ ...c, score: tfIdfScore(query, c.text) }))
    .filter(c => c.score! > 0)
    .sort((a, b) => b.score! - a.score!)
    .slice(0, topK);
}

// ── Main RAG agent ────────────────────────────────────────────────────────────
export async function ragQueryAgent(
  query:    string,
  docPath:  string | undefined,
  lang:     ReplyLang = "en"
): Promise<string> {

  if (!query.trim()) return "No query provided.";

  let content = "";
  let sourceName = "";

  // Read document content
  if (docPath) {
    try {
      const result = await window.vsmart.fileIntelligence.readFile(docPath);
      if (!result.success || !result.content) {
        return `Could not read document: ${result.error}`;
      }
      content    = result.content;
      sourceName = docPath.split(/[/\\]/).pop() ?? docPath;
    } catch (e) {
      return `File read error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    // No path — search for relevant files first
    try {
      const files = await window.vsmart.fileSearch.search(query);
      if (!files || files.length === 0) {
        return `No documents found for "${query}". Please specify a file path.`;
      }
      const result = await window.vsmart.fileIntelligence.readFile(files[0].path);
      if (!result.success || !result.content) {
        return `Found file but could not read it: ${result.error}`;
      }
      content    = result.content;
      sourceName = files[0].name;
    } catch (e) {
      return `Document search/read failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Chunk the document
  const chunks = splitIntoChunks(content);
  if (chunks.length === 0) {
    return "Document appears to be empty or unreadable.";
  }

  // Retrieve relevant chunks
  const relevant = rankChunks(query, chunks, 5);

  if (relevant.length === 0) {
    // No relevant chunks found — use first few chunks as context
    const fallbackChunks = chunks.slice(0, 3);
    relevant.push(...fallbackChunks);
  }

  const context = relevant
    .map((c, i) => `[Chunk ${i + 1}]:\n${c.text}`)
    .join("\n\n");

  // Generate answer with AI
  const langHint = lang === "hi"
    ? "Respond in Hindi."
    : "Respond in clear English.";

  const msgs: ApiMessage[] = [
    {
      role: "system",
      content: `You are a document Q&A assistant. ${langHint}
Answer ONLY based on the provided document chunks.
If the answer isn't in the chunks, say so honestly.
Be concise and direct.`,
    },
    {
      role: "user",
      content: `Document: ${sourceName}
Retrieved chunks:
${context}

Question: ${query}`,
    },
  ];

  try {
    const answer = await callChat(msgs, 768);
    return `📄 **${sourceName}** — RAG Answer:\n\n${answer}\n\n_Based on ${relevant.length}/${chunks.length} relevant chunks_`;
  } catch (e) {
    // Return raw context if AI fails
    return `📄 **${sourceName}**\n\nMost relevant content:\n${context.slice(0, 2000)}`;
  }
}
