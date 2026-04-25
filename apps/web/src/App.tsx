import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Dataset, Point } from "./types";
import { Galaxy } from "./Galaxy";
import { SkillsPanel } from "./SkillsPanel";
import { ConversationDrawer } from "./ConversationDrawer";
import { Stat } from "./Stat";

type OpenThread = { sessionId: string; turnId: string };

export function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [openThread, setOpenThread] = useState<OpenThread | null>(null);
  const [repoFilter, setRepoFilter] = useState<string>("");

  useEffect(() => {
    fetch("/data/web.json")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  const points = useMemo<Point[]>(() => {
    if (!data) return [];
    if (!repoFilter) return data.points;
    return data.points.filter((p) => p.r === repoFilter);
  }, [data, repoFilter]);

  // Galaxy filter: only show suns for clusters that became accepted skills.
  // The sidebar "all clusters" tab still surfaces the full 120-cluster set,
  // but the galaxy's purpose is "here are your skills" so unaccepted clusters
  // just pile the view with meaningless suns.
  const acceptedClusterIds = useMemo(
    () => new Set((data?.skills ?? []).filter((s) => s.accepted).map((s) => s.cluster_id)),
    [data],
  );
  const galaxyClusters = useMemo(
    () => (data?.clusters ?? []).filter((c) => acceptedClusterIds.has(c.id)),
    [data, acceptedClusterIds],
  );
  // Session-level clusters (id ≥ 10000) have no points whose `p.c` matches — their
  // prompts are labeled with their ORIGINAL prompt-cluster id. Synthesize planet
  // points for each session-cluster skill by pulling every prompt from the
  // sessions that contributed to it (identified via the session_ids of its
  // exemplar turns).
  const SESSION_CLUSTER_ID_BASE = 10000;
  const galaxyPoints = useMemo(() => {
    if (!data) return points.filter((p) => acceptedClusterIds.has(p.c));
    const direct = points.filter((p) => acceptedClusterIds.has(p.c));
    // For each accepted session-cluster, find its member session_ids via the
    // exemplar turns, then include every prompt from those sessions (relabeled).
    const sessionClusters = (data.clusters ?? []).filter(
      (c) => c.id >= SESSION_CLUSTER_ID_BASE && acceptedClusterIds.has(c.id),
    );
    if (sessionClusters.length === 0) return direct;
    const pointById = new Map(data.points.map((p) => [p.id, p] as const));
    const synthesized: Point[] = [];
    const MAX_PLANETS_PER_SESSION_CLUSTER = 25;
    for (const c of sessionClusters) {
      const memberSessionIds = new Set<string>();
      for (const id of c.exemplar_ids) {
        const p = pointById.get(id);
        if (p?.s) memberSessionIds.add(p.s);
      }
      const bySession = new Map<string, Point[]>();
      for (const p of data.points) {
        if (!p.s || !memberSessionIds.has(p.s)) continue;
        const arr = bySession.get(p.s) ?? [];
        arr.push(p);
        bySession.set(p.s, arr);
      }
      // Round-robin sample across sessions until we hit the cap, so every
      // member session is represented.
      const queues = [...bySession.values()].map((arr) => arr.slice());
      const picked: Point[] = [];
      while (picked.length < MAX_PLANETS_PER_SESSION_CLUSTER && queues.some((q) => q.length > 0)) {
        for (const q of queues) {
          if (q.length === 0) continue;
          picked.push(q.shift()!);
          if (picked.length >= MAX_PLANETS_PER_SESSION_CLUSTER) break;
        }
      }
      for (const p of picked) synthesized.push({ ...p, c: c.id });
    }
    return [...direct, ...synthesized];
  }, [data, points, acceptedClusterIds]);

  if (err) {
    return (
      <div className="p-10 max-w-xl mx-auto">
        <h1 className="display text-2xl text-[color:var(--color-copper)]">transmission lost</h1>
        <pre className="mt-3 mono text-xs text-[color:var(--color-dust)]">{err}</pre>
        <p className="mt-5 text-sm text-[color:var(--color-ivory-soft)]">
          Run the pipeline first:{" "}
          <code className="mono text-[color:var(--color-brass)]">bun run pipeline</code>
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-full grid place-items-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="smallcaps text-[color:var(--color-dust)]"
        >
          charting the field…
        </motion.div>
      </div>
    );
  }

  const { stats, clusters, repos, skills } = data;
  const noisePct = (stats.n_noise / stats.total) * 100;
  const nSkills = skills.filter((s) => s.accepted).length;

  return (
    <div className="h-full flex flex-col">
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="relative px-6 pt-5 pb-4 border-b border-[color:var(--color-ink-rail)]"
      >
        <div className="flex items-end gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="smallcaps text-[color:var(--color-brass)]">
              an atlas of intent · vol. i
            </div>
            <h1 className="display text-[32px] leading-none mt-1.5 text-[color:var(--color-ivory)]">
              distill
            </h1>
            <div className="mono text-[10.5px] mt-2 text-[color:var(--color-dust)]">
              generated{" "}
              {new Date(stats.generated_at).toLocaleString(undefined, {
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>

          <div className="ml-auto flex items-stretch gap-0 border border-[color:var(--color-ink-rail)] rounded-[3px]">
            <Stat label="prompts" value={stats.total} />
            <Divider />
            <Stat label="skills" value={nSkills} />
            <Divider />
            <Stat label="clusters" value={stats.n_clusters} />
            <Divider />
            <Stat label="noise" value={`${noisePct.toFixed(0)}%`} />
            <Divider />
            <Stat label="repos" value={stats.n_repos} />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs">
          <label className="smallcaps text-[color:var(--color-dust)]">filter · repo</label>
          <div className="relative">
            <select
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              className="mono text-xs px-2.5 py-1 bg-transparent border border-[color:var(--color-ink-rail)] rounded-[3px] text-[color:var(--color-ivory)] appearance-none pr-7 max-w-[280px] focus:border-[color:var(--color-brass)]"
            >
              <option value="" className="bg-[color:var(--color-ink-abyss)]">all repos ({repos.length})</option>
              {repos.map((r) => (
                <option key={r} value={r} className="bg-[color:var(--color-ink-abyss)]">{r}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--color-brass)]">
              ▾
            </span>
          </div>
          <AnimatePresence>
            {selectedCluster !== null && (
              <motion.button
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                onClick={() => setSelectedCluster(null)}
                className="smallcaps text-[color:var(--color-copper)] hover:text-[color:var(--color-brass-bright)] transition-colors"
              >
                ◇ clear selection
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.header>

      <main className="flex-1 grid grid-cols-[1fr_440px] min-h-0">
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.9 }}
          className="relative"
        >
          <Galaxy
            points={galaxyPoints}
            clusters={galaxyClusters}
            selectedCluster={selectedCluster}
            onSelectCluster={setSelectedCluster}
            onOpenThread={(p) => {
              if (!p.s) return;
              setOpenThread({ sessionId: p.s, turnId: p.id });
              // Focus the planet's solar system so other labels dim.
              if (p.c >= 0) setSelectedCluster(p.c);
            }}
          />

          {/* Observatory chrome: compass rose + legend */}
          <div className="absolute top-4 left-4 pointer-events-none select-none">
            <CompassRose />
          </div>
          {/* Corner ticks */}
          <CornerTicks />
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative border-l border-[color:var(--color-ink-rail)] min-h-0 bg-[color:var(--color-ink-deep)]/40 backdrop-blur-[1px]"
        >
          <SkillsPanel
            clusters={clusters}
            skills={skills}
            points={data.points}
            selectedCluster={selectedCluster}
            onSelectCluster={setSelectedCluster}
            onOpenThread={(turnId) => {
              const p = data.points.find((pp) => pp.id === turnId);
              if (!p?.s) return;
              setOpenThread({ sessionId: p.s, turnId });
              if (p.c >= 0) setSelectedCluster(p.c);
            }}
          />
        </motion.aside>
      </main>

      <AnimatePresence>
        {openThread && (
          <ConversationDrawer
            key={`${openThread.sessionId}:${openThread.turnId}`}
            sessionId={openThread.sessionId}
            turnId={openThread.turnId}
            onClose={() => setOpenThread(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Divider() {
  return <div className="w-px bg-[color:var(--color-ink-rail)] self-stretch" />;
}


function CompassRose() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="opacity-60">
      <g stroke="var(--color-brass-dim)" strokeWidth="0.6" fill="none">
        <circle cx="22" cy="22" r="18" />
        <circle cx="22" cy="22" r="12" strokeOpacity="0.6" />
        <line x1="22" y1="2" x2="22" y2="42" />
        <line x1="2" y1="22" x2="42" y2="22" strokeOpacity="0.6" />
        <line x1="22" y1="22" x2="22" y2="6" strokeWidth="1.1" />
      </g>
      <text
        x="22"
        y="5.5"
        textAnchor="middle"
        fontFamily="IBM Plex Mono, monospace"
        fontSize="6"
        fill="var(--color-brass)"
        letterSpacing="0.1em"
      >
        N
      </text>
    </svg>
  );
}

function CornerTicks() {
  return (
    <>
      {["tl", "tr", "bl", "br"].map((pos) => (
        <div
          key={pos}
          className={
            "absolute pointer-events-none " +
            (pos.includes("t") ? "top-4 " : "bottom-4 ") +
            (pos.includes("l") ? "left-4" : "right-4")
          }
        >
          <div
            className="w-3 h-px"
            style={{
              background: "var(--color-brass-dim)",
              opacity: 0.4,
              transform: pos === "tr" || pos === "br" ? "translateX(8px)" : "",
            }}
          />
          <div
            className="h-3 w-px"
            style={{
              background: "var(--color-brass-dim)",
              opacity: 0.4,
              marginTop: pos.includes("t") ? 0 : -12,
              transform: pos === "bl" || pos === "br" ? "translateY(-8px)" : "",
            }}
          />
        </div>
      ))}
    </>
  );
}
