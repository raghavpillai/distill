/**
 * Claude Code adapter: parses ~/.claude/projects/<slug>/<sid>.jsonl files.
 *
 * Format (one JSON record per line):
 *   { type: "user" | "assistant", message: { role, content }, sessionId, cwd, timestamp, ... }
 *
 * Multiple sessions can land in one file (rare but real), so we don't assume
 * a 1:1 file:session mapping — extract.ts groups by session_id at the end.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_ROOT, normalizeCwd, repoLabel } from "../common.ts";
import type { Turn } from "../types.ts";
import { isSubstantiveTaskPrompt } from "./filter.ts";
import type { SourceAdapter } from "./types.ts";

// Lines starting with one of these are harness output, not user intent.
const SKIP_USER_PREFIXES = [
  "<local-command-caveat>",
  "<command-name>",
  "<system-reminder>",
  "<task-notification>",
  "<background-bash-output>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<tool_result>",
  "<tool_use_error>",
  "Caveat: The messages below",
  "[Request interrupted",
];

type Block = { type?: string; text?: string };
type MsgContent = string | Block[] | undefined | null;

function contentToText(content: MsgContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const out: string[] = [];
    for (const b of content) if (b?.type === "text" && b.text) out.push(b.text);
    return out.join("\n");
  }
  return "";
}

function extractSlash(text: string): string | null {
  const tag = "<command-name>";
  const i = text.indexOf(tag);
  if (i < 0) return null;
  const start = i + tag.length;
  const end = text.indexOf("</command-name>", start);
  if (end <= start) return null;
  return text.slice(start, end).trim().replace(/^\//, "");
}

function listFiles(): string[] {
  // Only immediate <project>/<sid>.jsonl. Nested dirs are subagent transcripts
  // we deliberately don't index — they're noisy and double-count user intent.
  const files: string[] = [];
  let projects: string[] = [];
  try {
    projects = readdirSync(PROJECTS_ROOT);
  } catch {
    return files;
  }
  for (const project of projects) {
    const pdir = join(PROJECTS_ROOT, project);
    try {
      if (!statSync(pdir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const name of readdirSync(pdir)) {
      if (name.endsWith(".jsonl")) files.push(join(pdir, name));
    }
  }
  return files;
}

function parseFile(file: string): Turn[] {
  const project_dir = file.split("/").slice(-2)[0]!;
  const fileName = file.split("/").pop()!;
  const lines = readFileSync(file, "utf8").split("\n");
  const out: Turn[] = [];
  let turnIdx = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const type = rec["type"] as string | undefined;
    if (type !== "user" && type !== "assistant") continue;

    const msg = (rec["message"] ?? {}) as { role?: string; content?: MsgContent };
    const text = contentToText(msg.content).trim();
    if (!text) continue;

    const role = (msg.role as "user" | "assistant") ?? (type as "user" | "assistant");
    const isMeta = Boolean(rec["isMeta"]);
    const slash = extractSlash(text);
    const session_id = (rec["sessionId"] as string | undefined) ?? "";
    const cwd = (rec["cwd"] as string | undefined) ?? "";
    const cwd_norm = normalizeCwd(cwd);
    const repo = repoLabel(cwd_norm);

    let isUserPrompt = false;
    if (role === "user" && !isMeta) {
      const shouldSkip = SKIP_USER_PREFIXES.some((p) => text.startsWith(p));
      if (!shouldSkip) {
        isUserPrompt = isSubstantiveTaskPrompt(text, slash !== null);
      }
    }

    out.push({
      id: `${session_id || project_dir}:${turnIdx}`,
      session_id,
      project_dir,
      file: fileName,
      turn_idx: turnIdx++,
      role,
      text,
      cwd,
      cwd_norm,
      repo,
      git_branch: (rec["gitBranch"] as string | undefined) ?? "",
      timestamp: (rec["timestamp"] as string | undefined) ?? "",
      is_user_prompt: isUserPrompt,
      is_slash: slash !== null,
      slash_cmd: slash,
      is_meta: isMeta,
    });
  }
  return out;
}

export const claudeAdapter: SourceAdapter = {
  name: "claude",
  root: PROJECTS_ROOT,
  listFiles,
  parseFile,
};
