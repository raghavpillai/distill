/**
 * Provider dispatch for chat + embeddings.
 *
 * Default stack is local Ollama. Set CCC_PROVIDER to flip everything:
 *   CCC_PROVIDER=openai         → gpt-4.1 chat + text-embedding-3-large
 *   CCC_PROVIDER=anthropic      → claude chat + (falls back to Ollama for embeddings,
 *                                   since Anthropic has no embeddings API)
 *   CCC_PROVIDER=codex          → gpt-5.4-codex chat (via OpenAI API) + text-embedding-3-large
 *                                   (codex is a code-tuned GPT-5 family model on the OpenAI API)
 *
 * Fine-grained overrides:
 *   CCC_CHAT_PROVIDER, CCC_EMBED_PROVIDER, CCC_CHAT_MODEL, CCC_EMBED_MODEL
 *   OLLAMA_HOST, OPENAI_BASE_URL (accepted by @ai-sdk/openai for OpenAI-compatible servers)
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";
import { createOllama } from "ollama-ai-provider-v2";

export type ProviderName = "ollama" | "openai" | "anthropic" | "codex";

const DEFAULTS: Record<ProviderName, { chat: string; embed: string }> = {
  ollama: { chat: "qwen2.5:14b-instruct", embed: "qwen3-embedding:8b" },
  openai: { chat: "gpt-5.4", embed: "text-embedding-3-large" },
  anthropic: { chat: "claude-sonnet-4-6", embed: "" },
  // Codex models are GPT-5-family code-tuned variants served on the OpenAI API
  // through the Responses endpoint (the SDK's languageModel() auto-routes them).
  // Embedding side reuses OpenAI's text-embedding-3-large since "codex" is a
  // chat/reasoning specialization, not an embedding family. Bump the default
  // when newer codex models become available on your key (gpt-5.4-codex,
  // gpt-5.5-codex, etc.).
  codex: { chat: "gpt-5.3-codex", embed: "text-embedding-3-large" },
};

const PROVIDER = (process.env.CCC_PROVIDER ?? "ollama") as ProviderName;
const CHAT_PROVIDER = (process.env.CCC_CHAT_PROVIDER ?? PROVIDER) as ProviderName;
// Anthropic has no embeddings; default the embed side to Ollama so a pure
// anthropic flip doesn't crash on embed.ts. Codex routes through OpenAI for
// embeddings since it shares the same API (just a different chat model).
const EMBED_PROVIDER = (process.env.CCC_EMBED_PROVIDER ??
  (PROVIDER === "anthropic"
    ? "ollama"
    : PROVIDER === "codex"
      ? "openai"
      : PROVIDER)) as ProviderName;

function ollamaBase(): string {
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  return host.endsWith("/api") ? host : `${host}/api`;
}

function ollamaFactory() {
  return createOllama({ baseURL: ollamaBase() });
}

export function chatModel(modelOverride?: string): LanguageModelV3 {
  const id = modelOverride || process.env.CCC_CHAT_MODEL || DEFAULTS[CHAT_PROVIDER].chat;
  switch (CHAT_PROVIDER) {
    case "ollama":
      return ollamaFactory().languageModel(id);
    // codex shares the OpenAI HTTP API; only the model id differs.
    case "openai":
    case "codex": {
      const base = process.env.OPENAI_BASE_URL;
      const client = base ? createOpenAI({ baseURL: base }) : createOpenAI();
      return client.languageModel(id);
    }
    case "anthropic":
      return createAnthropic().languageModel(id);
  }
}

export function embedModel(modelOverride?: string): EmbeddingModelV3 {
  if (EMBED_PROVIDER === "anthropic") {
    throw new Error(
      "Anthropic does not offer an embeddings API. Set CCC_EMBED_PROVIDER=ollama or openai.",
    );
  }
  if (EMBED_PROVIDER === "codex") {
    throw new Error(
      "codex is a chat-model family with no dedicated embeddings; the default embed provider for CCC_PROVIDER=codex is openai. If you set CCC_EMBED_PROVIDER=codex explicitly, switch it to openai or ollama.",
    );
  }
  const id = modelOverride || process.env.CCC_EMBED_MODEL || DEFAULTS[EMBED_PROVIDER].embed;
  switch (EMBED_PROVIDER) {
    case "ollama":
      return ollamaFactory().textEmbeddingModel(id);
    case "openai": {
      const base = process.env.OPENAI_BASE_URL;
      const client = base ? createOpenAI({ baseURL: base }) : createOpenAI();
      return client.textEmbeddingModel(id);
    }
  }
  throw new Error(`unreachable embed provider ${EMBED_PROVIDER as string}`);
}

export function chatInfo(): { provider: ProviderName; model: string } {
  return {
    provider: CHAT_PROVIDER,
    model: process.env.CCC_CHAT_MODEL || DEFAULTS[CHAT_PROVIDER].chat,
  };
}

export function embedInfo(): { provider: ProviderName; model: string } {
  return {
    provider: EMBED_PROVIDER,
    model: process.env.CCC_EMBED_MODEL || DEFAULTS[EMBED_PROVIDER].embed,
  };
}

// The Qwen3-embedding-specific instruction prefix is handled in embed.ts; we
// re-export a helper so suggest.ts / label.ts don't need to know.
export function isQwen3Embedding(): boolean {
  const { model } = embedInfo();
  return /^qwen3-embedding/i.test(model);
}
