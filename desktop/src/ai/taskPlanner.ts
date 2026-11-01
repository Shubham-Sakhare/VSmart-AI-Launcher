// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Task Planner
//
// Analyzes user requests and breaks them into executable steps.
// The planner decides: which tools are needed, in what order,
// what the dependencies are, and which steps need confirmation.
//
// Works both with LLM-powered planning and rule-based fast planning.
// ═══════════════════════════════════════════════════════════════════════════

import { callChat, type ApiMessage } from "../llm/llmProvider";
import type { TaskStep } from "../store/taskStore";

// ── Task Plan result ──────────────────────────────────────────────────────────
export interface TaskPlan {
  title:       string;
  description: string;
  steps:       Omit<TaskStep, "id" | "status">[];
  requiresConfirmation: boolean;
  estimatedDuration:    string;  // "instant" | "~5s" | "~30s" | "~2min"
}

// ── Well-known fast-path plans (no LLM needed) ────────────────────────────────
const FAST_PLANS: { pattern: RegExp; plan: (match: RegExpMatchArray) => TaskPlan }[] = [
  // Open app
  {
    pattern: /^(?:open|launch|start|kholo?)\s+(.+)$/i,
    plan: (m) => ({
      title:       `Open ${m[1]}`,
      description: `Launch ${m[1]}`,
      estimatedDuration: "instant",
      requiresConfirmation: false,
      steps: [{
        description: `Open ${m[1]}`,
        tool: "system_action",
        args: { command: `open ${m[1]}` },
      }],
    }),
  },
  // Screenshot
  {
    pattern: /screenshot/i,
    plan: () => ({
      title:       "Take Screenshot",
      description: "Capture screen",
      estimatedDuration: "instant",
      requiresConfirmation: false,
      steps: [{ description: "Capture screenshot", tool: "system_action", args: { command: "screenshot" } }],
    }),
  },
  // File search
  {
    pattern: /(?:find|search|dhundho?|khojo?)\s+(.+?)(?:\s+file|\s+document)?$/i,
    plan: (m) => ({
      title:       `Find ${m[1]}`,
      description: `Search for ${m[1]}`,
      estimatedDuration: "~5s",
      requiresConfirmation: false,
      steps: [{ description: `Search for "${m[1]}"`, tool: "file_search", args: { query: m[1] } }],
    }),
  },
  // Volume
  {
    pattern: /(?:volume|awaaz)\s+(.+)/i,
    plan: (m) => ({
      title:       `Adjust Volume`,
      description: m[0],
      estimatedDuration: "instant",
      requiresConfirmation: false,
      steps: [{ description: m[0], tool: "system_action", args: { command: m[0] } }],
    }),
  },
];

// ── Fast path for simple single-step commands ─────────────────────────────────
export function tryFastPlan(input: string): TaskPlan | null {
  for (const { pattern, plan } of FAST_PLANS) {
    const m = input.match(pattern);
    if (m) return plan(m);
  }
  return null;
}

// ── LLM-powered planning for complex tasks ────────────────────────────────────
const PLANNER_PROMPT = `You are a task planning AI. Break the user's request into sequential steps.

AVAILABLE TOOLS:
- system_action: Open apps, control volume/brightness/wifi, take screenshot, media controls
- file_search: Find files on disk by name or type
- file_read: Read content of a file (txt, pdf, docx, md)
- file_write: Create or write to a file
- web_search: Search the internet for information
- browser_open: Open a URL in the browser
- browser_automate: Automate browser actions (click, fill form, extract data)
- coding_task: Write, fix, or review code
- desktop_control: Move/click mouse, type text, press keyboard shortcuts
- vision_analyze: Analyze screenshot or image
- memory_save: Save a fact to long-term memory
- memory_get: Retrieve a fact from memory

RESPONSE FORMAT (JSON only, no other text):
{
  "title": "Short task title",
  "description": "What this task does",
  "estimatedDuration": "instant|~5s|~30s|~2min|~5min",
  "requiresConfirmation": false,
  "steps": [
    {
      "description": "Human-readable step description",
      "tool": "tool_name",
      "args": { "key": "value" }
    }
  ]
}

RULES:
- Only include steps that are truly necessary.
- Mark requiresConfirmation: true if any step is destructive or sensitive.
- estimatedDuration: be honest about complex tasks.
- Max 8 steps per plan.
- Each step must have a tool from the list above.
- For simple 1-step tasks, still wrap in the JSON structure.`;

export async function planTask(
  input: string,
  context = ""
): Promise<TaskPlan | null> {
  // Try fast path first
  const fast = tryFastPlan(input);
  if (fast) return fast;

  const msgs: ApiMessage[] = [
    { role: "system", content: PLANNER_PROMPT },
    ...(context ? [{ role: "user" as const, content: `Context: ${context}` }] : []),
    { role: "user", content: `Plan this task: ${input}` },
  ];

  try {
    const raw = await callChat(msgs, 1024);

    // Extract JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const plan = JSON.parse(jsonMatch[0]) as TaskPlan;

    // Validate
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) return null;

    return plan;
  } catch (e) {
    console.error("[Planner] Failed:", e);
    return null;
  }
}

// ── Multi-step task from natural language ─────────────────────────────────────
export async function planMultiStepTask(
  input: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<TaskPlan> {
  const contextStr = history
    .slice(-4)
    .map(h => `${h.role}: ${h.content}`)
    .join("\n");

  const plan = await planTask(input, contextStr);

  if (plan) return plan;

  // Fallback: single-step "chat" plan
  return {
    title:       input.length > 40 ? input.slice(0, 40) + "…" : input,
    description: input,
    estimatedDuration: "~5s",
    requiresConfirmation: false,
    steps: [{
      description: input,
      tool:        "chat",
      args:        { message: input },
    }],
  };
}
