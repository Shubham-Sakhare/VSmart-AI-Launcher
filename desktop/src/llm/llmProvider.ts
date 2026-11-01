// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - Unified LLM Provider
//
// Single entry point for all AI calls. Automatically selects between:
//   1. Ollama (local, free, offline) — preferred
//   2. OpenRouter (cloud, free tier) — fallback when Ollama unavailable
//
// This abstraction means you can swap models without changing agent code.
// ═══════════════════════════════════════════════════════════════════════════

import {
  isOllamaAvailable,
  getInstalledOllamaModels,
  pickBestModel,
  ollamaCall,
  ollamaStream,
  ollamaVision,
  OLLAMA_CHAT_MODELS,
  OLLAMA_CODER_MODELS,
  OLLAMA_VISION_MODELS,
} from "./ollama";

import {
  streamWithFallback,
  callWithFallback,
  getApiKey,
  askVision as openRouterVision,
  CHAT_MODELS,
  CODER_MODELS,
  VISION_MODELS,
  type ApiMessage,
  type ReplyLang,
  type ChatHistoryMessage,
} from "./openrouter";

// ── Provider state ────────────────────────────────────────────────────────────
type Provider = "ollama" | "openrouter";

interface ProviderState {
  provider:       Provider;
  ollamaChat:     string | null;
  ollamaCoder:    string | null;
  ollamaVision:   string | null;
  lastChecked:    number;
  checking:       boolean;
}

const state: ProviderState = {
  provider:    "openrouter",
  ollamaChat:  null,
  ollamaCoder: null,
  ollamaVision:null,
  lastChecked: 0,
  checking:    false,
};

const CHECK_INTERVAL = 30_000;  // Re-check Ollama every 30s

// ── Auto-detect provider ──────────────────────────────────────────────────────
export async function detectProvider(): Promise<Provider> {
  if (state.checking) return state.provider;
  if (Date.now() - state.lastChecked < CHECK_INTERVAL) return state.provider;

  state.checking   = true;
  state.lastChecked = Date.now();

  try {
    const available = await isOllamaAvailable();
    if (available) {
      const installed = await getInstalledOllamaModels();
      state.ollamaChat    = await pickBestModel(OLLAMA_CHAT_MODELS,   installed);
      state.ollamaCoder   = await pickBestModel(OLLAMA_CODER_MODELS,  installed);
      state.ollamaVision  = await pickBestModel(OLLAMA_VISION_MODELS, installed);

      if (state.ollamaChat) {
        state.provider = "ollama";
        console.log(`[LLM] Using Ollama: chat=${state.ollamaChat} coder=${state.ollamaCoder} vision=${state.ollamaVision}`);
        return "ollama";
      }
    }
  } catch { /* fall through */ }

  state.provider = "openrouter";
  console.log("[LLM] Using OpenRouter");
  return "openrouter";

  state.checking = false;
}

// ── Current provider status (for UI display) ──────────────────────────────────
export function getProviderStatus(): {
  provider:    Provider;
  chatModel:   string;
  coderModel:  string;
  visionModel: string;
  isLocal:     boolean;
} {
  if (state.provider === "ollama") {
    return {
      provider:    "ollama",
      chatModel:   state.ollamaChat   ?? "none",
      coderModel:  state.ollamaCoder  ?? (state.ollamaChat ?? "none"),
      visionModel: state.ollamaVision ?? (state.ollamaChat ?? "none"),
      isLocal:     true,
    };
  }
  return {
    provider:    "openrouter",
    chatModel:   CHAT_MODELS[0]  ?? "unknown",
    coderModel:  CODER_MODELS[0] ?? "unknown",
    visionModel: VISION_MODELS[0]?? "unknown",
    isLocal:     false,
  };
}

// ── Abort controller management ───────────────────────────────────────────────
let currentAbort: AbortController | null = null;

export function abortCurrentCall(): void {
  currentAbort?.abort();
  currentAbort = null;
}

// ── Main: streaming chat call ─────────────────────────────────────────────────
export async function streamChat(
  messages: ApiMessage[],
  onChunk: (delta: string, accumulated: string) => void,
  maxTokens = 2048
): Promise<string> {
  await detectProvider();

  currentAbort?.abort();
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  if (state.provider === "ollama" && state.ollamaChat) {
    try {
      return await ollamaStream(state.ollamaChat, messages, onChunk, maxTokens, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      console.warn("[LLM] Ollama stream failed, falling back to OpenRouter:", e);
    }
  }

  // OpenRouter fallback
  const apiKey = await getApiKey();
  return streamWithFallback(apiKey, CHAT_MODELS, messages, onChunk, maxTokens);
}

// ── Main: non-streaming chat call ─────────────────────────────────────────────
export async function callChat(
  messages: ApiMessage[],
  maxTokens = 1024
): Promise<string> {
  await detectProvider();

  if (state.provider === "ollama" && state.ollamaChat) {
    try {
      return await ollamaCall(state.ollamaChat, messages, maxTokens);
    } catch (e) {
      console.warn("[LLM] Ollama call failed, falling back to OpenRouter:", e);
    }
  }

  const apiKey = await getApiKey();
  return callWithFallback(apiKey, CHAT_MODELS, messages, maxTokens);
}

// ── Coder call ────────────────────────────────────────────────────────────────
export async function callCoder(
  messages: ApiMessage[],
  maxTokens = 2048
): Promise<string> {
  await detectProvider();

  if (state.provider === "ollama") {
    const coderModel = state.ollamaCoder ?? state.ollamaChat;
    if (coderModel) {
      try {
        return await ollamaCall(coderModel, messages, maxTokens);
      } catch (e) {
        console.warn("[LLM] Ollama coder failed:", e);
      }
    }
  }

  const apiKey = await getApiKey();
  return callWithFallback(apiKey, CODER_MODELS, messages, maxTokens);
}

// ── Vision call ───────────────────────────────────────────────────────────────
export async function callVision(
  prompt: string,
  imageDataUrl: string,
  lang: ReplyLang = "en"
): Promise<string> {
  await detectProvider();

  if (state.provider === "ollama" && state.ollamaVision) {
    try {
      // Strip data URL prefix for Ollama
      const base64 = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
      return await ollamaVision(state.ollamaVision, prompt, base64, lang);
    } catch (e) {
      console.warn("[LLM] Ollama vision failed:", e);
    }
  }

  return openRouterVision(prompt, imageDataUrl, lang);
}

// ── Re-export types for consumers ─────────────────────────────────────────────
export type { ApiMessage, ReplyLang, ChatHistoryMessage };
