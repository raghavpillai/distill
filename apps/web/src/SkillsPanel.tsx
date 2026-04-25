import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Streamdown } from "streamdown";
import type { Cluster, Point, SkillProposal } from "./types";
import { clusterColor } from "./colors";
import { Input } from "./ui/Input";

type Props = {
  clusters: Cluster[];
  skills: SkillProposal[];
  points: Point[];
  selectedCluster: number | null;
  onSelectCluster: (id: number | null) => void;
  onOpenThread: (turnId: string) => void;
};

type Tab = "skills" | "all";

export function SkillsPanel({
  clusters,
  skills,
  points,
  selectedCluster,
  onSelectCluster,
  onOpenThread,
}: Props) {
  const [tab, setTab] = useState<Tab>("skills");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement | null>());

  const clusterById = useMemo(() => {
    const m = new Map<number, Cluster>();
    for (const c of clusters) m.set(c.id, c);
    return m;
  }, [clusters]);

  const acceptedSkills = useMemo(
    () =>
      skills
        .filter((s) => s.accepted && s.name && s.body_md)
        .filter((s) => clusterById.has(s.cluster_id)),
    [skills, clusterById],
  );

  const skillByClusterId = useMemo(() => {
    const m = new Map<number, SkillProposal>();
    for (const s of skills) m.set(s.cluster_id, s);
    return m;
  }, [skills]);

  const displayedSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? acceptedSkills
      : acceptedSkills.filter((s) => {
          const c = clusterById.get(s.cluster_id)!;
          return (
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.body_md.toLowerCase().includes(q) ||
            c.keywords.some((k) => k.toLowerCase().includes(q)) ||
            c.exemplars.some((e) => e.toLowerCase().includes(q))
          );
        });
    return [...base].sort((a, b) => {
      const ca = clusterById.get(a.cluster_id)!.size;
      const cb = clusterById.get(b.cluster_id)!.size;
      return cb - ca;
    });
  }, [acceptedSkills, clusterById, query]);

  const displayedAllClusters = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = clusters;
    if (q) {
      list = list.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.keywords.some((k) => k.toLowerCase().includes(q)) ||
          c.top_repos.some((r) => r.toLowerCase().includes(q)) ||
          c.exemplars.some((e) => e.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => b.size - a.size);
  }, [clusters, query]);

  // When a cluster becomes selected (via clicking a sun in 3D, a sidebar row,
  // or a planet), make sure it's visible in the sidebar:
  //   1. If the current tab doesn't contain a row for it, flip tabs.
  //   2. Scroll that row into view once it's rendered.
  useEffect(() => {
    if (selectedCluster === null) return;
    const inSkills = acceptedSkills.some((s) => s.cluster_id === selectedCluster);
    if (tab === "skills" && !inSkills) {
      setTab("all");
      return;
    }
    // Defer one frame so rows (possibly freshly mounted from a tab flip) have
    // registered their refs before we try to scroll to them.
    const raf = requestAnimationFrame(() => {
      const row = rowRefs.current.get(selectedCluster);
      const container = listRef.current;
      if (!row || !container) return;
      const rRect = row.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const above = rRect.top < cRect.top + 40;
      const below = rRect.bottom > cRect.bottom - 40;
      if (above || below) row.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedCluster, tab, acceptedSkills]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="relative px-4 py-3 border-b border-[color:var(--color-ink-rail)] bg-[color:var(--color-ink-deep)]/60 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="smallcaps text-[color:var(--color-brass)]">
            proposed skills · {acceptedSkills.length}
          </div>
          <div className="flex gap-0 border border-[color:var(--color-ink-rail)] rounded-[3px]">
            <TabBtn active={tab === "skills"} onClick={() => setTab("skills")}>
              skills
            </TabBtn>
            <div className="w-px self-stretch bg-[color:var(--color-ink-rail)]" />
            <TabBtn active={tab === "all"} onClick={() => setTab("all")}>
              all clusters
            </TabBtn>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            type="search"
            placeholder={
              tab === "skills" ? "seek within proposed skills…" : "seek within all clusters…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {tab === "skills" && (
          <>
            {displayedSkills.length === 0 && (
              <div className="p-5 mono text-xs text-[color:var(--color-dust)] italic">
                — no proposed skills match —
              </div>
            )}
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.015 } } }}
            >
              {displayedSkills.map((s) => {
                const c = clusterById.get(s.cluster_id)!;
                const selected = selectedCluster === c.id;
                return (
                  <motion.li
                    key={s.cluster_id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(c.id, el);
                      else rowRefs.current.delete(c.id);
                    }}
                    variants={{
                      hidden: { opacity: 0, y: 6 },
                      show: { opacity: 1, y: 0, transition: { duration: 0.32 } },
                    }}
                    className="relative border-b border-[color:var(--color-ink-rail)]/60"
                  >
                    <button
                      onClick={() => onSelectCluster(selected ? null : c.id)}
                      className={
                        "w-full text-left px-4 py-3 group transition-colors " +
                        (selected
                          ? "bg-[color:var(--color-ink-rail)]/40"
                          : "hover:bg-[color:var(--color-ink-rail)]/20")
                      }
                    >
                      <div className="flex items-center gap-3">
                        <motion.span
                          className="inline-block rounded-full flex-none"
                          style={{
                            width: 9,
                            height: 9,
                            background: clusterColor(c.id),
                            boxShadow: `0 0 0 1px rgba(242,235,217,0.12), 0 0 ${selected ? 14 : 6}px ${clusterColor(c.id)}${selected ? "dd" : "80"}`,
                          }}
                          animate={selected ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                          transition={selected ? { repeat: Infinity, duration: 2.4 } : {}}
                        />
                        <span className="mono tnum text-[10.5px] text-[color:var(--color-brass)]">
                          /{s.name}
                        </span>
                        <span className="mono tnum text-[10.5px] text-[color:var(--color-dust)] ml-auto">
                          ×{c.size}
                        </span>
                      </div>
                      <div className="mt-1 display text-[14px] text-[color:var(--color-ivory-soft)] leading-snug">
                        {s.description}
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {selected && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <SkillCard
                            skill={s}
                            cluster={c}
                            points={points}
                            onOpenThread={onOpenThread}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </motion.ul>
          </>
        )}

        {tab === "all" && (
          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.015 } } }}
          >
            {displayedAllClusters.map((c) => {
              const selected = selectedCluster === c.id;
              const skill = skillByClusterId.get(c.id);
              let badge: { text: string; tone: string; title?: string } | null = null;
              if (skill?.accepted) {
                badge = {
                  text: `/${skill.name}`,
                  tone: "text-[color:var(--color-brass-bright)]",
                  title: skill.description,
                };
              } else if (skill?.conflicts_with_bundled) {
                badge = {
                  text: `≡ /${skill.conflicts_with_bundled}`,
                  tone: "text-[color:var(--color-verdigris)]",
                  title: "Overlaps with a bundled Claude Code skill",
                };
              } else if (skill?.dedupe_of !== undefined && skill?.dedupe_of !== null) {
                badge = {
                  text: "merged",
                  tone: "text-[color:var(--color-dust)]",
                  title: skill.reason,
                };
              } else if (skill) {
                badge = {
                  text: "not a skill",
                  tone: "text-[color:var(--color-dust)]",
                  title: skill.reason,
                };
              }
              return (
                <motion.li
                  key={c.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(c.id, el);
                    else rowRefs.current.delete(c.id);
                  }}
                  variants={{
                    hidden: { opacity: 0, y: 6 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
                  }}
                  className="relative border-b border-[color:var(--color-ink-rail)]/60"
                >
                  <button
                    onClick={() => onSelectCluster(selected ? null : c.id)}
                    className={
                      "w-full text-left px-4 py-3 flex items-center gap-2.5 " +
                      (selected
                        ? "bg-[color:var(--color-ink-rail)]/40"
                        : "hover:bg-[color:var(--color-ink-rail)]/20")
                    }
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full flex-none"
                      style={{
                        background: clusterColor(c.id),
                        boxShadow: `0 0 0 1px rgba(242,235,217,0.12)`,
                      }}
                    />
                    <span className="mono tnum text-[10.5px] text-[color:var(--color-dust)]">
                      {String(c.id).padStart(3, "0")}
                    </span>
                    <span className="mono tnum text-[10.5px] text-[color:var(--color-brass)]">
                      n={c.size}
                    </span>
                    <span className="display text-[14px] text-[color:var(--color-ivory)] truncate flex-1">
                      {c.label}
                    </span>
                    {badge && (
                      <span
                        className={`mono text-[10px] ${badge.tone}`}
                        title={badge.title ?? ""}
                      >
                        {badge.text}
                      </span>
                    )}
                  </button>
                  <AnimatePresence initial={false}>
                    {selected && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pl-[34px]">
                          <ConvoTree
                            clusterId={c.id}
                            points={points}
                            onOpenThread={onOpenThread}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "mono text-[10.5px] px-3 py-1.5 tracking-[0.08em] transition-colors " +
        (active
          ? "text-[color:var(--color-brass)] bg-[color:var(--color-ink-rail)]/40"
          : "text-[color:var(--color-ivory-soft)] hover:text-[color:var(--color-brass)]")
      }
    >
      {children}
    </button>
  );
}

function SkillCard({
  skill,
  cluster,
  points,
  onOpenThread,
}: {
  skill: SkillProposal;
  cluster: Cluster;
  points: Point[];
  onOpenThread: (turnId: string) => void;
}) {
  const summary = useMemo(() => summarizeWorkflow(skill), [skill]);

  return (
    <div className="px-4 pb-4 ml-5 space-y-4">
      {skill.when_to_use && (
        <KvRow
          k="trigger"
          v={skill.when_to_use}
          className="italic text-[color:var(--color-ivory-soft)]"
        />
      )}

      <div className="border-l-2 border-[color:var(--color-brass-dim)]/60 bg-[color:var(--color-ink-rail)]/20 px-3.5 py-2.5 rounded-r-[3px]">
        <div className="prose-skill text-[12.5px] leading-[1.6] font-body text-[color:var(--color-ivory)]">
          <Streamdown>{summary}</Streamdown>
        </div>
      </div>

      <details className="group" open={false}>
        <summary className="cursor-pointer list-none smallcaps text-[color:var(--color-brass)] hover:text-[color:var(--color-brass-bright)] select-none">
          <span className="inline-block transition-transform group-open:rotate-90 mr-1.5">
            ▸
          </span>
          proposed skill details
        </summary>
        <dl className="mt-2 space-y-1.5 pl-4 border-l border-[color:var(--color-ink-rail)]">
          <MetaRow k="name" v={`/${skill.name}`} mono />
          <MetaRow k="specificity" v={`${skill.specificity}/3`} mono />
          <MetaRow k="cohesion" v={cluster.cohesion.toFixed(2)} mono />
          <MetaRow k="family" v={cluster.family_label || "—"} />
          {skill.when_not_to_use && <MetaRow k="avoid when" v={skill.when_not_to_use} />}
          {skill.conflicts_with_bundled && (
            <MetaRow k="conflicts" v={`/${skill.conflicts_with_bundled}`} mono />
          )}
          {skill.reason && <MetaRow k="judge note" v={skill.reason} />}
        </dl>
      </details>

      <ConvoTree
        clusterId={cluster.id}
        points={points}
        onOpenThread={onOpenThread}
      />
    </div>
  );
}

function KvRow({
  k,
  v,
  mono,
  className,
}: {
  k: string;
  v: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="flex gap-3 text-[12px]">
      <div className="smallcaps text-[color:var(--color-dust)] flex-none w-16">{k}</div>
      <div
        className={
          (mono ? "mono " : "") +
          "text-[color:var(--color-ivory-soft)] break-words " +
          (className ?? "")
        }
      >
        {v}
      </div>
    </div>
  );
}

function MetaRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-[11.5px]">
      <dt className="smallcaps text-[color:var(--color-dust)] flex-none w-[84px] pt-px">
        {k}
      </dt>
      <dd
        className={
          (mono ? "mono " : "") +
          "text-[color:var(--color-ivory-soft)] break-words leading-[1.55]"
        }
      >
        {v}
      </dd>
    </div>
  );
}

function cleanTurnText(t: string): string {
  return t
    .replace(
      /<(local-command-[^>]+|system-reminder|command-name|command-message|command-args)>[\s\S]*?<\/\1>/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

// Tree of conversations that contributed to this cluster.
//   session (repo) ── turns within that session ── click a turn → open log.
// We group by session id (so one repo that was touched over many days shows
// up as distinct conversations), then sort sessions by turn count.
function ConvoTree({
  clusterId,
  points,
  onOpenThread,
}: {
  clusterId: number;
  points: Point[];
  onOpenThread: (turnId: string) => void;
}) {
  const sessions = useMemo(() => {
    const m = new Map<string, Point[]>();
    for (const p of points) {
      if (p.c !== clusterId) continue;
      if (!p.s) continue;
      const arr = m.get(p.s) ?? [];
      arr.push(p);
      m.set(p.s, arr);
    }
    return [...m.entries()]
      .map(([sessionId, pts]) => ({
        sessionId,
        pts,
        repo: pts[0]!.r || "—",
      }))
      .sort((a, b) => b.pts.length - a.pts.length);
  }, [clusterId, points]);

  const totalTurns = sessions.reduce((sum, s) => sum + s.pts.length, 0);

  if (sessions.length === 0) {
    return (
      <div className="pt-1 mono text-[11px] text-[color:var(--color-dust)] italic">
        — no source conversations —
      </div>
    );
  }

  return (
    <div className="pt-1">
      <div className="smallcaps text-[color:var(--color-brass)] mb-2">
        {sessions.length} conversation{sessions.length !== 1 ? "s" : ""} ·{" "}
        {totalTurns} turn{totalTurns !== 1 ? "s" : ""}
      </div>
      <ul className="space-y-0.5">
        {sessions.map((s) => (
          <ConvoNode key={s.sessionId} session={s} onOpenThread={onOpenThread} />
        ))}
      </ul>
    </div>
  );
}

function ConvoNode({
  session,
  onOpenThread,
}: {
  session: { sessionId: string; pts: Point[]; repo: string };
  onOpenThread: (turnId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const plural = session.pts.length !== 1;
  const firstPreview = useMemo(
    () => cleanTurnText(session.pts[0]?.t ?? "").slice(0, 80),
    [session.pts],
  );
  return (
    <li className="group/node">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left pl-1 pr-2 py-1 flex items-center gap-2 hover:bg-[color:var(--color-ink-rail)]/25 transition-colors rounded-[2px]"
      >
        <motion.span
          className="mono text-[11px] text-[color:var(--color-brass-dim)] flex-none w-3"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
        >
          ▸
        </motion.span>
        <span className="mono text-[11px] text-[color:var(--color-ivory-soft)] group-hover/node:text-[color:var(--color-brass)] transition-colors flex-none">
          {session.repo}
        </span>
        <span className="font-body italic text-[11.5px] text-[color:var(--color-dust)] truncate flex-1 min-w-0">
          {firstPreview}
        </span>
        <span className="mono tnum text-[10px] text-[color:var(--color-dust)] flex-none">
          {session.pts.length} turn{plural ? "s" : ""}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden ml-[7px] border-l border-[color:var(--color-ink-rail)]"
          >
            {session.pts.map((p, i) => (
              <TurnRow
                key={p.id}
                index={i}
                turn={p}
                onOpenThread={onOpenThread}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function TurnRow({
  index,
  turn,
  onOpenThread,
}: {
  index: number;
  turn: Point;
  onOpenThread: (turnId: string) => void;
}) {
  const preview = useMemo(() => cleanTurnText(turn.t), [turn.t]);
  return (
    <li className="group/turn">
      <button
        onClick={() => onOpenThread(turn.id)}
        className="w-full text-left pl-3 pr-2 py-1 flex items-start gap-2 hover:bg-[color:var(--color-ink-rail)]/20 transition-colors"
        title="jump to this turn in the log"
      >
        <span className="mono text-[10px] text-[color:var(--color-dust)] pt-[3px] flex-none group-hover/turn:text-[color:var(--color-brass)] transition-colors">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="text-[12px] leading-[1.48] text-[color:var(--color-ivory-soft)] line-clamp-2 flex-1 group-hover/turn:text-[color:var(--color-ivory)] transition-colors">
          {preview}
        </span>
        <span className="smallcaps text-[color:var(--color-copper)] opacity-0 group-hover/turn:opacity-100 transition-opacity pt-[2px] flex-none">
          ◇
        </span>
      </button>
    </li>
  );
}

// Build a short, human-readable workflow summary from the proposal.
// Deliberately does NOT surface the full SKILL.md — that file lives on disk
// once a user adopts a proposal; here we just describe what they do.
function summarizeWorkflow(skill: SkillProposal): string {
  const body = (skill.body_md || "").trim();
  // If body_md already reads like a workflow (numbered list, bullets, prose),
  // drop any leading "# Title" / "## Heading" rows and render as-is.
  const lines = body.split("\n");
  const kept: string[] = [];
  let skippedFrontTitle = false;
  for (const line of lines) {
    if (!skippedFrontTitle && /^#{1,2}\s+/.test(line.trim())) continue;
    if (!skippedFrontTitle && line.trim() === "") continue;
    skippedFrontTitle = true;
    kept.push(line);
  }
  const trimmed = kept.join("\n").trim();
  if (trimmed) return trimmed;
  // Fallback: synthesize from description.
  return skill.description || "No summary available.";
}
