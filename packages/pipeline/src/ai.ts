/**
 * Provider dispatch for chat + embeddings.
 *
 * Default stack is local Ollama. Set CCC_PROVIDER to flip everything:
 *   CCC_PROVIDER=openai         → gpt-4.1 chat + text-embedding-3-large
 *   CCC_PROVIDER=anthropic      → claude chat + (falls back to Ollama for embeddings,
 *                                   since Anthropic has no embeddings API)
 *
 * Fine-grained overrides:
 *   CCC_CHAT_PROVIDER, CCC_EMBED_PROVIDER, CCC_CHAT_MODEL, CCC_EMBED_MODEL
 *   OLLAMA_HOST, OPENAI_BASE_URL (accepted by @ai-sdk/openai for OpenAI-compatible servers)
 */
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";

export type ProviderName = "ollama" | "openai" | "anthropic";

const DEFAULTS: Record<ProviderName, { chat: string; embed: string }> = {
  ollama: { chat: "qwen2.5:14b-instruct", embed: "qwen3-embedding:8b" },
  openai: { chat: "gpt-4.1-mini", embed: "text-embedding-3-large" },
  anthropic: { chat: "claude-sonnet-4-6", embed: "" },
};

const PROVIDER = (process.env["CCC_PROVIDER"] ?? "ollama") as ProviderName;
const CHAT_PROVIDER = (process.env["CCC_CHAT_PROVIDER"] ?? PROVIDER) as ProviderName;
// Anthropic has no embeddings; default the embed side to Ollama so a pure
// anthropic flip doesn't crash on embed.ts.
const EMBED_PROVIDER = (process.env["CCC_EMBED_PROVIDER"] ??
  (PROVIDER === "anthropic" ? "ollama" : PROVIDER)) as ProviderName;

function ollamaBase(): string {
  const host = process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
  return host.endsWith("/api") ? host : `${host}/api`;
}

function ollamaFactory() {
  return createOllama({ baseURL: ollamaBase() });
}

export function chatModel(modelOverride?: string): LanguageModelV3 {
  const id =
    modelOverride ||
    process.env["CCC_CHAT_MODEL"] ||
    DEFAULTS[CHAT_PROVIDER].chat;
  switch (CHAT_PROVIDER) {
    case "ollama":
      return ollamaFactory().languageModel(id);
    case "openai": {
      const base = process.env["OPENAI_BASE_URL"];
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
  const id =
    modelOverride ||
    process.env["CCC_EMBED_MODEL"] ||
    DEFAULTS[EMBED_PROVIDER].embed;
  switch (EMBED_PROVIDER) {
    case "ollama":
      return ollamaFactory().textEmbeddingModel(id);
    case "openai": {
      const base = process.env["OPENAI_BASE_URL"];
      const client = base ? createOpenAI({ baseURL: base }) : createOpenAI();
      return client.textEmbeddingModel(id);
    }
  }
  throw new Error(`unreachable embed provider ${EMBED_PROVIDER as string}`);
}

export function chatInfo(): { provider: ProviderName; model: string } {
  return {
    provider: CHAT_PROVIDER,
    model: process.env["CCC_CHAT_MODEL"] || DEFAULTS[CHAT_PROVIDER].chat,
  };
}

export function embedInfo(): { provider: ProviderName; model: string } {
  return {
    provider: EMBED_PROVIDER,
    model: process.env["CCC_EMBED_MODEL"] || DEFAULTS[EMBED_PROVIDER].embed,
  };
}

// The Qwen3-embedding-specific instruction prefix is handled in embed.ts; we
// re-export a helper so suggest.ts / label.ts don't need to know.
export function isQwen3Embedding(): boolean {
  const { model } = embedInfo();
  return /^qwen3-embedding/i.test(model);
}
