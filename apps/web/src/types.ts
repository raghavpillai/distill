export type Point = {
  id: string;
  x: number;
  y: number;
  c: number;
  r: string;
  t: string;
  d: number; // cosine distance from cluster centroid in embedding space (-1 = noise)
  s: string;
};

export type Cluster = {
  id: number;
  size: number;
  label: string;
  tfidf_label: string;
  keywords: string[];
  top_repos: string[];
  exemplar_ids: string[];
  exemplars: string[];
  center3d: [number, number, number];
  cohesion: number;
  is_skill_candidate: boolean;
  family_id: number;
  family_label: string;
};

export type SkillProposal = {
  cluster_id: number;
  accepted: boolean;
  reason: string;
  name: string;
  description: string;
  when_to_use: string;
  when_not_to_use: string;
  body_md: string;
  skill_md: string;
  specificity: number;
  conflicts_with_bundled: string;
  dedupe_of: number | null;
};

export type ProviderInfo = { provider: string; model: string };

export type Stats = {
  total: number;
  n_clusters: number;
  n_noise: number;
  n_repos: number;
  chat: ProviderInfo;
  embed: ProviderInfo;
  generated_at: string;
};

export type Dataset = {
  stats: Stats;
  clusters: Cluster[];
  points: Point[];
  repos: string[];
  skills: SkillProposal[];
};

export type SessionTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  turn_idx: number;
  timestamp: string;
  is_user_prompt: boolean;
  is_slash: boolean;
  slash_cmd: string | null;
};

export type SessionFile = {
  session_id: string;
  project_dir: string;
  repo: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  turns: SessionTurn[];
};
