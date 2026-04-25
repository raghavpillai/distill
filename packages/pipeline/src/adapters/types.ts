/**
 * Source adapters: each one knows how to find and parse JSONL conversation
 * histories from a specific tool (Claude Code, Codex CLI, etc.) and emit them
 * as the standardized Turn shape used by the rest of the pipeline.
 *
 * Adding a new tool (e.g. Aider, Cursor) is a 3-step exercise:
 *   1. Implement SourceAdapter
 *   2. Export it from ./index.ts
 *   3. Done — extract.ts iterates adapters generically
 *
 * Adapters return turns with their session_id already namespaced (`codex:abc`,
 * Claude Code uses raw UUIDs since there's only one source of UUIDs there).
 * That keeps session ids unique across tools and lets downstream code (UI tree,
 * filters) look at a turn and know where it came from.
 */
import type { Turn } from "../types.ts";

export type SourceAdapter = {
  /** Short name used in logs/diagnostics (e.g. "claude", "codex"). */
  name: string;
  /** Root directory walked for this adapter's session files. */
  root: string;
  /** Return all candidate JSONL paths for this source. May be empty. */
  listFiles(): string[];
  /**
   * Parse a single JSONL file into Turn[]. Implementations must:
   *  - set `session_id` (namespaced if the source's IDs aren't globally unique)
   *  - set `is_user_prompt` (false for harness boilerplate)
   *  - set `turn_idx` to a per-file order (extract.ts re-numbers per-session later)
   *  - return an empty array on parse failure rather than throwing
   */
  parseFile(file: string): Turn[];
};
