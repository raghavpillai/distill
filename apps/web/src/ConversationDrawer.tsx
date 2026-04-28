import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionFile } from "./types";

type Props = {
  sessionId: string;
  turnId: string;
  onClose: () => void;
};

const CONTEXT_RADIUS = 6;

export function ConversationDrawer({ sessionId, turnId, onClose }: Props) {
  const [data, setData] = useState<SessionFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const targetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    fetch(`/data/sessions/${encodeURIComponent(sessionId)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, [sessionId]);

  useEffect(() => {
    if (!data || !targetRef.current) return;
    const t = setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: "instant", block: "center" });
    }, 360);
    return () => clearTimeout(t);
  }, [data]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Built once per session file so opening to a target turn is O(1) instead of
  // findIndex'ing through (potentially) thousands of turns each time the user
  // clicks a different turn in the same session.
  const turnIdxById = useMemo(() => {
    const m = new Map<string, number>();
    if (data) for (let i = 0; i < data.turns.length; i++) m.set(data.turns[i]!.id, i);
    return m;
  }, [data]);

  const { visibleTurns, totalTurns, hiddenBefore, hiddenAfter } = useMemo(() => {
    if (!data)
      return { visibleTurns: [], targetIdx: -1, totalTurns: 0, hiddenBefore: 0, hiddenAfter: 0 };
    const idx = turnIdxById.get(turnId) ?? -1;
    if (idx < 0 || expandAll)
      return {
        visibleTurns: data.turns,
        targetIdx: idx,
        totalTurns: data.turns.length,
        hiddenBefore: 0,
        hiddenAfter: 0,
      };
    const lo = Math.max(0, idx - CONTEXT_RADIUS);
    const hi = Math.min(data.turns.length, idx + CONTEXT_RADIUS + 1);
    return {
      visibleTurns: data.turns.slice(lo, hi),
      targetIdx: idx - lo,
      totalTurns: data.turns.length,
      hiddenBefore: lo,
      hiddenAfter: data.turns.length - hi,
    };
  }, [data, turnId, expandAll, turnIdxById]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, pointerEvents: "none" }}
        transition={{ duration: 0.16 }}
        className="absolute inset-0 bg-[color:var(--color-ink-abyss)]/70 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%", opacity: 0.6 }}
        animate={{
          x: 0,
          opacity: 1,
          transition: { type: "spring", stiffness: 280, damping: 34, mass: 0.9 },
        }}
        exit={{
          x: "100%",
          opacity: 0,
          pointerEvents: "none",
          transition: { duration: 0.18, ease: [0.7, 0, 0.84, 0] },
        }}
        className="relative ml-auto h-full w-full max-w-[780px] flex flex-col bg-[color:var(--color-ink-deep)] border-l border-[color:var(--color-brass-dim)]/40 shadow-[0_0_80px_-10px_rgba(0,0,0,0.6)]"
      >
        {/* ornamental left rule */}
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-[color:var(--color-brass-dim)]/60 to-transparent" />
        <header className="relative px-6 pt-5 pb-4 border-b border-[color:var(--color-ink-rail)] sticky top-0 bg-[color:var(--color-ink-deep)]/95 backdrop-blur z-10">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="smallcaps text-[color:var(--color-brass)]">log · transcribed</div>
              <div className="mt-1 flex items-baseline gap-3 flex-wrap">
                <h2 className="display text-[20px] leading-tight text-[color:var(--color-ivory)]">
                  {data?.repo ?? "…"}
                </h2>
                <span className="mono text-[10.5px] text-[color:var(--color-dust)]">
                  {data?.cwd ? shortenPath(data.cwd) : ""}
                </span>
              </div>
              <div className="mt-1.5 mono text-[10.5px] text-[color:var(--color-dust)] tracking-[0.08em]">
                <span>session ⟨{sessionId.slice(0, 8)}⟩</span>
                <span className="mx-2 opacity-40">·</span>
                <span>{totalTurns} turns</span>
                {data?.started_at && (
                  <>
                    <span className="mx-2 opacity-40">·</span>
                    <span>
                      {formatTs(data.started_at)}
                      {data.ended_at && data.ended_at !== data.started_at
                        ? ` → ${formatTs(data.ended_at)}`
                        : ""}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpandAll((v) => !v)}
                className="mono text-[10.5px] tracking-[0.08em] px-2.5 py-1.5 border border-[color:var(--color-ink-rail)] rounded-[3px] text-[color:var(--color-ivory-soft)] hover:text-[color:var(--color-brass)] hover:border-[color:var(--color-brass-dim)] transition-colors"
              >
                {expandAll ? "CONTEXT" : "FULL LOG"}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="mono text-[10.5px] tracking-[0.08em] px-2.5 py-1.5 border border-[color:var(--color-ink-rail)] rounded-[3px] text-[color:var(--color-ivory-soft)] hover:text-[color:var(--color-copper)] hover:border-[color:var(--color-copper-dim)] transition-colors"
              >
                ESC ✕
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {err && (
            <div className="mono text-xs text-[color:var(--color-copper)]">
              failed to load: {err}
            </div>
          )}
          {!data && !err && (
            <div className="mono text-xs text-[color:var(--color-dust)] italic">transcribing…</div>
          )}

          {!!hiddenBefore && <Marginalia>⟨ {hiddenBefore} earlier turns folded ⟩</Marginalia>}

          <AnimatePresence mode="popLayout">
            {visibleTurns.map((turn, i) => {
              const isTarget = turn.id === turnId;
              return (
                <motion.div
                  key={turn.id}
                  ref={isTarget ? targetRef : undefined}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className={
                    "relative rounded-[3px] px-4 py-3 " +
                    (isTarget
                      ? "bg-[color:var(--color-ink-rail)]/50 border border-[color:var(--color-brass)]/60"
                      : turn.role === "user"
                        ? "bg-[color:var(--color-ink-rail)]/25 border border-[color:var(--color-ink-rail)]/80"
                        : turn.role === "assistant"
                          ? "bg-[color:var(--color-ink-deep)] border border-[color:var(--color-ink-rail)]/40"
                          : "bg-[color:var(--color-ink-abyss)] border border-[color:var(--color-ink-rail)]/30 italic")
                  }
                >
                  {isTarget && (
                    <motion.div
                      initial={{ opacity: 0.0 }}
                      animate={{ opacity: [0.0, 0.6, 0.15] }}
                      transition={{ duration: 1.8, ease: "easeOut" }}
                      className="absolute inset-0 rounded-[3px] pointer-events-none"
                      style={{
                        boxShadow: "0 0 0 1px var(--color-brass), 0 0 30px var(--color-brass)",
                      }}
                    />
                  )}
                  <div className="flex items-baseline gap-2 mb-2">
                    <RoleBadge role={turn.role} />
                    {turn.is_slash && turn.slash_cmd && (
                      <span className="mono text-[10px] px-1.5 py-0.5 rounded-[2px] bg-[color:var(--color-brass-dim)]/30 text-[color:var(--color-brass-bright)]">
                        /{turn.slash_cmd}
                      </span>
                    )}
                    {isTarget && (
                      <span className="smallcaps text-[color:var(--color-brass)]">◈ target</span>
                    )}
                    <span className="ml-auto mono tnum text-[10px] text-[color:var(--color-dust)] tracking-[0.08em]">
                      ⟨{String(turn.turn_idx).padStart(3, "0")}⟩
                      {turn.timestamp && (
                        <>
                          <span className="mx-1.5 opacity-40">·</span>
                          {formatTs(turn.timestamp)}
                        </>
                      )}
                    </span>
                  </div>
                  <TurnBody text={turn.text} collapsed={!isTarget && !expandAll && i !== 0} />
                </motion.div>
              );
            })}
          </AnimatePresence>

          {!!hiddenAfter && <Marginalia>⟨ {hiddenAfter} later turns folded ⟩</Marginalia>}
        </div>
      </motion.aside>
    </div>
  );
}

function Marginalia({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-center select-none">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[color:var(--color-ink-rail)] to-transparent" />
      <span className="smallcaps text-[color:var(--color-dust)]">{children}</span>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[color:var(--color-ink-rail)] to-transparent" />
    </div>
  );
}

function RoleBadge({ role }: { role: "user" | "assistant" | "system" }) {
  const map = {
    user: { label: "user", color: "var(--color-brass)" },
    assistant: { label: "claude", color: "var(--color-verdigris)" },
    system: { label: "system", color: "var(--color-dust)" },
  } as const;
  const v = map[role];
  return (
    <span
      className="smallcaps"
      style={{ color: v.color, borderBottom: `1px solid ${v.color}`, paddingBottom: 1 }}
    >
      {v.label}
    </span>
  );
}

const COLLAPSE_AT = 1200;

function TurnBody({ text, collapsed: initialCollapsed }: { text: string; collapsed: boolean }) {
  const [open, setOpen] = useState(!initialCollapsed || text.length <= COLLAPSE_AT);
  const shown = open ? text : `${text.slice(0, COLLAPSE_AT)}…`;
  return (
    <div>
      <pre className="font-body text-[13px] leading-[1.62] whitespace-pre-wrap text-[color:var(--color-ivory)]">
        {shown}
      </pre>
      {text.length > COLLAPSE_AT && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 smallcaps text-[color:var(--color-brass)] hover:text-[color:var(--color-brass-bright)] transition-colors"
        >
          {open ? "▲ fold" : `▼ unfold +${(text.length - COLLAPSE_AT).toLocaleString()} chars`}
        </button>
      )}
    </div>
  );
}

function shortenPath(p: string): string {
  const home = "/home/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash > 0) return `~${rest.slice(slash)}`;
  }
  return p;
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
