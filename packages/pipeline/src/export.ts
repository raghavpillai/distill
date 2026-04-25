/**
 * Produce the web bundle (data/web.json) and a lightweight sessions index for the drill-down drawer.
 *
 * data/web.json is small (clusters + points + stats); the web fetches it once.
 * data/sessions/<session_id>.json is fetched on demand when the user clicks a point.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "./common.ts";
import { existsSync } from "node:fs";
import { chatInfo, embedInfo } from "./ai.ts";
import type { Cluster, Point, Session, SkillProposal, Turn, WebBundle } from "./types.ts";

function splitProviderModel(s: string): { provider: string; model: string } {
  // embeddings.json stores "provider:model" — split once.
  const i = s.indexOf(":");
  if (i > 0) return { provider: s.slice(0, i), model: s.slice(i + 1) };
  return { provider: "unknown", model: s };
}

function main(): void {
  const turns = JSON.parse(readFileSync(`${DATA_DIR}turns.json`, "utf8")) as Turn[];
  const sessions = JSON.parse(readFileSync(`${DATA_DIR}sessions.json`, "utf8")) as Session[];
  const clusters = JSON.parse(readFileSync(`${DATA_DIR}clusters.json`, "utf8")) as Cluster[];
  const points = JSON.parse(readFileSync(`${DATA_DIR}points.json`, "utf8")) as Point[];
  const embMeta = JSON.parse(readFileSync(`${DATA_DIR}embeddings.json`, "utf8")) as {
    model: string;
  };

  // chat provider is what suggest/label ran with (pulled from env at runtime).
  // embed provider was recorded at embed time into embeddings.json.
  const chat = chatInfo();
  const embedFromFile = splitProviderModel(embMeta.model);
  const embed = embedFromFile.provider !== "unknown" ? embedFromFile : embedInfo();

  const turnById = new Map<string, Turn>();
  for (const t of turns) turnById.set(t.id, t);

  const stats: WebBundle["stats"] = {
    total: points.length,
    n_clusters: clusters.length,
    n_noise: points.filter((p) => p.c === -1).length,
    n_repos: new Set(points.map((p) => p.r)).size,
    chat,
    embed,
    generated_at: new Date().toISOString(),
  };

  // Augment point metadata with session id so the UI can look up the thread.
  const pointsWithSession = points.map((p) => {
    const t = turnById.get(p.id);
    return { ...p, s: t?.session_id ?? "" };
  });

  const skillsPath = `${DATA_DIR}skills.json`;
  const skills: SkillProposal[] = existsSync(skillsPath)
    ? (JSON.parse(readFileSync(skillsPath, "utf8")) as SkillProposal[])
    : [];

  const bundle = {
    stats,
    clusters,
    points: pointsWithSession,
    repos: Array.from(new Set(points.map((p) => p.r))).sort(),
    skills,
  };

  writeFileSync(`${DATA_DIR}web.json`, JSON.stringify(bundle));
  const mb = (Buffer.byteLength(JSON.stringify(bundle)) / 1024 / 1024).toFixed(2);
  console.log(`wrote ${DATA_DIR}web.json  (${points.length} points, ${clusters.length} clusters, ${mb} MB)`);

  // Per-session files for the drawer.
  const sessionsDir = `${DATA_DIR}sessions/`;
  mkdirSync(sessionsDir, { recursive: true });
  let written = 0;
  const slim = (t: Turn) => ({
    id: t.id,
    role: t.role,
    text: t.text,
    turn_idx: t.turn_idx,
    timestamp: t.timestamp,
    is_user_prompt: t.is_user_prompt,
    is_slash: t.is_slash,
    slash_cmd: t.slash_cmd,
  });
  for (const s of sessions) {
    const thread = s.turn_ids
      .map((id) => turnById.get(id))
      .filter((t): t is Turn => Boolean(t))
      .map(slim);
    const payload = {
      session_id: s.session_id,
      project_dir: s.project_dir,
      repo: s.repo,
      cwd: s.cwd,
      started_at: s.started_at,
      ended_at: s.ended_at,
      turns: thread,
    };
    // session ids can be empty strings for old logs; skip those.
    if (!s.session_id) continue;
    writeFileSync(`${sessionsDir}${s.session_id}.json`, JSON.stringify(payload));
    written++;
  }
  console.log(`wrote ${written} session files under ${sessionsDir}`);
}

main();
