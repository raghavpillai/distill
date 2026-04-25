/**
 * Load the user's already-installed Claude Code skills from ~/.claude/skills/,
 * embed each skill's workflow SHAPE (name + description + body: trigger + steps +
 * avoid-when), and expose a helper that tells us whether a proposed skill
 * overlaps with any of them.
 *
 * Why shape, not topic: two workflows that share vocabulary (e.g. "code",
 * "findings", "security") are not necessarily the same skill. Embedding the
 * trigger and avoid-when pulls the vector toward WHAT the workflow does, which
 * is what actually discriminates (e.g. vulnerability research vs diff review).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { embedMany } from "ai";
import { embedModel } from "./ai.ts";

export type InstalledSkill = {
  name: string;
  description: string;
  body: string; // markdown body after frontmatter; contains trigger, steps, avoid-when
  path: string;
};

export type InstalledSkillIndex = {
  skills: InstalledSkill[];
  vectors: number[][]; // parallel to skills; normalized
};

const BODY_BUDGET = 900;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function parseSkillMd(md: string): { name: string; description: string; body: string } {
  const match = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { name: "", description: "", body: md.trim() };
  const fmBody = match[1] ?? "";
  let name = "";
  let description = "";
  for (const line of fmBody.split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const k = kv[1]!.toLowerCase();
    const v = (kv[2] ?? "").trim().replace(/^["'](.*)["']$/, "$1");
    if (k === "name") name = v;
    else if (k === "description") description = v;
  }
  const body = md.slice(match[0].length).trim();
  return { name, description, body };
}

function shapeTextInstalled(s: InstalledSkill): string {
  const parts = [`${s.name}: ${s.description}`];
  if (s.body) parts.push(truncate(s.body, BODY_BUDGET));
  return parts.join("\n\n");
}

function shapeTextProposal(p: {
  name: string;
  description: string;
  when_to_use?: string;
  when_not_to_use?: string;
  body_md?: string;
}): string {
  const parts = [`${p.name}: ${p.description}`];
  if (p.when_to_use) parts.push(`Use when: ${p.when_to_use}`);
  if (p.when_not_to_use) parts.push(`Do NOT use when: ${p.when_not_to_use}`);
  if (p.body_md) parts.push(truncate(p.body_md, BODY_BUDGET));
  return parts.join("\n\n");
}

function findSkillFiles(dir: string): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillMd = join(full, "SKILL.md");
    try {
      const md = readFileSync(skillMd, "utf8");
      const parsed = parseSkillMd(md);
      if (!parsed.name) continue;
      out.push({
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        path: skillMd,
      });
    } catch {
      // no SKILL.md in this directory — skip
    }
  }
  return out;
}

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) + 1e-12;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export async function loadInstalledSkills(): Promise<InstalledSkillIndex> {
  const dir = join(homedir(), ".claude", "skills");
  const skills = findSkillFiles(dir);
  if (skills.length === 0) return { skills: [], vectors: [] };
  const model = embedModel();
  const values = skills.map(shapeTextInstalled);
  const { embeddings } = await embedMany({ model, values });
  const vectors = embeddings.map((v) => normalize(v));
  return { skills, vectors };
}

export type DuplicateMatch = {
  name: string;
  similarity: number;
};

// Threshold is set higher than the old name-only check (0.88) because the
// payload is richer — true duplicates still clear the bar (they match on
// description + trigger + body), but topic-only collisions fall below.
const DUP_THRESHOLD = 0.9;

export async function findDuplicate(
  index: InstalledSkillIndex,
  proposal: {
    name: string;
    description: string;
    when_to_use?: string;
    when_not_to_use?: string;
    body_md?: string;
  },
  threshold = DUP_THRESHOLD,
): Promise<DuplicateMatch | null> {
  if (index.skills.length === 0) return null;
  const model = embedModel();
  const value = shapeTextProposal(proposal);
  const { embeddings } = await embedMany({ model, values: [value] });
  const v = normalize(embeddings[0]!);
  let best: DuplicateMatch | null = null;
  for (let i = 0; i < index.skills.length; i++) {
    const sim = cosine(v, index.vectors[i]!);
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { name: index.skills[i]!.name, similarity: sim };
    }
    // Exact-name match is a guaranteed duplicate regardless of embedding.
    if (index.skills[i]!.name === proposal.name) {
      best = { name: index.skills[i]!.name, similarity: 1.0 };
    }
  }
  return best;
}
