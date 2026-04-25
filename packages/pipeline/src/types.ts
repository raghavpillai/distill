// Shared types across the pipeline and web.

// One record from a Claude Code session jsonl. We keep enough to reconstruct a conversation
// thread and to filter user turns for clustering.
export type Turn = {
  id: string; // stable id: sessionId + turn index
  session_id: string;
  project_dir: string;
  file: string;
  turn_idx: number; // 0-based position within the session (after dedupe)
  role: "user" | "assistant" | "system";
  text: string; // plain string (blocks flattened)
  cwd: string;
  cwd_norm: string;
  repo: string;
  git_branch: string;
  timestamp: string; // ISO
  is_user_prompt: boolean; // true only for clusterable user prompts
  is_slash: boolean;
  slash_cmd: string | null;
  is_meta: boolean;
};

export type Session = {
  session_id: string;
  project_dir: string;
  repo: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  turn_ids: string[]; // ordered ids into the turn index
};

export type Cluster = {
  id: number;
  size: number;
  label: string;
  tfidf_label: string;
  keywords: string[];
  top_repos: string[];
  exemplar_ids: string[]; // turn ids
  exemplars: string[]; // short texts
  center3d: [number, number, number]; // cluster centroid in 3D world space
  cohesion: number;
  is_skill_candidate: boolean;
  family_id: number; // union-find root cluster id; clusters in same family are closely related
  family_label: string; // short human label for the family (1-4 words)
  session_count: number; // distinct sessions the cluster's prompts come from
  span_days: number; // days between first and last prompt timestamp
  continuation_count: number; // exemplars containing "This session is being continued…" marker
  max_session_fraction: number; // largest single-session share of cluster prompts (0..1)
};

export type SkillProposal = {
  cluster_id: number;
  accepted: boolean;
  reason: string; // why accepted / rejected
  name: string; // kebab-case
  description: string;
  when_to_use: string; // trigger phrases
  when_not_to_use: string; // negative boundary
  body_md: string;
  skill_md: string;
  specificity: number; // 1..5 — how specific the invocation trigger is
  conflicts_with_bundled: string; // bundled skill this overlaps with, if any
  dedupe_of: number | null; // set to another cluster_id if this was merged into it
};

export type Point = {
  id: string; // turn id
  x: number;
  y: number;
  c: number;
  r: string;
  t: string;
  // "orbital distance" — cosine distance of this point from its cluster centroid in the
  // original embedding space. 0 ≈ at the sun, 1 ≈ far from it. -1 for noise.
  d: number;
};

export type ProviderInfo = {
  provider: string;
  model: string;
};

export type WebBundle = {
  stats: {
    total: number;
    n_clusters: number;
    n_noise: number;
    n_repos: number;
    chat: ProviderInfo;
    embed: ProviderInfo;
    generated_at: string;
  };
  clusters: Cluster[];
  points: Point[];
  repos: string[];
};
