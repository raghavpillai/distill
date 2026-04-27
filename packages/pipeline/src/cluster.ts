/**
 * UMAP + HDBSCAN clustering, plus c-TF-IDF keywords.
 *
 * Inputs:  data/turns.json, data/embeddings.json
 * Outputs: data/clusters.json  (per-cluster metadata)
 *          data/points.json    (per-prompt 2D coords + cluster label)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { HDBSCAN } from "hdbscan-ts";
import { UMAP } from "umap-js";
import { DATA_DIR, short, stripSystemTags } from "./common.ts";
import type { Cluster, Point, Turn } from "./types.ts";

function cosineDistance(a: number[], b: number[]): number {
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
}

type EmbeddingsFile = { model: string; dim: number; ids: string[]; vectors: number[][] };

// Baked-in defaults — tuned against a 1500-prompt corpus. Changing these is
// a pipeline-wide decision, not a per-run knob.
const MIN_CLUSTER_SIZE = 10;
const MIN_SAMPLES = 3;
const UMAP_NEIGHBORS = 30;
const SEED = 42;
const MERGE_COSINE = 0.94; // collapse HDBSCAN duplicate sub-clusters
const FAMILY_SIM = 0.85; // group accepted skills into families in the UI
const MIN_SKILL_SIZE = 6; // cluster must be this big to reach the judge
// OpenAI text-embedding-3-large yields tighter cosines than qwen3-embedding,
// so the absolute cohesion distribution shifts lower. 0.52 was tuned for qwen3
// and was leaving legitimate workflows on the floor (infra patterns like GHES
// admin, Prisma debug, tailscale tunneling — see audit notes). 0.35 admits
// more candidates; the judge rejects diffuse ones on workflow-shape grounds.
const MIN_SKILL_COHESION = 0.35;

// Deterministic PRNG for umap-js (it accepts an rng function).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runUmap(
  vectors: number[][],
  nComponents: number,
  minDist: number,
  nNeighborsOverride?: number,
): number[][] {
  const neighbors = nNeighborsOverride ?? Math.min(UMAP_NEIGHBORS, Math.max(2, vectors.length - 1));
  const umap = new UMAP({
    nComponents,
    nNeighbors: Math.min(neighbors, Math.max(2, vectors.length - 1)),
    minDist,
    distanceFn: cosineDistance,
    random: mulberry32(SEED),
  });
  return umap.fit(vectors);
}

// A simple tokenizer + c-TF-IDF across clusters.
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9_-]{1,}/g) ?? []).filter(
    (w) => !STOPWORDS.has(w) && w.length > 1,
  );
}
const STOPWORDS = new Set<string>(
  "a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves just like get got want need please thanks thank make made makes making ok okay yes yeah sure right".split(
    " ",
  ),
);

type CTFIDFRow = { cid: number; keywords: string[]; tfidfLabel: string };

function cTfIdf(texts: Record<number, string[]>): Record<number, CTFIDFRow> {
  const clusterIds = Object.keys(texts)
    .map(Number)
    .sort((a, b) => a - b);
  // Term freq within each cluster (bag of words, unigrams + bigrams).
  const clusterTerms = new Map<number, Map<string, number>>();
  const df = new Map<string, number>(); // number of clusters a term appears in
  const ngramRange = [1, 2] as const;

  for (const cid of clusterIds) {
    const termCounts = new Map<string, number>();
    for (const t of texts[cid]!) {
      const tokens = tokenize(t);
      for (let n = ngramRange[0]; n <= ngramRange[1]; n++) {
        for (let i = 0; i + n <= tokens.length; i++) {
          const gram = tokens.slice(i, i + n).join(" ");
          termCounts.set(gram, (termCounts.get(gram) ?? 0) + 1);
        }
      }
    }
    clusterTerms.set(cid, termCounts);
    for (const term of termCounts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const nC = clusterIds.length;
  const out: Record<number, CTFIDFRow> = {};
  for (const cid of clusterIds) {
    const termCounts = clusterTerms.get(cid)!;
    const total = [...termCounts.values()].reduce((a, b) => a + b, 0) || 1;
    const scored: [string, number][] = [];
    for (const [term, tf] of termCounts) {
      const idf = Math.log(1 + nC / (df.get(term) ?? 1));
      const score = (tf / total) * idf;
      scored.push([term, score]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const keywords = scored.slice(0, 10).map(([t]) => t);
    const tfidfLabel = keywords.slice(0, 4).join(", ") || `cluster ${cid}`;
    out[cid] = { cid, keywords, tfidfLabel };
  }
  return out;
}

function main(): void {
  const turns = JSON.parse(readFileSync(`${DATA_DIR}turns.json`, "utf8")) as Turn[];
  const emb = JSON.parse(readFileSync(`${DATA_DIR}embeddings.json`, "utf8")) as EmbeddingsFile;

  const turnById = new Map<string, Turn>();
  const turnsBySession = new Map<string, Turn[]>();
  for (const t of turns) {
    turnById.set(t.id, t);
    const arr = turnsBySession.get(t.session_id) ?? [];
    arr.push(t);
    turnsBySession.set(t.session_id, arr);
  }
  for (const arr of turnsBySession.values()) arr.sort((a, b) => a.turn_idx - b.turn_idx);

  // Build a multi-turn dialogue snippet around a given user turn: include the
  // preceding ±2 turns (user/assistant/system) within the same session. The judge
  // sees the actual back-and-forth so it can codify the real workflow, not just
  // the opening prompt.
  const SNIPPET_RADIUS = 2;
  // stripSystemTags (from common.ts) drops Claude Code system-injected tags
  // — `<local-command-stdout>`, `<system-reminder>`, etc. — so the judge sees
  // user intent, not harness exhaust. Same helper is applied upstream in
  // extract.ts + embed.ts to prevent the tags from polluting clustering.
  function buildSnippet(centerTurnId: string): string {
    const t = turnById.get(centerTurnId);
    if (!t) return "";
    const session = turnsBySession.get(t.session_id) ?? [t];
    const idx = session.findIndex((x) => x.id === centerTurnId);
    if (idx < 0) return stripSystemTags(t.text);
    const lo = Math.max(0, idx - SNIPPET_RADIUS);
    const hi = Math.min(session.length, idx + SNIPPET_RADIUS + 1);
    const slice = session.slice(lo, hi);
    const lines: string[] = [];
    for (const turn of slice) {
      const cleaned = stripSystemTags(turn.text);
      if (!cleaned) continue;
      const label = turn.role === "assistant" ? "claude" : turn.role;
      const marker = turn.id === centerTurnId ? " ★" : "";
      const body = cleaned.length > 320 ? `${cleaned.slice(0, 320)}…` : cleaned;
      lines.push(`[${label}${marker}] ${body}`);
    }
    return lines.join("\n");
  }
  const ids = emb.ids;
  const vectors = emb.vectors;
  console.log(`clustering ${ids.length} prompts  (dim=${emb.dim})`);

  console.log("umap → 2D for plot + clustering…");
  const emb2 = runUmap(vectors, 2, 0.0);

  console.log("hdbscan…");
  const hdb = new HDBSCAN({
    minClusterSize: MIN_CLUSTER_SIZE,
    minSamples: MIN_SAMPLES,
  });
  const labels = hdb.fit(emb2);
  const n = labels.length;
  {
    const rawUniq = [...new Set(labels)].filter((l) => l !== -1);
    const rawNoise = labels.filter((l) => l === -1).length;
    console.log(
      `  hdbscan raw: ${rawUniq.length} clusters, ${rawNoise} noise (${((rawNoise / n) * 100).toFixed(1)}%)`,
    );
  }

  // Post-HDBSCAN merge: HDBSCAN can split a single recurring pattern into several
  // very dense sub-clusters. Compute each cluster's centroid in the original
  // embedding space and merge pairs whose centroids are highly similar.
  function normv(v: number[]): number {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s) + 1e-12;
  }
  function dotv(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
    return s;
  }
  function computeCentroid(idxs: number[]): number[] {
    const dim = vectors[0]!.length;
    const c = new Array<number>(dim).fill(0);
    for (const i of idxs) for (let d = 0; d < dim; d++) c[d]! += vectors[i]![d]!;
    for (let d = 0; d < dim; d++) c[d]! /= idxs.length;
    const cn = normv(c);
    for (let d = 0; d < dim; d++) c[d]! /= cn;
    return c;
  }
  {
    const idxsByLabel = new Map<number, number[]>();
    labels.forEach((l, i) => {
      if (l === -1) return;
      const arr = idxsByLabel.get(l) ?? [];
      arr.push(i);
      idxsByLabel.set(l, arr);
    });
    // Keep merging until no pair exceeds the threshold.
    let merged = true;
    let passes = 0;
    while (merged && passes < 10) {
      merged = false;
      passes++;
      const labelsList = [...idxsByLabel.keys()];
      const cents = new Map<number, number[]>();
      for (const l of labelsList) cents.set(l, computeCentroid(idxsByLabel.get(l)!));
      let bestPair: [number, number, number] | null = null;
      for (let a = 0; a < labelsList.length; a++) {
        for (let b = a + 1; b < labelsList.length; b++) {
          const la = labelsList[a]!;
          const lb = labelsList[b]!;
          const sim = dotv(cents.get(la)!, cents.get(lb)!);
          if (sim >= MERGE_COSINE && (!bestPair || sim > bestPair[2])) {
            bestPair = [la, lb, sim];
          }
        }
      }
      if (bestPair) {
        const [la, lb, sim] = bestPair;
        // Merge lb into la.
        const aList = idxsByLabel.get(la)!;
        const bList = idxsByLabel.get(lb)!;
        aList.push(...bList);
        idxsByLabel.set(la, aList);
        idxsByLabel.delete(lb);
        // Re-label all points that were in lb.
        for (const i of bList) labels[i] = la;
        console.log(
          `  merged cluster ${lb} → ${la}  (centroid sim = ${sim.toFixed(3)}, new size = ${aList.length})`,
        );
        merged = true;
      }
    }
  }

  // ---- Noise recovery pass ----
  // After the primary HDBSCAN, ~50% of prompts land in noise. Many are
  // genuinely diffuse, but some are real small-workflow patterns that just
  // didn't meet MIN_CLUSTER_SIZE=10 on the first pass. Run HDBSCAN AGAIN on
  // only the noise points at MIN_CLUSTER_SIZE_RECOVERY=6 to surface those
  // smaller-but-coherent clusters. New cluster IDs start after the primary
  // ones so downstream code (merge, label, suggest) treats them uniformly.
  {
    const MIN_CLUSTER_SIZE_RECOVERY = 6;
    const MIN_SAMPLES_RECOVERY = 3;
    const noiseIdx: number[] = [];
    labels.forEach((l, i) => {
      if (l === -1) noiseIdx.push(i);
    });
    if (noiseIdx.length >= MIN_CLUSTER_SIZE_RECOVERY * 2) {
      const noiseEmb2 = noiseIdx.map((i) => emb2[i]!);
      const hdb2 = new HDBSCAN({
        minClusterSize: MIN_CLUSTER_SIZE_RECOVERY,
        minSamples: MIN_SAMPLES_RECOVERY,
      });
      const recLabels = hdb2.fit(noiseEmb2);
      const primaryMax = Math.max(-1, ...labels);
      // Remap: recovered cluster k gets global id (primaryMax + 1 + k).
      let recovered = 0;
      for (let ii = 0; ii < noiseIdx.length; ii++) {
        const lr = recLabels[ii]!;
        if (lr === -1) continue;
        labels[noiseIdx[ii]!] = primaryMax + 1 + lr;
        recovered++;
      }
      const newClusterIds = [...new Set(recLabels)].filter((l) => l !== -1).length;
      if (newClusterIds > 0) {
        console.log(
          `  noise recovery: ${newClusterIds} new clusters, ${recovered} points rescued from noise (min_cluster_size=${MIN_CLUSTER_SIZE_RECOVERY})`,
        );
      }
    }
  }

  const uniq = [...new Set(labels)].filter((l) => l !== -1).sort((a, b) => a - b);
  const nNoise = labels.filter((l) => l === -1).length;
  console.log(
    `  after merge + recovery: ${uniq.length} clusters, ${nNoise} noise (${((nNoise / n) * 100).toFixed(1)}%)`,
  );

  // Build cluster→texts map for c-TF-IDF + exemplars.
  const cidToIdx: Record<number, number[]> = {};
  labels.forEach((l, i) => {
    if (l === -1) return;
    if (!cidToIdx[l]) cidToIdx[l] = [];
    cidToIdx[l].push(i);
  });
  const cidToTexts: Record<number, string[]> = {};
  for (const [cidStr, idxs] of Object.entries(cidToIdx)) {
    const cid = Number(cidStr);
    cidToTexts[cid] = idxs.map((i) => turnById.get(ids[i]!)!.text);
  }
  const tfidf = cTfIdf(cidToTexts);

  // Exemplars: closest to cluster centroid in embedding space (cosine sim).
  function norm(v: number[]): number {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s) + 1e-12;
  }
  function dot(a: number[], b: number[]): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
    return s;
  }

  const centroids = new Map<number, number[]>();
  const pointDistance = new Map<number, number>(); // pointIdx → cosine dist from centroid
  const clusters: Cluster[] = [];
  for (const cid of uniq) {
    const idxs = cidToIdx[cid]!;
    const dim = vectors[0]!.length;
    const centroid = new Array<number>(dim).fill(0);
    for (const i of idxs) for (let d = 0; d < dim; d++) centroid[d]! += vectors[i]![d]!;
    for (let d = 0; d < dim; d++) centroid[d]! /= idxs.length;
    const cn = norm(centroid);
    for (let d = 0; d < dim; d++) centroid[d]! /= cn;
    centroids.set(cid, centroid);

    const scored = idxs.map((i) => {
      const v = vectors[i]!;
      const vn = norm(v);
      const sim = dot(centroid, v) / vn;
      pointDistance.set(i, 1 - sim);
      return { i, sim };
    });
    scored.sort((a, b) => b.sim - a.sim);
    const seen = new Set<string>();
    const exIds: string[] = [];
    const exTexts: string[] = [];
    for (const { i } of scored) {
      const t = turnById.get(ids[i]!)!;
      const key = t.text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      exIds.push(t.id);
      // Multi-turn snippet: the user prompt + ±2 surrounding turns in the same
      // session so the LLM judge sees the actual workflow, not just the kickoff.
      exTexts.push(buildSnippet(t.id));
      if (exIds.length >= 4) break;
    }

    const repoCounts = new Map<string, number>();
    for (const i of idxs) {
      const r = turnById.get(ids[i]!)!.repo;
      repoCounts.set(r, (repoCounts.get(r) ?? 0) + 1);
    }
    const topRepos = [...repoCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r]) => r);

    // Cohesion: average pairwise cosine similarity within the cluster.
    // Sample at most 60 pairs to keep it cheap.
    let cohesion = 0;
    {
      const pairs: [number, number][] = [];
      const n = idxs.length;
      const MAX_PAIRS = 60;
      if ((n * (n - 1)) / 2 <= MAX_PAIRS) {
        for (let a = 0; a < n; a++)
          for (let b = a + 1; b < n; b++) pairs.push([idxs[a]!, idxs[b]!]);
      } else {
        const seen = new Set<string>();
        while (pairs.length < MAX_PAIRS) {
          const a = idxs[Math.floor(Math.random() * n)]!;
          const b = idxs[Math.floor(Math.random() * n)]!;
          if (a === b) continue;
          const k = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (seen.has(k)) continue;
          seen.add(k);
          pairs.push([a, b]);
        }
      }
      let sum = 0;
      for (const [a, b] of pairs) {
        const va = vectors[a]!;
        const vb = vectors[b]!;
        sum += dot(va, vb) / (norm(va) * norm(vb));
      }
      cohesion = pairs.length ? sum / pairs.length : 0;
    }

    // Session-diversity + time-span: a real RECURRING skill fires across
    // multiple sessions over time. A cluster concentrated in one long session
    // (or one weekend of feature work) is typically a one-shot project —
    // specific enough to look skill-ish but not actually a *repeating* pattern.
    const sessionCounts = new Map<string, number>();
    const timestamps: number[] = [];
    for (const i of idxs) {
      const t = turnById.get(ids[i]!)!;
      if (t.session_id) sessionCounts.set(t.session_id, (sessionCounts.get(t.session_id) ?? 0) + 1);
      const ts = Date.parse(t.timestamp);
      if (!Number.isNaN(ts)) timestamps.push(ts);
    }
    const session_count = sessionCounts.size;
    const span_days =
      timestamps.length >= 2
        ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24)
        : 0;
    // max_session_fraction: what share of the cluster's prompts came from the
    // single session that contributed the most. >0.75 means one session
    // dominates — this is usually a long in-context project rather than a
    // pattern that fires across many sessions.
    const max_session_fraction =
      idxs.length > 0 ? Math.max(0, ...sessionCounts.values()) / idxs.length : 0;
    // continuation_count: exemplars starting with (or containing) the Claude
    // Code "This session is being continued from a previous conversation"
    // banner are rooted in one long context-compacted session. ≥2 of these in
    // the exemplars is a near-certain "one-shot project" signal.
    const continuationRe = /this session is being continued from a previous conversation/i;
    const continuation_count = exTexts.filter((t) => continuationRe.test(t)).length;

    clusters.push({
      id: cid,
      size: idxs.length,
      label: tfidf[cid]!.tfidfLabel,
      tfidf_label: tfidf[cid]!.tfidfLabel,
      keywords: tfidf[cid]!.keywords,
      top_repos: topRepos,
      exemplar_ids: exIds,
      exemplars: exTexts,
      center3d: [0, 0, 0], // filled in below
      cohesion,
      is_skill_candidate: false, // assigned below
      family_id: cid, // filled in below
      family_label: "", // filled in below
      session_count,
      span_days,
      continuation_count,
      max_session_fraction,
    });
  }
  clusters.sort((a, b) => b.size - a.size);

  // Skill-candidate gate: recurring enough AND tight enough AND multi-session
  // AND spread over time AND not dominated by a single context-compacted
  // project. The continuation + session-dominance filters catch HDBSCAN
  // clusters that look skill-ish but are really one long multi-session feature
  // project (e.g. a codex-integration push that spanned a week).
  const MIN_SESSIONS_FOR_SKILL = 3;
  const MIN_SPAN_DAYS_FOR_SKILL = 3; // < 3 days = one-shot weekend project
  const MAX_CONTINUATION_COUNT = 1; // ≥2 context-compaction markers = one long project
  const MAX_SESSION_DOMINANCE = 0.75; // one session dominating = not recurring
  for (const c of clusters) {
    c.is_skill_candidate =
      c.size >= MIN_SKILL_SIZE &&
      c.cohesion >= MIN_SKILL_COHESION &&
      c.session_count >= MIN_SESSIONS_FOR_SKILL &&
      c.span_days >= MIN_SPAN_DAYS_FOR_SKILL &&
      c.continuation_count <= MAX_CONTINUATION_COUNT &&
      c.max_session_fraction <= MAX_SESSION_DOMINANCE;
  }
  const nCandidates = clusters.filter((c) => c.is_skill_candidate).length;
  const oneShot = clusters.filter(
    (c) =>
      c.size >= MIN_SKILL_SIZE &&
      c.cohesion >= MIN_SKILL_COHESION &&
      c.session_count >= MIN_SESSIONS_FOR_SKILL &&
      c.span_days >= MIN_SPAN_DAYS_FOR_SKILL &&
      (c.continuation_count > MAX_CONTINUATION_COUNT ||
        c.max_session_fraction > MAX_SESSION_DOMINANCE),
  );
  console.log(
    `skill candidates: ${nCandidates} / ${clusters.length}  (rejected ${oneShot.length} as one-shot project: ${MAX_CONTINUATION_COUNT + 1}+ context-compactions or >${MAX_SESSION_DOMINANCE} single-session dominance)`,
  );
  if (oneShot.length > 0) {
    for (const c of oneShot) {
      console.log(
        `    one-shot: #${String(c.id).padStart(3)} "${c.label || c.tfidf_label}" (n=${c.size}, cont=${c.continuation_count}, maxFrac=${c.max_session_fraction.toFixed(2)})`,
      );
    }
  }

  // Group clusters into FAMILIES via union-find on centroid cosine similarity.
  // A family is a connected component at FAMILY_SIM; the threshold is below the
  // merge threshold so only moderately-similar clusters link, not duplicates.
  const parent = new Map<number, number>(clusters.map((c) => [c.id, c.id]));
  function find(x: number): number {
    let cur = x;
    while (parent.get(cur)! !== cur) cur = parent.get(cur)!;
    // Path compression.
    let node = x;
    while (parent.get(node)! !== cur) {
      const next = parent.get(node)!;
      parent.set(node, cur);
      node = next;
    }
    return cur;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = centroids.get(clusters[i]!.id)!;
      const b = centroids.get(clusters[j]!.id)!;
      if (dot(a, b) >= FAMILY_SIM) union(clusters[i]!.id, clusters[j]!.id);
    }
  }

  // Build family label from the biggest cluster's top keywords.
  const familyMembers = new Map<number, Cluster[]>();
  for (const c of clusters) {
    const root = find(c.id);
    c.family_id = root;
    const arr = familyMembers.get(root) ?? [];
    arr.push(c);
    familyMembers.set(root, arr);
  }
  for (const [root, members] of familyMembers) {
    if (members.length === 1) {
      // A lone cluster gets its own label (its first keyword) so the UI can still group cleanly.
      members[0]!.family_label = members[0]!.keywords[0] ?? members[0]!.label;
      continue;
    }
    members.sort((a, b) => b.size - a.size);
    // Intersect top keywords; fall back to biggest cluster's top keyword.
    const topKw = new Map<string, number>();
    for (const m of members) {
      for (const k of m.keywords.slice(0, 6)) {
        topKw.set(k, (topKw.get(k) ?? 0) + m.size);
      }
    }
    const ranked = [...topKw.entries()].sort((a, b) => b[1] - a[1]);
    const label = ranked
      .slice(0, 2)
      .map(([k]) => k)
      .join(" / ");
    for (const m of members) m.family_label = label || members[0]!.keywords[0] || members[0]!.label;
    console.log(
      `  family ${root}: [${label}] ← ${members.map((m) => `#${m.id}(n=${m.size})`).join(", ")}`,
    );
  }

  // UMAP-3 on cluster centroids to scatter the solar systems across a 3D universe.
  // With only ~50 cluster centroids, the default nNeighbors=30 effectively
  // connects each centroid to most of the graph, wiping out local structure.
  // Use a small neighborhood so related clusters end up as actual 3D neighbors.
  console.log("umap → 3D for cluster layout…");
  const centroidVectors = clusters.map((c) => centroids.get(c.id)!);
  let centers3d: number[][] = [];
  if (centroidVectors.length >= 4) {
    const n = centroidVectors.length;
    const nNeighbors = Math.max(4, Math.min(10, Math.floor(n / 6)));
    centers3d = runUmap(centroidVectors, 3, 0.15, nNeighbors);
  } else {
    centers3d = centroidVectors.map((_, i) => [i * 3, 0, 0]);
  }
  // Normalize to a roughly ±15 unit cube.
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const p of centers3d) {
    for (let d = 0; d < 3; d++) {
      if (p[d]! < mins[d]!) mins[d] = p[d]!;
      if (p[d]! > maxs[d]!) maxs[d] = p[d]!;
    }
  }
  const ranges = [maxs[0]! - mins[0]!, maxs[1]! - mins[1]!, maxs[2]! - mins[2]!];
  const scale = 30 / Math.max(...ranges, 1e-6);
  clusters.forEach((c, i) => {
    const p = centers3d[i]!;
    c.center3d = [
      (p[0]! - (mins[0]! + maxs[0]!) / 2) * scale,
      (p[1]! - (mins[1]! + maxs[1]!) / 2) * scale,
      (p[2]! - (mins[2]! + maxs[2]!) / 2) * scale,
    ];
  });

  // Family-pull post-pass: for each family of related clusters, pull members
  // toward the family's spatial centroid so they read as a real neighborhood
  // in the galaxy view. UMAP gives us the global arrangement; this gives us
  // the local cohesion UMAP alone won't guarantee with sparse inputs.
  const FAMILY_PULL = 0.55;
  for (const [, members] of familyMembers) {
    if (members.length < 2) continue;
    const cx = members.reduce((s, m) => s + m.center3d[0], 0) / members.length;
    const cy = members.reduce((s, m) => s + m.center3d[1], 0) / members.length;
    const cz = members.reduce((s, m) => s + m.center3d[2], 0) / members.length;
    for (const m of members) {
      m.center3d = [
        m.center3d[0] * (1 - FAMILY_PULL) + cx * FAMILY_PULL,
        m.center3d[1] * (1 - FAMILY_PULL) + cy * FAMILY_PULL,
        m.center3d[2] * (1 - FAMILY_PULL) + cz * FAMILY_PULL,
      ];
    }
  }

  const points: Point[] = ids.map((id, i) => {
    const t = turnById.get(id)!;
    const [x, y] = emb2[i]!;
    const d = pointDistance.has(i) ? pointDistance.get(i)! : -1;
    return { id, x: x!, y: y!, c: labels[i]!, r: t.repo, t: short(t.text), d };
  });

  // Persist embedding-space centroids so session_cluster.ts can re-run 3D
  // UMAP on the combined (prompt + session) centroid set, giving session
  // clusters proper positions in the galaxy instead of piling at origin.
  const centroidsJson: Record<string, number[]> = {};
  for (const [cid, v] of centroids) centroidsJson[String(cid)] = v;
  writeFileSync(`${DATA_DIR}centroids.json`, JSON.stringify(centroidsJson));

  writeFileSync(`${DATA_DIR}clusters.json`, JSON.stringify(clusters));
  writeFileSync(`${DATA_DIR}points.json`, JSON.stringify(points));
  console.log(
    `wrote ${DATA_DIR}clusters.json (${clusters.length}) and ${DATA_DIR}points.json (${points.length})`,
  );
}

main();
