/**
 * For each candidate cluster, ask the chat model whether the recurring pattern
 * represents a real, specific Claude Code skill — and if so, draft a
 * high-quality SKILL.md.
 *
 * Uses AI SDK's generateObject with a strict Zod schema: no manual JSON parsing,
 * automatic retries on malformed output.
 *
 * Quality gates (post-validation) beyond the model's own yes/no:
 *  - name must not collide with a bundled Claude Code skill
 *  - name must not be a bare weak verb ("test", "check", ...)
 *  - body must have ≥3 numbered steps
 *  - specificity ≥3
 *  - must have when_to_use AND when_not_to_use
 */
import { readFileSync, writeFileSync } from "node:fs";
import { embedMany, generateObject } from "ai";
import { z } from "zod";
import { DATA_DIR } from "./common.ts";
import { chatInfo, chatModel, embedModel } from "./ai.ts";
import { findDuplicate, loadInstalledSkills } from "./skill_diff.ts";
import type { Cluster, SkillProposal } from "./types.ts";

const OUT = `${DATA_DIR}skills.json`;

const BUNDLED_SKILLS = [
  // skill-style plugins
  "commit",
  "review",
  "debug",
  "simplify",
  "loop",
  "init",
  "security-review",
  "claude-api",
  "batch",
  "explain-code",
  "explain",
  "fewer-permission-prompts",
  "statusline-setup",
  "update-config",
  "keybindings-help",
  "schedule",
  "pull-request",
  "code-review",
  "humanizer",
  "frontend-design",
  "webapp-testing",
  "git-commit",
  "gencommit",
  // Claude Code built-in slash commands — proposing a skill that just wraps
  // any of these is a waste (the CLI already dispatches them directly).
  "clear",
  "compact",
  "config",
  "cost",
  "help",
  "login",
  "logout",
  "mcp",
  "memory",
  "model",
  "permissions",
  "pr-comments",
  "pr_comments",
  "release-notes",
  "resume",
  "status",
  "terminal-setup",
  "vim",
  "export",
  "bug",
];

const WEAK_NAME_TOKENS = new Set([
  "test",
  "check",
  "run",
  "fix",
  "verify",
  "review",
  "setup",
  "build",
  "deploy",
  "clean",
  "push",
  "update",
  "list",
]);

const proposalSchema = z.object({
  accepted: z.boolean().describe("true only if this cluster is a real multi-step workflow that belongs as a skill"),
  reason: z.string().describe("one sentence explaining the verdict"),
  conflicts_with_bundled: z
    .string()
    .describe(
      "empty string OR the bundled slash command name (without leading slash) that this overlaps with, e.g. 'review'",
    ),
  specificity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("1 = vague generic verb, 5 = names concrete tools/artifacts the user actually uses"),
  name: z.string().describe("kebab-case, 2-4 words; empty if rejected"),
  description: z.string().describe("one sentence, ≤160 chars, mentions concrete tools/artifacts"),
  when_to_use: z.string().describe("2-3 actual trigger phrases, quoted from the exemplars when possible"),
  when_not_to_use: z.string().describe("1-2 sentences on cases that should NOT trigger this skill"),
  body_md: z
    .string()
    .describe(
      "SKILL.md body (without frontmatter). Must contain sections '# Name', '## Trigger', '## Do NOT use when', '## Steps' with ≥3 numbered steps using the user's actual commands/tools.",
    ),
});
type ProposalLLM = z.infer<typeof proposalSchema>;

const SYSTEM = `You audit a developer's prompt history and identify recurring workflows that should become Claude Code skills.

## What a Claude Code skill IS
A SKILL.md file with YAML frontmatter (name, description, when_to_use) + a markdown body containing a repeatable multi-step playbook. Claude loads it automatically when the user's message matches the skill's trigger description. It fires silently, so vague descriptions cause silent failures.

## How to judge
You will receive a cluster of prompts with a computed cohesion score (0..1). Cohesion is the average pairwise cosine similarity of the prompts in the embedding space.

- Cohesion ≥ 0.85 and n ≥ 6 is STRONG evidence that the user is asking for the same thing over and over. Default to ACCEPT unless a hard disqualifier applies.
- Cohesion 0.60–0.85 is moderate evidence. Accept if the exemplars clearly describe a multi-step procedure; reject if they're only superficially similar.
- Cohesion < 0.60 usually means the cluster is diffuse; be more skeptical.

Concreteness note: when the exemplars repeatedly invoke the same tool chain, command, URL pattern, or file-path convention, that repetition IS the signal of a codified workflow — not a reason to reject it as "too context-specific". A personal skill exists precisely to capture these recurring concretes. Casual phrasing around a stable tool chain is still a skill.

## What makes a good skill
- Repeatable: the user keeps asking for the same kind of multi-step work
- Specific: the description names concrete triggers, tools, or artifacts
- Multi-step: the body has at least 3 distinct actions
- Bounded: includes an explicit "do NOT use when" so it doesn't hijack unrelated requests
- Grounded: body uses the user's actual commands, URLs, file paths, tool names from their prompts

## Hard disqualifiers (reject only if one of these clearly applies)
1. Overlaps with a bundled Claude Code skill OR a built-in Claude Code slash command. Proposing a skill that just wraps one of these is a waste — the CLI already dispatches them.
   Bundled skills:
   - /commit — stages + creates a git commit
   - /review — performs a line-by-line code review of the current diff
   - /security-review — security audit of the current diff
   - /debug — interactive debugging helper
   - /simplify — refactor current code for clarity
   - /init — generate CLAUDE.md for this repo
   - /loop — run a task on a cron/interval
   - /batch — batch-process tasks
   - /claude-api — Claude API reference helper
   - /pull-request — create a pull request for the current branch
   - /git-commit, /gencommit — commit the current changes
   - /webapp-testing — run Playwright against a local webapp
   Built-in Claude Code slash commands (all of these already work without a skill):
   - /model — switch the active LLM model (Opus, Sonnet, etc.)
   - /clear — clear the current conversation
   - /compact — compact conversation history
   - /config — open configuration
   - /cost — show session cost
   - /help — show help
   - /login, /logout — authentication
   - /mcp — manage MCP servers
   - /memory — manage persistent memory
   - /permissions — configure permissions / allowlist
   - /pr-comments — fetch comments on a PR
   - /resume — resume a prior conversation
   - /status — show session state
   - /export — export the conversation
   - /vim — toggle vim mode
   A cluster conflicts ONLY if a user in this cluster's situation would reach for the bundled thing instead of a new skill. Judge by WORKFLOW SHAPE — what the user starts with, which tools/commands they invoke, which artifacts they produce — NOT by shared topic vocabulary. Two workflows can share keywords (e.g. "review", "security", "pull", "commit", "test", "model") yet differ in inputs, steps, or outputs; those are different skills. When in doubt that the cluster's workflow literally IS the bundled thing, leave conflicts_with_bundled empty. For a conflict with a built-in slash command, use the command name without slash (e.g. "model", "permissions").
2. Single isolated command with no surrounding steps: "git pull" alone, "restart the server" alone. But "pull, then run the dev script, then verify it's up" IS a multi-step workflow.
3. Pure confirmation/reaction with no instruction: "yes", "go ahead", "looks good".
4. Pure configuration preference that belongs in CLAUDE.md: "always use 4 spaces", "prefer X library over Y".
5. Random pasted logs or errors with no wrapping instruction.

Do NOT reject merely because a prompt refers to a specific repo, URL, or tool. Specific references are the raw material of a personal skill.

## body_md structure (required)
# <Skill Name>

## Trigger
When the user asks <concrete trigger from their prompts>.

## Do NOT use when
- <specific off-case 1>
- <specific off-case 2>

## Steps
1. <first concrete action using the user's actual commands/tools>
2. <second action>
3. <third action>
4. <output format or final verification>

Keep body_md under 150 words. Use imperative voice. Cite the user's actual commands, flags, script paths, URLs, and artifact destinations as seen in the exemplars — not abstract placeholders. If the exemplars reference a specific CLI tool, reproduce its exact invocation; if they reference a file path convention, keep that path.`;

function buildUserMsg(c: Cluster): string {
  const exemplars = c.exemplars
    .slice(0, 6)
    .map((e, i) => `${i + 1}. ${e}`)
    .join("\n");
  return `Cluster #${c.id} — ${c.size} occurrences, cohesion=${c.cohesion.toFixed(2)}
current tf-idf label: ${c.tfidf_label}
current llm label: ${c.label}
keywords: ${c.keywords.slice(0, 8).join(", ")}
top repos: ${c.top_repos.join(", ")}

Exemplar prompts (closest to the cluster centroid):
${exemplars}

Audit this cluster.`;
}

// Force-draft prompt: used only when the main judge rejects a cluster that has
// very high cohesion + size. Tells the model to stop second-guessing and draft
// the best SKILL.md it can from the exemplars.
const FORCE_DRAFT_SYSTEM = `You draft a Claude Code SKILL.md for a cluster of recurring developer prompts. This cluster has already been verified as a recurring workflow — your job is to codify what the user keeps asking for into a multi-step skill.

Output the same JSON shape as a normal judge (accepted=true, specificity, name, description, when_to_use, when_not_to_use, body_md). Set conflicts_with_bundled to "" unless the workflow literally is one of the bundled skills (commit, review, debug, simplify, loop, init, security-review, claude-api, batch, pull-request, git-commit, gencommit, webapp-testing) OR a built-in Claude Code slash command (model, clear, compact, config, cost, help, login, logout, mcp, memory, permissions, pr-comments, resume, status, export, vim). Use the name without slash (e.g. "model").

Rules:
- name: kebab-case, 2-4 words, NAMES THE WORKFLOW (not a generic verb like "test", "check", "run", "fix").
- body_md: 3-5 numbered steps using the user's actual commands/tools from the exemplars. Include "## Trigger", "## Do NOT use when", and "## Steps" sections.
- specificity: rate honestly 1-5 based on how concrete the triggers and tools are.`;

// Pedagogical examples — NOT domain-specific bias. They teach decision shape:
// how to recognize a multi-step workflow worth codifying, and the three most
// common rejection patterns (confirmations, bundled overlap, single command).
// Without these calibration anchors, the judge is over-conservative at low
// cohesion and rejects legitimate infra/ops workflows. Empirically verified:
// removing these dropped accepts from 29 → 15 on the same data, losing real
// patterns like /ghes-admin-api and /verify-docker-compose. Keep them generic
// and schematic; avoid teaching a particular tool chain.
const EXAMPLES: { user: string; object: ProposalLLM }[] = [
  {
    user: `Cluster #99 — 17 occurrences, cohesion=0.71
current tf-idf label: verify pr status
current llm label: verify pull request state
keywords: pr, gh, ci, checks, merge, github
top repos: foo/bar

Exemplar prompts (closest to the cluster centroid):
1. can you check PR #42 — did CI pass and are all threads resolved?
2. verify https://github.com/foo/bar/pull/91 is ready to merge
3. gh pr checks for the current branch — what's red?
4. walk through this PR and tell me if it's ready to ship

Audit this cluster.`,
    object: {
      accepted: true,
      reason: "Repeating multi-step workflow with concrete CLI usage and a clear output.",
      conflicts_with_bundled: "",
      specificity: 4,
      name: "audit-pr-readiness",
      description: "Audit a specific pull request's CI status, review threads, and merge-readiness using gh CLI",
      when_to_use: "\"is PR #X ready to merge\", \"did the checks pass on this PR\", \"walk through this PR\"",
      when_not_to_use: "When creating a new PR (use /pull-request or /commit), or when the user wants a line-by-line code review of their diff (use /review).",
      body_md: `# Audit PR Readiness

## Trigger
When the user asks whether a specific pull request is ready to merge, names a PR URL or number, or says "walk through this PR".

## Do NOT use when
- The user is creating a new PR
- The user wants a line-by-line code review of their diff
- The PR is not yet pushed to a remote

## Steps
1. Identify the PR with \`gh pr view\` (accept URL or number from the user's message)
2. Run \`gh pr checks\` and call out any failing or pending checks
3. Run \`gh pr view --comments\` and list unresolved review threads
4. Compare the PR against the repo's CLAUDE.md expectations
5. State a clear GO or NO-GO for merging with the specific blockers`,
    },
  },
  {
    user: `Cluster #42 — 12 occurrences, cohesion=0.66
current tf-idf label: continue and confirm
current llm label: giving the go-ahead
keywords: yes, go, ahead, continue, sure, do it
top repos: foo/bar

Exemplar prompts (closest to the cluster centroid):
1. go ahead and do that
2. yes keep going
3. sure try it
4. do it

Audit this cluster.`,
    object: {
      accepted: false,
      reason: "Confirmations, not a reusable workflow.",
      conflicts_with_bundled: "",
      specificity: 1,
      name: "",
      description: "",
      when_to_use: "",
      when_not_to_use: "",
      body_md: "",
    },
  },
  {
    user: `Cluster #77 — 9 occurrences, cohesion=0.68
current tf-idf label: check git status
current llm label: verify repo state
keywords: git, status, committed, push, branch
top repos: foo/bar

Exemplar prompts (closest to the cluster centroid):
1. is everything committed on this repo?
2. did you git commit everything?
3. make sure nothing's uncommitted and push
4. check git status and push

Audit this cluster.`,
    object: {
      accepted: false,
      reason: "Overlaps with the bundled /commit skill.",
      conflicts_with_bundled: "commit",
      specificity: 3,
      name: "",
      description: "",
      when_to_use: "",
      when_not_to_use: "",
      body_md: "",
    },
  },
  {
    user: `Cluster #55 — 10 occurrences, cohesion=0.72
current tf-idf label: pull latest dev
current llm label: pull development branch
keywords: pull, dev, development, branch, latest, main
top repos: foo/bar

Exemplar prompts (closest to the cluster centroid):
1. pull latest from dev
2. git pull dev please
3. get the latest dev changes
4. update from development branch

Audit this cluster.`,
    object: {
      accepted: false,
      reason: "Single-command action (git pull) — belongs in a shell alias.",
      conflicts_with_bundled: "",
      specificity: 2,
      name: "",
      description: "",
      when_to_use: "",
      when_not_to_use: "",
      body_md: "",
    },
  },
];

// Reserved *exact* names the user shouldn't squat on. Substrings are allowed:
// e.g. "configure-claude-code-hooks" is a legitimate personal workflow about
// configuring Claude Code itself, and blocking any name containing "claude"
// killed real proposals in earlier runs.
const RESERVED_EXACT = new Set([
  "claude",
  "anthropic",
  "claude-code",
  "claude-agent",
  "anthropic-api",
]);

function validName(name: string): string | null {
  if (!name) return "empty name";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return "name must be kebab-case lowercase/digits";
  if (name.length > 64) return "name exceeds 64 chars";
  if (RESERVED_EXACT.has(name)) return "name is a reserved exact identifier";
  if (BUNDLED_SKILLS.includes(name)) return `conflicts with bundled /${name}`;
  if (WEAK_NAME_TOKENS.has(name)) return "name is a generic verb; skill must name the workflow";
  return null;
}

function countSteps(body: string): number {
  const matches = body.match(/^\s*\d+\.\s+/gm) ?? [];
  return matches.length;
}

function toSkillMd(p: SkillProposal): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const header = [
    "---",
    `name: ${p.name}`,
    `description: ${clean(p.description)}`,
    p.when_to_use ? `when_to_use: ${clean(p.when_to_use)}` : "",
    "---",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return `${header}\n\n${p.body_md.trim()}\n`;
}

function emptyProposal(cid: number, reason: string): SkillProposal {
  return {
    cluster_id: cid,
    accepted: false,
    reason,
    name: "",
    description: "",
    when_to_use: "",
    when_not_to_use: "",
    body_md: "",
    skill_md: "",
    specificity: 0,
    conflicts_with_bundled: "",
    dedupe_of: null,
  };
}

async function main(): Promise<void> {
  const clusters = JSON.parse(readFileSync(`${DATA_DIR}clusters.json`, "utf8")) as Cluster[];
  const candidates = clusters.filter((c) => c.is_skill_candidate);
  const info = chatInfo();
  console.log(
    `suggesting skills for ${candidates.length} of ${clusters.length} clusters via ${info.provider}:${info.model}`,
  );

  const model = chatModel();
  const proposals: SkillProposal[] = [];

  console.log("loading installed skills from ~/.claude/skills/ …");
  const installed = await loadInstalledSkills();
  if (installed.skills.length > 0) {
    console.log(
      `  ${installed.skills.length} installed: ${installed.skills.map((s) => `/${s.name}`).join(", ")}`,
    );
  } else {
    console.log("  none found");
  }

  async function callJudge(c: Cluster, forceDraft: boolean): Promise<ProposalLLM | null> {
    const system = forceDraft ? FORCE_DRAFT_SYSTEM : SYSTEM;
    const messages = forceDraft
      ? [{ role: "user" as const, content: buildUserMsg(c) }]
      : [
          ...EXAMPLES.flatMap<{ role: "user" | "assistant"; content: string }>((ex) => [
            { role: "user", content: ex.user },
            { role: "assistant", content: JSON.stringify(ex.object) },
          ]),
          { role: "user" as const, content: buildUserMsg(c) },
        ];
    try {
      const { object } = await generateObject({
        model,
        schema: proposalSchema,
        system,
        messages,
        temperature: 0,
      });
      return object;
    } catch (e) {
      console.warn(`  #${c.id}: generateObject failed — ${(e as Error).message}`);
      return null;
    }
  }

  for (const c of candidates) {
    const first = await callJudge(c, false);
    if (!first) {
      proposals.push(emptyProposal(c.id, "judge emitted invalid output"));
      continue;
    }

    // Force-draft fallback: if the judge rejected but the cluster is strong
    // enough that cohesion + size alone imply a recurring workflow, re-ask
    // with a prompt that tells the model to draft it anyway. Thresholds are
    // generous for the demo — the structural gates below catch bad drafts.
    const isHighSignal =
      (c.cohesion >= 0.85 && c.size >= 10) ||
      (c.cohesion >= 0.65 && c.size >= 12);
    const forceRerolled = !first.accepted && isHighSignal;
    let llm = first;
    if (forceRerolled) {
      const redraft = await callJudge(c, true);
      if (redraft) {
        llm = redraft;
        llm.accepted = true;
        if (!llm.reason || !llm.reason.trim()) {
          llm.reason = `Force-drafted from high-signal cluster (cohesion ${c.cohesion.toFixed(2)}, n=${c.size}).`;
        }
        console.log(
          `  ↻ #${String(c.id).padStart(3)} force-drafted (cohesion=${c.cohesion.toFixed(2)}, n=${c.size})`,
        );
      }
    }

    let accepted = llm.accepted;
    const p: SkillProposal = {
      cluster_id: c.id,
      accepted,
      reason: llm.reason.trim(),
      name: llm.name.trim().toLowerCase(),
      description: llm.description.trim(),
      when_to_use: llm.when_to_use.trim(),
      when_not_to_use: llm.when_not_to_use.trim(),
      body_md: llm.body_md.trim(),
      skill_md: "",
      specificity: llm.specificity,
      conflicts_with_bundled: llm.conflicts_with_bundled.trim(),
      dedupe_of: null,
    };

    if (accepted) {
      const nameErr = validName(p.name);
      const coh = c.cohesion;
      const minSp = coh >= 0.9 && c.size >= 8 ? 2 : coh >= 0.75 ? 2 : 3;
      if (nameErr) {
        accepted = false;
        p.reason = `Name rejected: ${nameErr}.`;
      } else if (p.body_md.length < 120) {
        accepted = false;
        p.reason = "Body too short to be a real playbook.";
      } else if (countSteps(p.body_md) < 3) {
        accepted = false;
        p.reason = "Needs at least 3 steps to be a workflow.";
      } else if (/local-command-(stdout|stderr|caveat)|system-reminder|task-notification|<background-bash/i.test(p.body_md) ||
                 /local-command-(stdout|stderr|caveat)|system-reminder|task-notification/i.test(p.when_to_use)) {
        // Defensive: if the generated SKILL.md body references Claude Code
        // system-injected tags, the cluster was built on polluted signal and
        // the skill would fire on harness exhaust rather than user intent.
        accepted = false;
        p.reason = "Body/trigger references system-injected tags — cluster is pollution, not a real workflow.";
      } else if (p.specificity < minSp) {
        accepted = false;
        p.reason = `Trigger too vague (specificity ${p.specificity} < ${minSp}) — would cause silent failures.`;
      } else if (!p.when_to_use) {
        accepted = false;
        p.reason = "Missing trigger phrases.";
      } else if (!p.when_not_to_use) {
        accepted = false;
        p.reason = "Missing 'when not to use' — would hijack unrelated requests.";
      } else {
        // Skill-diff against installed skills: don't propose something the user
        // already has a skill for. We pass the full proposal so the embedding
        // captures workflow shape (trigger + avoid-when + steps), not just topic.
        const dup = await findDuplicate(installed, {
          name: p.name,
          description: p.description,
          when_to_use: p.when_to_use,
          when_not_to_use: p.when_not_to_use,
          body_md: p.body_md,
        });
        if (dup) {
          accepted = false;
          p.reason = `Already covered by installed /${dup.name} (similarity ${dup.similarity.toFixed(2)}).`;
          p.conflicts_with_bundled = dup.name;
        }
      }
    }
    p.accepted = accepted;
    if (accepted) p.skill_md = toSkillMd(p);

    proposals.push(p);
    const mark = p.accepted ? "✓" : "✗";
    const nameCol = (p.name || "—").padEnd(32);
    console.log(
      `  ${mark} #${String(c.id).padStart(3)} · n=${String(c.size).padStart(3)} · sp=${p.specificity} · ${nameCol} · ${p.reason}`,
    );
  }

  // Post-accept consolidation in two passes:
  //   (1) Embedding: merge pairs with shape-cosine ≥ 0.78 (catches obvious dups
  //       cheaply — e.g. three CVE packaging skills collapsing into one).
  //   (2) LLM: for any remaining skills, ask the judge to group residual
  //       duplicates semantically. Catches borderline pairs like two different
  //       names for the same "CVE-worthiness triage" workflow that embedding
  //       scored at 0.74 — right in the gray zone.
  const CONSOLIDATE_THRESHOLD = 0.78;
  await consolidateBySemantics(proposals, clusters, CONSOLIDATE_THRESHOLD);
  await consolidateByLLM(proposals, clusters);

  writeFileSync(OUT, JSON.stringify(proposals));
  const nAcc = proposals.filter((p) => p.accepted).length;
  console.log(`\nwrote ${OUT}  (${nAcc} accepted, ${proposals.length - nAcc} rejected)`);
}

function shapeText(p: SkillProposal): string {
  const parts = [`${p.name}: ${p.description}`];
  if (p.when_to_use) parts.push(`Use when: ${p.when_to_use}`);
  if (p.when_not_to_use) parts.push(`Do NOT use when: ${p.when_not_to_use}`);
  if (p.body_md) parts.push(p.body_md.slice(0, 900));
  return parts.join("\n\n");
}

function cosineSim(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalizeVec(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) + 1e-12;
  return v.map((x) => x / n);
}

async function consolidateBySemantics(
  proposals: SkillProposal[],
  clusters: Cluster[],
  threshold: number,
): Promise<void> {
  const accepted = proposals.filter((p) => p.accepted);
  if (accepted.length < 2) return;

  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const model = embedModel();
  const values = accepted.map(shapeText);
  const { embeddings } = await embedMany({ model, values });
  const vecs = embeddings.map(normalizeVec);

  // Union-find on cosine ≥ threshold.
  const parent = accepted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };
  for (let i = 0; i < accepted.length; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      if (cosineSim(vecs[i]!, vecs[j]!) >= threshold) union(i, j);
    }
  }

  // Group indices by root.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < accepted.length; i++) {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(i);
    groups.set(r, arr);
  }

  let mergedCount = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Winner = largest cluster among the members; tiebreak by highest specificity.
    members.sort((a, b) => {
      const ca = clusterById.get(accepted[a]!.cluster_id)!.size;
      const cb = clusterById.get(accepted[b]!.cluster_id)!.size;
      if (ca !== cb) return cb - ca;
      return (accepted[b]!.specificity ?? 0) - (accepted[a]!.specificity ?? 0);
    });
    const winner = accepted[members[0]!]!;
    const losers = members.slice(1).map((i) => accepted[i]!);
    for (const l of losers) {
      l.accepted = false;
      l.dedupe_of = winner.cluster_id;
      l.reason = `Consolidated into /${winner.name} (cluster #${winner.cluster_id}; shape-cosine ≥ ${threshold}).`;
      mergedCount++;
    }
    console.log(
      `  ⇔ merged into /${winner.name}: ${losers.map((l) => `/${l.name}(#${l.cluster_id})`).join(", ")}`,
    );
  }
  if (mergedCount > 0) {
    console.log(`consolidated ${mergedCount} proposal(s) via shape embedding`);
  }
}

// Second-pass consolidation: ask the judge to identify groups of accepted
// proposals that describe the same workflow. Cheap (one LLM call for the whole
// accepted list) and handles the borderline cases that pure cosine misses.
const consolidateSchema = z.object({
  groups: z
    .array(
      z.object({
        cluster_ids: z
          .array(z.number().int())
          .describe(
            "cluster_ids that should be merged — must be 2+ items; omit singletons; the LLM decides which describe the same workflow",
          ),
        reason: z.string().describe("one sentence on why they're the same workflow"),
      }),
    )
    .describe("merge groups; empty array if nothing should be merged"),
});

async function consolidateByLLM(
  proposals: SkillProposal[],
  clusters: Cluster[],
): Promise<void> {
  const accepted = proposals.filter((p) => p.accepted);
  if (accepted.length < 2) return;
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  const list = accepted
    .map((p) => {
      const size = clusterById.get(p.cluster_id)?.size ?? 0;
      const trigger = p.when_to_use.slice(0, 200);
      return `#${p.cluster_id} (n=${size})  /${p.name}
  description: ${p.description}
  trigger: ${trigger}`;
    })
    .join("\n\n");

  const system = `You are deduplicating a list of proposed Claude Code skills. Some describe the same underlying workflow under different names (e.g. two versions of "organize CVE findings", or "verify-pr-in-worktree" vs "review-pr-in-worktree"). Others are genuinely distinct even when they share vocabulary.

Decision rules:
1. Group IDs ONLY if a user in the same situation would get interchangeable help from either skill.
2. If the workflows share >80% of their steps and trigger on substantially the same user phrasing (e.g. three variants of "open this PR in a worktree and review it"), merge them even if the names differ.
3. Do NOT merge workflows that differ in TOOL CHAIN, INPUTS, or OUTPUT ARTIFACTS. Vocabulary overlap is not enough.
4. Do NOT merge PROCESS steps of a pipeline that happen to co-occur (e.g. "validate findings" vs "package findings" are DIFFERENT workflow steps even if both touch findings/).

If nothing should be merged, return an empty groups array. Never group the same skill with itself. Only include groups of 2+.`;

  try {
    const { object } = await generateObject({
      model: chatModel(),
      schema: consolidateSchema,
      system,
      prompt: `Accepted skills:\n\n${list}\n\nReturn merge groups (or empty array).`,
      temperature: 0,
    });

    for (const g of object.groups) {
      if (g.cluster_ids.length < 2) continue;
      const members = g.cluster_ids
        .map((cid) => accepted.find((a) => a.cluster_id === cid))
        .filter((p): p is SkillProposal => Boolean(p) && p!.accepted);
      if (members.length < 2) continue;
      members.sort((a, b) => {
        const ca = clusterById.get(a.cluster_id)!.size;
        const cb = clusterById.get(b.cluster_id)!.size;
        if (ca !== cb) return cb - ca;
        return (b.specificity ?? 0) - (a.specificity ?? 0);
      });
      const winner = members[0]!;
      const losers = members.slice(1);
      for (const l of losers) {
        l.accepted = false;
        l.dedupe_of = winner.cluster_id;
        l.reason = `LLM-consolidated into /${winner.name} (cluster #${winner.cluster_id}): ${g.reason}`;
      }
      console.log(
        `  ⇔ llm-merge → /${winner.name}: ${losers.map((l) => `/${l.name}(#${l.cluster_id})`).join(", ")}`,
      );
    }
  } catch (e) {
    console.warn(`  llm-consolidate skipped: ${(e as Error).message}`);
  }
}

await main();
