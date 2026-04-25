/**
 * Codex CLI adapter: parses ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files.
 *
 * Format (one JSON record per line):
 *   { timestamp, type: "session_meta",  payload: { id, cwd, model, ... } }
 *   { timestamp, type: "response_item", payload: { type: "message", role, content[] } }
 *   { timestamp, type: "event_msg",     payload: ... }   ← skipped (harness events)
 *
 * One file = one session in Codex (unlike Claude which can have multiple).
 * Session ids are namespaced with `codex:` so they can't collide with Claude
 * UUIDs and so downstream code can tell tools apart from a turn alone.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CODEX_SESSIONS_ROOT, normalizeCwd, repoLabel } from "../common.ts";
import type { Turn } from "../types.ts";
import { isSubstantiveTaskPrompt } from "./filter.ts";
import type { SourceAdapter } from "./types.ts";

// Codex injects these blocks at session start / each turn — they're harness,
// not user intent. Claude Code has its own equivalents handled in claude.ts.
function looksLikeHarness(text: string): boolean {
  return (
    /^#\s*AGENTS\.md instructions/i.test(text) ||
    /^<environment_context>/.test(text) ||
    /^<permissions instructions>/.test(text) ||
    /^<user_instructions>/.test(text)
  );
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith(".jsonl")) yield p;
  }
}

function listFiles(): string[] {
  return [...walk(CODEX_SESSIONS_ROOT)];
}

function parseFile(file: string): Turn[] {
  const fileName = file.split("/").pop()!;
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  let session_id = "";
  let cwd = "";
  let started_at = "";
  const out: Turn[] = [];
  let turnIdx = 0;
  for (const line of lines) {
    let rec: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type === "session_meta") {
      const p = rec.payload ?? {};
      session_id = String(p["id"] ?? "");
      cwd = String(p["cwd"] ?? "");
      started_at = String(p["timestamp"] ?? rec.timestamp ?? "");
      continue;
    }
    if (rec.type !== "response_item") continue;
    const p = rec.payload ?? {};
    if (p["type"] !== "message") continue;
    const role = p["role"] as string | undefined;
    if (role !== "user" && role !== "assistant") continue;
    const content = (p["content"] ?? []) as Array<{ type?: string; text?: string }>;
    const text = content
      .filter(
        (c) => c.type === "input_text" || c.type === "output_text" || c.type === "text",
      )
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    if (!text) continue;

    const cwd_norm = normalizeCwd(cwd);
    const repo = repoLabel(cwd_norm);
    const isUserPrompt =
      role === "user" && !looksLikeHarness(text) && isSubstantiveTaskPrompt(text, false);

    const namespacedSid = `codex:${session_id}`;
    out.push({
      id: `${namespacedSid}:${turnIdx}`,
      session_id: namespacedSid,
      project_dir: `codex/${session_id.slice(0, 8)}`,
      file: fileName,
      turn_idx: turnIdx++,
      role: role as "user" | "assistant",
      text,
      cwd,
      cwd_norm,
      repo,
      git_branch: "",
      timestamp: rec.timestamp ?? started_at,
      is_user_prompt: isUserPrompt,
      is_slash: false,
      slash_cmd: null,
      is_meta: false,
    });
  }
  return out;
}

export const codexAdapter: SourceAdapter = {
  name: "codex",
  root: CODEX_SESSIONS_ROOT,
  listFiles,
  parseFile,
};
