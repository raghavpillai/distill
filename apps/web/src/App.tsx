import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Dataset, Point } from "./types";
import { Galaxy } from "./Galaxy";
import { SkillsPanel } from "./SkillsPanel";
import { ConversationDrawer } from "./ConversationDrawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";

export type CompassState = { yaw: number; pitch: number };

type OpenThread = { sessionId: string; turnId: string };

export function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [openThread, setOpenThread] = useState<OpenThread | null>(null);
  const [repoFilter, setRepoFilter] = useState<string>("");
  // Live camera orientation, populated each frame from inside the Canvas. We
  // share via ref + RAF so React doesn't re-render on every camera tick.
  const compassRef = useRef<CompassState>({ yaw: 0, pitch: 0 });
  // Bump to ask the Canvas's CameraRig to fly back to the default home view.
  // Counter rather than boolean so we re-trigger if the user clicks twice.
  const [recenterToken, setRecenterToken] = useState(0);
  const recenter = () => {
    setSelectedCluster(null); // also clears any active focus
    setRecenterToken((n) => n + 1);
  };

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
        {/* Stats anchored to the top-right corner of the page (above the title) */}
        <motion.div
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute top-3 right-6"
        >
          <StatRow
            items={[
              { label: "prompts", value: stats.total },
              { label: "skills", value: nSkills },
              { label: "clusters", value: stats.n_clusters },
              { label: "noise", value: `${noisePct.toFixed(0)}%` },
              { label: "repos", value: stats.n_repos },
            ]}
          />
        </motion.div>

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
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs">
          <label className="smallcaps text-[color:var(--color-dust)]">filter · repo</label>
          <Select
            value={repoFilter || "__all__"}
            onValueChange={(v) => setRepoFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">all repos ({repos.length})</SelectItem>
              {repos.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            compassRef={compassRef}
            recenterToken={recenterToken}
            onOpenThread={(p) => {
              if (!p.s) return;
              setOpenThread({ sessionId: p.s, turnId: p.id });
              // Focus the planet's solar system so other labels dim.
              if (p.c >= 0) setSelectedCluster(p.c);
            }}
          />

          {/* Observatory chrome: compass rose + legend. Pointer-events on the
              compass itself (the wrapper stays non-interactive). */}
          <div className="absolute top-4 left-4 select-none pointer-events-none">
            <button
              onClick={recenter}
              title="Recenter view"
              aria-label="Recenter view"
              className="pointer-events-auto cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95 focus:outline-none rounded-full"
            >
              <CompassRose compassRef={compassRef} />
            </button>
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

// Compact, low-key inline stat row. Mono numbers + smallcaps labels separated
// by hairline middots, no border/panel chrome. Numbers count up gently on
// first paint to give the row a tiny pulse without screaming for attention.
type StatItem = { label: string; value: number | string };

function StatRow({ items }: { items: StatItem[] }) {
  return (
    <div className="flex items-baseline gap-x-3 text-[color:var(--color-dust)]">
      {items.map((it, i) => (
        <span key={it.label} className="flex items-baseline gap-1.5">
          {i > 0 && (
            <span className="text-[color:var(--color-brass-dim)]/50 mr-2 select-none">
              ·
            </span>
          )}
          <StatNumber value={it.value} />
          <span className="smallcaps text-[10px] text-[color:var(--color-dust)]">
            {it.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function StatNumber({ value }: { value: number | string }) {
  const [display, setDisplay] = useState(typeof value === "number" ? "0" : value);
  useEffect(() => {
    if (typeof value !== "number") {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - e, 3);
      setDisplay(Math.round(value * eased).toLocaleString());
      if (e < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="mono tnum text-[12px] text-[color:var(--color-ivory-soft)]">
      {display}
    </span>
  );
}


// Compass that tracks the 3D camera. The disc tilts (CSS perspective) on
// camera pitch and rotates on yaw, so the "N" needle always points toward
// the world-space "north" (−Z) regardless of where you've orbited.
function CompassRose({
  compassRef,
}: {
  compassRef: React.RefObject<CompassState>;
}) {
  const discRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { yaw, pitch } = compassRef.current ?? { yaw: 0, pitch: 0 };
      const yawDeg = (yaw * 180) / Math.PI;
      const pitchDeg = Math.max(-65, Math.min(65, (pitch * 180) / Math.PI));
      // The disc tilts back as the camera looks down at the galaxy. The needle
      // (rendered inside the disc) rotates so "north" stays in world space.
      if (discRef.current) {
        discRef.current.style.transform =
          `rotateX(${pitchDeg}deg) rotateZ(${-yawDeg}deg)`;
      }
      // Cardinal labels stay upright (counter-rotate) but ride the tilt with
      // the disc so they look like they're painted on it.
      if (labelsRef.current) {
        labelsRef.current.style.transform = `rotateZ(${yawDeg}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [compassRef]);

  return (
    <div
      style={{ perspective: "240px", perspectiveOrigin: "50% 60%" }}
      className="opacity-70"
    >
      <div
        ref={discRef}
        style={{
          width: 56,
          height: 56,
          transformStyle: "preserve-3d",
          willChange: "transform",
          transition: "transform 60ms linear",
        }}
        className="relative"
      >
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <radialGradient id="cmpGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(212, 168, 90, 0.08)" />
              <stop offset="100%" stopColor="rgba(212, 168, 90, 0)" />
            </radialGradient>
          </defs>
          <g stroke="var(--color-brass-dim)" strokeWidth="0.6" fill="none">
            <circle cx="28" cy="28" r="24" fill="url(#cmpGrad)" />
            <circle cx="28" cy="28" r="16" strokeOpacity="0.5" />
            <circle cx="28" cy="28" r="8" strokeOpacity="0.3" />
            <line x1="28" y1="2" x2="28" y2="54" strokeOpacity="0.4" />
            <line x1="2" y1="28" x2="54" y2="28" strokeOpacity="0.4" />
            {/* Tick marks every 30° */}
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i * Math.PI) / 6;
              const r1 = 22;
              const r2 = i % 3 === 0 ? 18 : 20;
              return (
                <line
                  key={i}
                  x1={28 + Math.sin(a) * r1}
                  y1={28 - Math.cos(a) * r1}
                  x2={28 + Math.sin(a) * r2}
                  y2={28 - Math.cos(a) * r2}
                  strokeOpacity={i % 3 === 0 ? "0.85" : "0.4"}
                />
              );
            })}
          </g>
          {/* Bright north needle */}
          <polygon
            points="28,5 26.4,28 29.6,28"
            fill="var(--color-brass)"
            opacity="0.95"
          />
          {/* South needle (dim) */}
          <polygon
            points="28,51 27,28 29,28"
            fill="var(--color-brass-dim)"
            opacity="0.6"
          />
          <circle cx="28" cy="28" r="1.6" fill="var(--color-brass)" />
        </svg>
        {/* Cardinal labels — counter-rotate on yaw so "N" reads right-side-up */}
        <div
          ref={labelsRef}
          style={{
            position: "absolute",
            inset: 0,
            transformStyle: "preserve-3d",
            willChange: "transform",
            transition: "transform 60ms linear",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: "-2px",
              transform: "translateX(-50%)",
              fontFamily: "IBM Plex Mono, monospace",
              fontSize: 8,
              letterSpacing: "0.14em",
              color: "var(--color-brass)",
            }}
          >
            N
          </span>
          {(["E", "S", "W"] as const).map((d, i) => (
            <span
              key={d}
              style={{
                position: "absolute",
                fontFamily: "IBM Plex Mono, monospace",
                fontSize: 7,
                letterSpacing: "0.14em",
                color: "var(--color-brass-dim)",
                opacity: 0.7,
                ...(i === 0
                  ? { top: "50%", right: "-1px", transform: "translateY(-50%)" }
                  : i === 1
                    ? { bottom: "-1px", left: "50%", transform: "translateX(-50%)" }
                    : { top: "50%", left: "-1px", transform: "translateY(-50%)" }),
              }}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CornerTicks() {
  // Frame corners drawn as 14×14 L-brackets. A short tick (3px) faces inward
  // along each axis. We hide the TL tick because the compass sits there.
  const corners: { key: string; pos: string; borders: string; tick: string }[] = [
    {
      key: "tr",
      pos: "top-3 right-3",
      borders: "border-t border-r",
      tick: "top: 6px; right: -1px; width: 1px; height: 4px;",
    },
    {
      key: "bl",
      pos: "bottom-3 left-3",
      borders: "border-b border-l",
      tick: "bottom: -1px; left: 6px; width: 4px; height: 1px;",
    },
    {
      key: "br",
      pos: "bottom-3 right-3",
      borders: "border-b border-r",
      tick: "bottom: -1px; right: 6px; width: 4px; height: 1px;",
    },
  ];
  return (
    <>
      {corners.map(({ key, pos, borders, tick }) => (
        <motion.div
          key={key}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 0.55, scale: 1 }}
          transition={{ delay: 0.5 + Math.random() * 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className={`absolute pointer-events-none ${pos} w-[14px] h-[14px] ${borders}`}
          style={{ borderColor: "var(--color-brass-dim)" }}
        >
          {/* tiny inward-facing tick */}
          <span
            style={
              {
                position: "absolute",
                background: "var(--color-brass-dim)",
                opacity: 0.7,
                ...Object.fromEntries(
                  tick.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
                    const [k, v] = s.split(":").map((x) => x.trim());
                    return [k!.replace(/-(\w)/g, (_m, c) => c.toUpperCase()), v];
                  }),
                ),
              } as React.CSSProperties
            }
          />
        </motion.div>
      ))}
    </>
  );
}
