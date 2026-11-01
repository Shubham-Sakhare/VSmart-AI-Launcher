// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - File Summarize Agent
//
// End-to-end: find file → read it → summarize with AI → return summary.
// This is the "find my PDF and summarize it" use case.
// ═══════════════════════════════════════════════════════════════════════════

import { callChat, type ApiMessage } from "../llm/llmProvider";
import type { ReplyLang } from "../llm/openrouter";

const MAX_CONTENT_CHARS = 6000;

export async function fileSummarizeAgent(
  query:    string,
  question: string,
  lang:     ReplyLang = "en"
): Promise<string> {

  // Step 1: Find the file
  let filePath = "";
  try {
    const searchResults = await window.vsmart.fileSearch.search(query);
    if (!searchResults || searchResults.length === 0) {
      return `No file found matching "${query}". Try a more specific name.`;
    }
    filePath = searchResults[0].path;
  } catch (e) {
    return `File search failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Step 2: Read the file
  let content = "";
  try {
    const result = await window.vsmart.fileIntelligence.readFile(filePath);
    if (!result.success || !result.content) {
      return `Found "${filePath}" but could not read it: ${result.error ?? "unsupported format"}`;
    }
    content = result.content.slice(0, MAX_CONTENT_CHARS);
  } catch (e) {
    return `Failed to read file: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Step 3: Summarize with AI
  const langHint = lang === "hi"
    ? "Respond in Hindi."
    : "Respond in clear English.";

  const userQuestion = question.trim() || "Summarize this document.";

  const msgs: ApiMessage[] = [
    {
      role: "system",
      content: `You are a document analysis assistant. ${langHint}
Be concise but thorough. Extract key points and directly answer the user's question.`,
    },
    {
      role: "user",
      content: `File: ${filePath}\n\nContent:\n${content}\n\nQuestion: ${userQuestion}`,
    },
  ];

  try {
    const summary = await callChat(msgs, 1024);
    return `📄 **${filePath.split(/[/\\]/).pop()}**\n\n${summary}`;
  } catch (e) {
    return `Read the file but summarization failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
