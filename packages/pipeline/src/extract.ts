/**
 * Parse all ~/.claude/projects/<slug>/*.jsonl files and emit:
 *  - data/turns.json      array of Turn (full conversation history, roles + text)
 *  - data/sessions.json   array of Session
 *
 * We keep all turns (so the web UI can reconstruct a thread around a clicked point),
 * but tag only clusterable user prompts via is_user_prompt.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, PROJECTS_ROOT, normalizeCwd, repoLabel, stripSystemTags } from "./common.ts";
import type { Session, Turn } from "./types.ts";

const MIN_SUBSTANTIVE_CHARS = 30;
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

// Phrases that by themselves are not task intents — they are continuations,
// confirmations, or filler. Matched against the stripped prompt.
const CONFIRMATION_PATTERNS: RegExp[] = [
  /^(yes|yeah|yep|yup|yup\.|ok|okay|k+|sure|go|continue|proceed|cool|nice|thanks?|thank you|ty|great|perfect|good|done|right|correct|exactly|fine|works|ship it|kk|mhm|hmm+|oh|ah|hm)\b[\s.,!?👍🎉✅]*$/i,
  /^(go|just)\s+(ahead|for it|on|do it|keep going)[\s.,!?]*$/i,
  /^let'?s (go|do it|continue|try( that)?)[\s.,!?]*$/i,
  /^(that'?s )?(great|perfect|amazing|awesome|good|fine|correct|it|right|all good)[\s.,!?]*$/i,
  /^(sounds|looks)\s+(good|great|fine|right|correct)[\s.,!?]*$/i,
  /^(do|try|run|check|fix|keep going|restart|retry|continue|proceed|ship|test|push)[\s.,!?]*$/i,
  /^(what|why|how)\?[\s.,!?]*$/i,
  /^no[\s.,!?]*$/i,
  /^(makes? sense|got it|understood|i see|interesting)[\s.,!?]*$/i,
];

// Prompts that lean heavily on prior conversation context (not self-contained).
// Flag if the prompt is short AND starts with a referential/deictic lead.
const FOLLOWUP_LEADS =
  /^(now|also|then|and|but|fix|continue|keep|do|try|make|check|also,?)\b[^a-z0-9]*(it|that|this|those|them|there|again|once more)?\b/i;

function stripForAnalysis(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSubstantiveTaskPrompt(text: string, isSlash: boolean): boolean {
  if (isSlash) return false;
  // Strip Claude Code system-injected tags first so a prompt that is *entirely*
  // system exhaust (e.g. a `<local-command-stdout>` blob from a shell alias)
  // doesn't pass the substantive-length check on its boilerplate alone.
  const noTags = stripSystemTags(text);
  if (!noTags) return false;
  const stripped = stripForAnalysis(noTags);
  if (stripped.length < MIN_SUBSTANTIVE_CHARS) return false;
  if (CONFIRMATION_PATTERNS.some((rx) => rx.test(stripped))) return false;
  // Very short follow-ups that are referential filler.
  if (stripped.length < 60 && FOLLOWUP_LEADS.test(stripped)) {
    // Let it through only if it contains a concrete noun/verb beyond the lead.
    const afterLead = stripped.replace(FOLLOWUP_LEADS, "").trim();
    if (afterLead.length < 25) return false;
  }
  return true;
}

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

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith(".jsonl")) yield p;
  }
}

function listTopLevelJsonl(): string[] {
  // Only immediate <project>/<sid>.jsonl — nested dirs are subagent transcripts.
  const files: string[] = [];
  for (const project of readdirSync(PROJECTS_ROOT)) {
    const pdir = join(PROJECTS_ROOT, project);
    if (!statSync(pdir).isDirectory()) continue;
    for (const name of readdirSync(pdir)) {
      if (name.endsWith(".jsonl")) files.push(join(pdir, name));
    }
  }
  return files;
}
void walk;

function main(): void {
  const files = listTopLevelJsonl();
  console.log(`found ${files.length} jsonl files under ${PROJECTS_ROOT}`);

  const turns: Turn[] = [];
  const sessions: Session[] = [];

  for (const file of files) {
    const project_dir = file.split("/").slice(-2)[0]!;
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n");

    // Two passes: collect valid user/assistant turns per session (there's usually one session per file).
    // We accept multiple sessions per file, group by sessionId.
    const perSession = new Map<string, Turn[]>();
    let turnIdxCounter = 0;

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

      // Decide is_user_prompt eligibility (for clustering).
      // "User prompt" here means: a self-contained task intent. Slash commands,
      // confirmations, follow-ups, and system-injected messages are excluded.
      let isUserPrompt = false;
      if (role === "user" && !isMeta) {
        const shouldSkip = SKIP_USER_PREFIXES.some((p) => text.startsWith(p));
        if (!shouldSkip) {
          isUserPrompt = isSubstantiveTaskPrompt(text, slash !== null);
        }
      }

      const turnIdx = turnIdxCounter++;
      const id = `${session_id || project_dir}:${turnIdx}`;
      const turn: Turn = {
        id,
        session_id,
        project_dir,
        file: file.split("/").pop()!,
        turn_idx: turnIdx,
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
      };
      const arr = perSession.get(session_id) ?? [];
      arr.push(turn);
      perSession.set(session_id, arr);
    }

    for (const [sid, arr] of perSession) {
      if (!arr.length) continue;
      // Sort by timestamp when present, else by turn_idx.
      arr.sort((a, b) =>
        a.timestamp && b.timestamp
          ? a.timestamp.localeCompare(b.timestamp)
          : a.turn_idx - b.turn_idx,
      );
      // Re-number turn_idx per session, then rebuild id.
      arr.forEach((t, i) => {
        t.turn_idx = i;
        t.id = `${sid || project_dir}:${i}`;
      });
      const session: Session = {
        session_id: sid || `${project_dir}-${arr[0]!.file}`,
        project_dir,
        repo: arr[0]!.repo,
        cwd: arr[0]!.cwd,
        started_at: arr[0]!.timestamp,
        ended_at: arr[arr.length - 1]!.timestamp,
        turn_ids: arr.map((t) => t.id),
      };
      sessions.push(session);
      turns.push(...arr);
    }
  }

  // Dedupe user prompts across sessions (same text in same session is rare but possible).
  const seen = new Set<string>();
  for (const t of turns) {
    if (!t.is_user_prompt) continue;
    const key = `${t.session_id}::${t.text}`;
    if (seen.has(key)) {
      t.is_user_prompt = false;
      continue;
    }
    seen.add(key);
  }

  const nUserPrompts = turns.filter((t) => t.is_user_prompt).length;
  console.log(
    `parsed ${turns.length} turns across ${sessions.length} sessions; ${nUserPrompts} clusterable user prompts`,
  );

  writeFileSync(`${DATA_DIR}turns.json`, JSON.stringify(turns));
  writeFileSync(`${DATA_DIR}sessions.json`, JSON.stringify(sessions));
  console.log(`wrote ${DATA_DIR}turns.json and ${DATA_DIR}sessions.json`);
}

main();
