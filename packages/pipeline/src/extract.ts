/**
 * Walk every source adapter (Claude Code, Codex CLI, …), collect Turn[]s,
 * then group by session_id, sort, dedupe duplicate user prompts, and write:
 *   - data/turns.json       full conversation history per source
 *   - data/sessions.json    per-session metadata for the UI drawer
 *
 * All source-specific quirks (file format, harness boilerplate, prefix tags)
 * live inside the adapters under ./adapters/. extract.ts is just the
 * orchestrator that runs each adapter and merges the results.
 */
import { writeFileSync } from "node:fs";
import { DATA_DIR } from "./common.ts";
import type { Session, Turn } from "./types.ts";
import { ADAPTERS } from "./adapters/index.ts";

function main(): void {
  const turns: Turn[] = [];

  for (const adapter of ADAPTERS) {
    const files = adapter.listFiles();
    if (files.length === 0) {
      console.log(`${adapter.name}: no files at ${adapter.root}`);
      continue;
    }
    let count = 0;
    for (const file of files) {
      const fileTurns = adapter.parseFile(file);
      count += fileTurns.length;
      turns.push(...fileTurns);
    }
    console.log(`${adapter.name}: ${count} turns from ${files.length} files (${adapter.root})`);
  }

  // Group by session_id (turns from any source can share this map; ids are
  // already namespaced where needed by the adapters), then sort each session
  // by timestamp (or turn_idx as fallback) and re-number turn_idx 0…N-1.
  const perSession = new Map<string, Turn[]>();
  for (const t of turns) {
    const key = t.session_id || `${t.project_dir}/${t.file}`;
    const arr = perSession.get(key) ?? [];
    arr.push(t);
    perSession.set(key, arr);
  }

  const sessions: Session[] = [];
  const allTurns: Turn[] = [];
  for (const [sid, arr] of perSession) {
    if (!arr.length) continue;
    arr.sort((a, b) =>
      a.timestamp && b.timestamp
        ? a.timestamp.localeCompare(b.timestamp)
        : a.turn_idx - b.turn_idx,
    );
    arr.forEach((t, i) => {
      t.turn_idx = i;
      t.id = `${sid}:${i}`;
    });
    sessions.push({
      session_id: sid,
      project_dir: arr[0]!.project_dir,
      repo: arr[0]!.repo,
      cwd: arr[0]!.cwd,
      started_at: arr[0]!.timestamp,
      ended_at: arr[arr.length - 1]!.timestamp,
      turn_ids: arr.map((t) => t.id),
    });
    allTurns.push(...arr);
  }

  // Dedupe user prompts that repeat verbatim in the same session (rare but
  // happens, e.g. a user pastes the same instruction twice). Keep the first.
  const seen = new Set<string>();
  for (const t of allTurns) {
    if (!t.is_user_prompt) continue;
    const key = `${t.session_id}::${t.text}`;
    if (seen.has(key)) {
      t.is_user_prompt = false;
      continue;
    }
    seen.add(key);
  }

  const userPrompts = allTurns.filter((t) => t.is_user_prompt).length;
  const bySource = ADAPTERS.map((a) => {
    const prefix = a.name === "claude" ? "" : `${a.name}:`;
    const n = allTurns.filter((t) =>
      a.name === "claude"
        ? !t.session_id.startsWith("codex:") /* claude uses raw UUIDs */
        : t.session_id.startsWith(prefix),
    ).length;
    return `${a.name}=${n}`;
  }).join(" ");
  console.log(
    `parsed ${allTurns.length} turns (${bySource}) across ${sessions.length} sessions; ${userPrompts} clusterable user prompts`,
  );

  writeFileSync(`${DATA_DIR}turns.json`, JSON.stringify(allTurns));
  writeFileSync(`${DATA_DIR}sessions.json`, JSON.stringify(sessions));
  console.log(`wrote ${DATA_DIR}turns.json and ${DATA_DIR}sessions.json`);
}

main();
