import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Cluster } from "./types";
import { clusterColor } from "./colors";

type Props = {
  clusters: Cluster[];
  selectedCluster: number | null;
  onSelectCluster: (id: number | null) => void;
  onOpenThread: (turnId: string) => void;
};

export function ClusterPanel({
  clusters,
  selectedCluster,
  onSelectCluster,
  onOpenThread,
}: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"size" | "id">("size");
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement | null>());

  // When the selection changes (often from the galaxy), scroll that row into view
  // only if it isn't currently visible.
  useEffect(() => {
    if (selectedCluster === null) return;
    const row = rowRefs.current.get(selectedCluster);
    const container = listRef.current;
    if (!row || !container) return;
    const rRect = row.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const above = rRect.top < cRect.top + 40;
    const below = rRect.bottom > cRect.bottom - 40;
    if (above || below) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedCluster]);

  const filtered = useMemo(() => {
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
    return [...list].sort((a, b) => (sort === "size" ? b.size - a.size : a.id - b.id));
  }, [clusters, query, sort]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="relative px-4 py-3 border-b border-[color:var(--color-ink-rail)] bg-[color:var(--color-ink-deep)]/60 backdrop-blur sticky top-0 z-10">
        <div className="smallcaps text-[color:var(--color-brass)] mb-2">index · {filtered.length} of {clusters.length}</div>
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <input
              type="search"
              placeholder="seek within the field…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full mono text-xs px-3 py-2 bg-transparent border border-[color:var(--color-ink-rail)] rounded-[3px] text-[color:var(--color-ivory)] placeholder:text-[color:var(--color-dust)]/60 focus:border-[color:var(--color-brass)] transition-colors"
            />
          </div>
          <button
            onClick={() => setSort(sort === "size" ? "id" : "size")}
            title="toggle sort"
            className="mono text-[10.5px] px-2.5 py-2 border border-[color:var(--color-ink-rail)] rounded-[3px] text-[color:var(--color-ivory-soft)] hover:text-[color:var(--color-brass)] hover:border-[color:var(--color-brass-dim)] transition-colors tracking-[0.08em]"
          >
            {sort === "size" ? "▾ SIZE" : "▾ ID"}
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-6 mono text-xs text-[color:var(--color-dust)] italic">
            — no clusters match —
          </div>
        )}
        <motion.ul
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.015 } } }}
        >
          {filtered.map((c) => {
            const selected = selectedCluster === c.id;
            return (
              <motion.li
                key={c.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(c.id, el);
                  else rowRefs.current.delete(c.id);
                }}
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
                }}
                className="relative border-b border-[color:var(--color-ink-rail)]/60"
              >
                <button
                  onClick={() => onSelectCluster(selected ? null : c.id)}
                  className={
                    "w-full text-left px-4 py-3 flex items-center gap-3 group transition-colors " +
                    (selected
                      ? "bg-[color:var(--color-ink-rail)]/40"
                      : "hover:bg-[color:var(--color-ink-rail)]/20")
                  }
                >
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
                  <span className="mono tnum text-[10.5px] text-[color:var(--color-dust)]">
                    {String(c.id).padStart(3, "0")}
                  </span>
                  <span className="mono tnum text-[10.5px] text-[color:var(--color-brass)]">
                    n={c.size}
                  </span>
                  <span className="display text-[15px] text-[color:var(--color-ivory)] truncate flex-1 group-hover:text-[color:var(--color-brass-bright)] transition-colors">
                    {c.label}
                  </span>
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
                      <div className="px-4 pb-4 pt-1 ml-5 space-y-3">
                        <KvRow k="keywords" v={c.keywords.slice(0, 8).join(" · ")} />
                        <KvRow k="loci" v={c.top_repos.join(" · ")} mono />
                        <div className="relative pl-3 border-l border-[color:var(--color-brass-dim)]/40">
                          <div className="smallcaps text-[color:var(--color-brass)] mb-2">specimens</div>
                          <ul className="space-y-2.5">
                            {c.exemplars.map((ex, i) => {
                              const id = c.exemplar_ids[i];
                              return (
                                <motion.li
                                  key={i}
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.05 + i * 0.04, duration: 0.35 }}
                                  className="group relative text-[12.5px] leading-[1.55] text-[color:var(--color-ivory-soft)] whitespace-pre-wrap"
                                >
                                  <span className="mono text-[10px] text-[color:var(--color-dust)] mr-2">
                                    {String(i + 1).padStart(2, "0")}
                                  </span>
                                  {ex}
                                  {id && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenThread(id);
                                      }}
                                      className="ml-2 smallcaps text-[color:var(--color-copper)] opacity-0 group-hover:opacity-100 hover:text-[color:var(--color-brass-bright)] transition-all"
                                    >
                                      ◇ open log
                                    </button>
                                  )}
                                </motion.li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </motion.ul>
      </div>
    </div>
  );
}

function KvRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-[11.5px]">
      <div className="smallcaps text-[color:var(--color-dust)] flex-none w-16">{k}</div>
      <div
        className={
          (mono ? "mono " : "") +
          "text-[color:var(--color-ivory-soft)] break-words"
        }
      >
        {v}
      </div>
    </div>
  );
}
