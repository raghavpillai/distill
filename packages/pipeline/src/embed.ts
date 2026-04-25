/**
 * Embed all clusterable user-prompt turns. Provider is controlled by CCC_PROVIDER
 * (default: ollama / qwen3-embedding:8b).
 *
 * Inputs:  data/turns.json
 * Outputs: data/embeddings.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { embedMany } from "ai";
import { DATA_DIR, stripSystemTags } from "./common.ts";
import { embedInfo, embedModel, isQwen3Embedding } from "./ai.ts";
import type { Turn } from "./types.ts";

const MAX_CHARS = 3000;
const BATCH = 32;

const CLUSTER_INSTRUCTION =
  "Given a developer's message to an AI coding assistant, represent its intent " +
  "(what the developer is asking the assistant to do) so that messages with similar " +
  "intents cluster together.";

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const half = Math.floor(MAX_CHARS / 2);
  return text.slice(0, half) + "\n...[truncated]...\n" + text.slice(-half);
}

function applyInstruction(texts: string[]): string[] {
  // Qwen3-embedding expects "Instruct: <task>\nQuery: <text>".
  // OpenAI / other providers don't use an instruction prefix for pure clustering.
  if (!isQwen3Embedding()) return texts;
  return texts.map((t) => `Instruct: ${CLUSTER_INSTRUCTION}\nQuery: ${t}`);
}

async function main(): Promise<void> {
  const turns = JSON.parse(readFileSync(`${DATA_DIR}turns.json`, "utf8")) as Turn[];
  const userPrompts = turns.filter((t) => t.is_user_prompt);
  const info = embedInfo();
  console.log(
    `embedding ${userPrompts.length} user prompts via ${info.provider}:${info.model} (batch=${BATCH})`,
  );

  // Sanitize BEFORE embedding: Claude Code's system-injected tags
  // (<local-command-stdout>, <system-reminder>, etc.) are shared boilerplate that
  // will pull unrelated prompts into the same cluster if left in place.
  const ids = userPrompts.map((t) => t.id);
  const values = applyInstruction(
    userPrompts.map((t) => truncate(stripSystemTags(t.text) || t.text)),
  );
  const model = embedModel();

  // Stream batches through embedMany so the SDK handles parallelism + retries
  // while we still get progress output.
  const vectors: number[][] = [];
  const t0 = Date.now();
  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH);
    const res = await embedMany({ model, values: batch });
    vectors.push(...res.embeddings);
    const done = Math.min(i + BATCH, values.length);
    const dt = (Date.now() - t0) / 1000;
    const rate = done / dt;
    const eta = (values.length - done) / rate;
    process.stdout.write(
      `\r  ${done}/${values.length}  ${rate.toFixed(1)} prompts/s  eta ${eta.toFixed(0)}s   `,
    );
  }
  process.stdout.write("\n");

  if (vectors.length !== ids.length)
    throw new Error(`vector/id length mismatch: ${vectors.length} vs ${ids.length}`);

  const dim = vectors[0]?.length ?? 0;
  const payload = { model: `${info.provider}:${info.model}`, dim, ids, vectors };
  writeFileSync(`${DATA_DIR}embeddings.json`, JSON.stringify(payload));
  console.log(`wrote ${DATA_DIR}embeddings.json  (${ids.length} × ${dim})`);
}

await main();
