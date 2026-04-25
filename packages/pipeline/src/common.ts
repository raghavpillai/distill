import { homedir } from "node:os";
import { join } from "node:path";

export const PROJECTS_ROOT = join(homedir(), ".claude", "projects");
export const DATA_DIR = new URL("../data/", import.meta.url).pathname;

const WORKTREE_RX = /(\.worktree(?:s)?\/[^/]+|\/\.claude-worktrees\/[^/]+|-worktree(?:s)?\/[^/]+)/g;

export function normalizeCwd(cwd: string): string {
  if (!cwd) return "";
  return cwd.replace(WORKTREE_RX, "").replace(/\/+$/, "");
}

export function repoLabel(cwdNorm: string): string {
  if (!cwdNorm) return "(unknown)";
  const parts = cwdNorm.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : parts[0] ?? "(unknown)";
}

export function short(t: string, n = 260): string {
  const s = t.replaceAll("\r", " ").trim();
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// Claude Code injects a handful of wrapper tags into the user's message stream
// (`<local-command-stdout>` is the output of `!shell` commands, `<system-reminder>`
// is harness nudges, etc.). These are not user intent and must be stripped before
// embedding or HDBSCAN will happily cluster unrelated prompts by their shared
// boilerplate exhaust. Keep this regex in one place so extract/embed/cluster agree.
const SYSTEM_TAG_RE =
  /<(local-command-[a-z-]+|system-reminder|command-name|command-message|command-args|task-notification|background-bash-output|bash-stdout|bash-stderr|tool_result|tool_use_error)>[\s\S]*?<\/\1>/g;

export function stripSystemTags(text: string): string {
  return text.replace(SYSTEM_TAG_RE, "").replace(/\s+\n/g, "\n").trim();
}
