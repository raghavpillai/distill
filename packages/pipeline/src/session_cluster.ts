/**
 * Session-level clustering pass.
 *
 * Motivation: prompt-level clustering (cluster.ts) catches patterns where the
 * user repeats a similar short phrase many times. But a lot of real workflows
 * manifest as an ENTIRE SESSION'S SHAPE, not a single repeated prompt — e.g.
 * "debug a Prisma seed failure" is always phrased differently turn-by-turn,
 * but the session's aggregate intent looks similar across incidents. HDBSCAN
 * on individual prompts can't see that; HDBSCAN on session-level embeddings
 * can.
 *
 * This step runs AFTER cluster.ts. It:
 *   1. Groups user prompts by session.
 *   2. Concatenates each session's sanitized user prompts → one intent text.
 *   3. Embeds via the same model as embed.ts.
 *   4. Runs HDBSCAN on session vectors.
 *   5. For each session-cluster, appends a synthetic cluster entry to
 *      clusters.json with an id >= SESSION_ID_BASE so downstream label.ts /
 *      suggest.ts process it uniformly.
 *
 * The synthetic clusters' exemplars are one representative user prompt per
 * session in the cluster — so the judge sees a balanced view of what the user
 * actually did across those sessions, not 50 messages from one outlier.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { embedMany } from "ai";
import { HDBSCAN } from "hdbscan-ts";
import { UMAP } from "umap-js";
import { embedInfo, embedModel, isQwen3Embedding } from "./ai.ts";
import { DATA_DIR, short, stripSystemTags } from "./common.ts";
import type { Cluster, Turn } from "./types.ts";

// Session-cluster IDs live above this offset so they can't collide with the
// prompt-cluster IDs that already occupy 0..(hdbscan_max + noise_recovery_max).
const SESSION_ID_BASE = 10000;

const MIN_PROMPTS_PER_SESSION = 3;
const MIN_SESSION_CLUSTER_SIZE = 3;
const MIN_SAMPLES = 2;
const MAX_INTENT_CHARS = 3500;
const BATCH = 32;

const INTENT_INSTRUCTION =
  "Given a developer's session with an AI coding assistant, represent the " +
  "overall intent of the session (the repeatable workflow the developer is " +
  "walking through) so that sessions with similar workflows cluster together.";

function applyInstruction(texts: string[]): string[] {
  if (!isQwen3Embedding()) return texts;
  return texts.map((t) => `Instruct: ${INTENT_INSTRUCTION}\nQuery: ${t}`);
}

function truncate(text: string): string {
  if (text.length <= MAX_INTENT_CHARS) return text;
  const half = Math.floor(MAX_INTENT_CHARS / 2);
  return `${text.slice(0, half)}\n...[truncated]...\n${text.slice(-half)}`;
}

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) + 1e-12;
  return v.map((x) => x / n);
}

function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// Cheap c-TF-IDF-ish keyword picker: take the highest-frequency tokens across
// the cluster members that are NOT frequent across all sessions. Good enough.
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "not",
  "can",
  "you",
  "your",
  "are",
  "was",
  "will",
  "but",
  "all",
  "any",
  "one",
  "two",
  "make",
  "need",
  "want",
  "get",
  "use",
  "run",
  "see",
  "fix",
  "just",
  "then",
  "how",
  "what",
  "why",
  "when",
  "should",
  "would",
  "could",
  "does",
  "did",
  "into",
  "about",
  "here",
  "there",
  "look",
  "also",
  "its",
  "them",
  "they",
]);

function topKeywords(
  texts: string[],
  globalDF: Map<string, number>,
  totalDocs: number,
  k = 8,
): string[] {
  const freq = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const tok of t.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
      if (STOPWORDS.has(tok)) continue;
      if (tok.length < 3) continue;
      if (seen.has(tok)) continue;
      seen.add(tok);
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }
  const scored = [...freq.entries()]
    .map(([tok, tf]) => {
      const df = globalDF.get(tok) ?? 1;
      const idf = Math.log((totalDocs + 1) / df);
      return [tok, tf * idf] as const;
    })
    .sort((a, b) => b[1] - a[1]);
  return scored.slice(0, k).map(([tok]) => tok);
}

async function main(): Promise<void> {
  const turns = JSON.parse(readFileSync(`${DATA_DIR}turns.json`, "utf8")) as Turn[];
  const existing = JSON.parse(readFileSync(`${DATA_DIR}clusters.json`, "utf8")) as Cluster[];

  // Group user prompts by session.
  const bySession = new Map<string, Turn[]>();
  for (const t of turns) {
    if (!t.is_user_prompt) continue;
    if (!t.session_id) continue;
    const arr = bySession.get(t.session_id) ?? [];
    arr.push(t);
    bySession.set(t.session_id, arr);
  }

  const substantial = [...bySession.entries()]
    .filter(([, arr]) => arr.length >= MIN_PROMPTS_PER_SESSION)
    .map(([sid, arr]) => ({ sid, turns: arr.sort((a, b) => a.turn_idx - b.turn_idx) }));

  if (substantial.length < MIN_SESSION_CLUSTER_SIZE * 2) {
    console.log(`session-cluster: only ${substantial.length} substantial sessions — skipping`);
    return;
  }

  // Build intent text = concatenation of sanitized user prompts (truncated).
  const intents = substantial.map(({ turns }) =>
    truncate(
      turns
        .map((t) => stripSystemTags(t.text))
        .filter((t) => t)
        .join("\n\n"),
    ),
  );

  const info = embedInfo();
  console.log(
    `session-cluster: embedding ${substantial.length} session intents via ${info.provider}:${info.model} (batch=${BATCH})`,
  );

  const model = embedModel();
  const values = applyInstruction(intents);
  const vectors: number[][] = [];
  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH);
    const { embeddings } = await embedMany({ model, values: batch });
    vectors.push(...embeddings);
  }

  // UMAP → HDBSCAN on session vectors. Use cosine distance (OpenAI embeddings
  // are normalized; cosine is the natural metric for semantic similarity).
  const cosineDist = (a: number[], b: number[]): number => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 1 : 1 - dot / denom;
  };
  let seed = 42;
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(15, Math.max(4, Math.floor(vectors.length / 10))),
    minDist: 0.0,
    distanceFn: cosineDist,
    random: () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    },
  });
  const emb2 = umap.fit(vectors);
  const hdb = new HDBSCAN({
    minClusterSize: MIN_SESSION_CLUSTER_SIZE,
    minSamples: MIN_SAMPLES,
  });
  const labels = hdb.fit(emb2);
  const uniqLabels = [...new Set(labels)].filter((l) => l !== -1);
  const nNoise = labels.filter((l) => l === -1).length;
  console.log(
    `session-cluster: hdbscan → ${uniqLabels.length} clusters, ${nNoise} noise (${((nNoise / labels.length) * 100).toFixed(1)}%)`,
  );

  if (uniqLabels.length === 0) {
    console.log("session-cluster: no clusters formed, nothing to append");
    return;
  }

  // Collect member turns per session-cluster.
  type Member = { sid: string; turns: Turn[]; vec: number[] };
  const byLabel = new Map<number, Member[]>();
  for (let i = 0; i < substantial.length; i++) {
    const lb = labels[i]!;
    if (lb === -1) continue;
    const arr = byLabel.get(lb) ?? [];
    arr.push({
      sid: substantial[i]!.sid,
      turns: substantial[i]!.turns,
      vec: normalize(vectors[i]!),
    });
    byLabel.set(lb, arr);
  }

  // Build global DF across all session intents for keyword IDF.
  const globalDF = new Map<string, number>();
  for (const t of intents) {
    const seen = new Set<string>();
    for (const tok of t.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      globalDF.set(tok, (globalDF.get(tok) ?? 0) + 1);
    }
  }

  // Build synthetic cluster entries.
  const synthetic: Cluster[] = [];
  for (const [lb, members] of byLabel) {
    const id = SESSION_ID_BASE + lb;

    // All user-prompt turns from every member session.
    const allTurns = members.flatMap((m) => m.turns);
    const size = allTurns.length;

    // Cohesion = mean pairwise cosine between session vectors in this cluster.
    let coh = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        coh += cosine(members[i]!.vec, members[j]!.vec);
        pairs++;
      }
    }
    const cohesion = pairs ? coh / pairs : 1.0;

    // Top repos by member-session count.
    const repoCount = new Map<string, number>();
    for (const m of members) {
      const r = m.turns[0]?.repo ?? "(unknown)";
      repoCount.set(r, (repoCount.get(r) ?? 0) + 1);
    }
    const top_repos = [...repoCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([r]) => r);

    // Exemplars: pick one representative user prompt per session (the one
    // closest to the session's intent text length median, a cheap heuristic
    // that avoids grabbing outlier short prompts like "yes" while also not
    // always grabbing the longest wall of text).
    const perSession = members.map((m) => {
      const cleaned = m.turns
        .map((t) => ({ t, body: stripSystemTags(t.text) }))
        .filter((x) => x.body.length >= 40);
      if (cleaned.length === 0) return m.turns[0]!;
      cleaned.sort((a, b) => a.body.length - b.body.length);
      return cleaned[Math.floor(cleaned.length / 2)]!.t;
    });
    const exemplarIds = perSession.slice(0, 6).map((t) => t.id);
    const exemplarTexts = perSession.slice(0, 6).map((t) => short(stripSystemTags(t.text), 280));

    const keywords = topKeywords(
      members.map((m) => stripSystemTags(m.turns.map((t) => t.text).join(" "))),
      globalDF,
      substantial.length,
      10,
    );

    // Session-cluster diagnostics mirror the prompt-cluster fields.
    const tsList: number[] = [];
    for (const m of members) {
      for (const t of m.turns) {
        const ts = Date.parse(t.timestamp);
        if (!Number.isNaN(ts)) tsList.push(ts);
      }
    }
    const span_days =
      tsList.length >= 2 ? (Math.max(...tsList) - Math.min(...tsList)) / (1000 * 60 * 60 * 24) : 0;

    // Session-cluster acceptance is stricter than prompt-cluster acceptance.
    // Embedding a full concatenated-session text means unrelated sessions can
    // still score cosine > 0.5 just from shared dev vocabulary, and the judge
    // can then rationalize a fake unifying workflow from the exemplars. Empirical
    // case: a 3-session / 0.72-cohesion cluster combined a UI feature from repo
    // A, a research thread in repo B, and a CVE-filter ask in repo C — the
    // judge invented "feature-defaults-filtering" to paper over the gap.
    //
    // Guard with TWO stricter bars: ≥4 member sessions AND cohesion ≥ 0.82.
    // Vocabulary-overlap false positives fall under either.
    const is_skill_candidate =
      size >= 6 && members.length >= 4 && cohesion >= 0.82 && span_days >= 3;

    // Session clusters, by construction, have every session contribute ~1 row
    // of exemplars, so max_session_fraction here is the biggest member
    // session's prompt share of the cluster size.
    const sessionSizes = members.map((m) => m.turns.length);
    const max_session_fraction = size > 0 ? Math.max(0, ...sessionSizes) / size : 0;
    const continuationRe = /this session is being continued from a previous conversation/i;
    const continuation_count = exemplarTexts.filter((t) => continuationRe.test(t)).length;

    synthetic.push({
      id,
      size,
      label: "", // filled by label.ts
      tfidf_label: keywords.slice(0, 3).join(" / ") || "session-cluster",
      keywords,
      top_repos,
      exemplar_ids: exemplarIds,
      exemplars: exemplarTexts,
      center3d: [0, 0, 0], // filled by a later pass (or left 0; UI falls back)
      cohesion,
      is_skill_candidate,
      family_id: id,
      family_label: "",
      session_count: members.length,
      span_days,
      continuation_count,
      max_session_fraction,
    });

    console.log(
      `session-cluster: #${id} · sessions=${members.length} · prompts=${size} · cohesion=${cohesion.toFixed(2)} · kw=${keywords.slice(0, 4).join(",")}`,
    );
  }

  const merged = [...existing, ...synthetic];

  // Re-run 3D UMAP on the combined (prompt + session) centroid set so session
  // clusters don't all pile at origin. Prompt-cluster centroids are loaded
  // from centroids.json (written by cluster.ts); session-cluster centroids
  // come from the session-intent vectors we just embedded.
  try {
    const centroidsMap = JSON.parse(readFileSync(`${DATA_DIR}centroids.json`, "utf8")) as Record<
      string,
      number[]
    >;
    const byIdVec = new Map<number, number[]>();
    for (const [k, v] of Object.entries(centroidsMap)) byIdVec.set(Number(k), v);
    // Session-cluster centroid = normalized mean of member session intent vectors.
    for (const [lb, members] of byLabel) {
      const dim = vectors[0]!.length;
      const sum = new Array<number>(dim).fill(0);
      for (const m of members) for (let d = 0; d < dim; d++) sum[d]! += m.vec[d]!;
      for (let d = 0; d < dim; d++) sum[d]! /= members.length;
      let nrm = 0;
      for (const x of sum) nrm += x * x;
      nrm = Math.sqrt(nrm) + 1e-12;
      for (let d = 0; d < dim; d++) sum[d]! /= nrm;
      byIdVec.set(SESSION_ID_BASE + lb, sum);
    }

    const orderedIds = merged.map((c) => c.id);
    const combined = orderedIds.map((id) => byIdVec.get(id)!).filter(Boolean);
    if (combined.length === merged.length && combined.length >= 4) {
      const cosineDist2 = (a: number[], b: number[]): number => {
        let dotv = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < a.length; i++) {
          dotv += a[i]! * b[i]!;
          na += a[i]! * a[i]!;
          nb += b[i]! * b[i]!;
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb);
        return denom === 0 ? 1 : 1 - dotv / denom;
      };
      let seed2 = 42;
      const umap3 = new UMAP({
        nComponents: 3,
        nNeighbors: Math.max(4, Math.min(10, Math.floor(combined.length / 6))),
        minDist: 0.15,
        distanceFn: cosineDist2,
        random: () => {
          seed2 = (seed2 * 9301 + 49297) % 233280;
          return seed2 / 233280;
        },
      });
      const coords = umap3.fit(combined);
      // Normalize to ±15 unit cube (same convention as cluster.ts).
      const mins = [Infinity, Infinity, Infinity];
      const maxs = [-Infinity, -Infinity, -Infinity];
      for (const p of coords) {
        for (let d = 0; d < 3; d++) {
          if (p[d]! < mins[d]!) mins[d] = p[d]!;
          if (p[d]! > maxs[d]!) maxs[d] = p[d]!;
        }
      }
      const ranges = [maxs[0]! - mins[0]!, maxs[1]! - mins[1]!, maxs[2]! - mins[2]!];
      const scale = 30 / Math.max(...ranges, 1e-6);
      merged.forEach((c, i) => {
        const p = coords[i]!;
        c.center3d = [
          (p[0]! - (mins[0]! + maxs[0]!) / 2) * scale,
          (p[1]! - (mins[1]! + maxs[1]!) / 2) * scale,
          (p[2]! - (mins[2]! + maxs[2]!) / 2) * scale,
        ];
      });
      console.log(`session-cluster: re-laid-out 3D for ${merged.length} total clusters`);
    } else {
      console.log(`session-cluster: skipped 3D re-layout (missing centroids for some clusters)`);
    }
  } catch (e) {
    console.warn(`session-cluster: 3D re-layout failed — ${(e as Error).message}`);
  }

  writeFileSync(`${DATA_DIR}clusters.json`, JSON.stringify(merged));
  console.log(
    `session-cluster: appended ${synthetic.length} session-level clusters to clusters.json (total now ${merged.length})`,
  );
}

await main();
