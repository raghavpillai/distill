import { useEffect, useMemo, useRef } from "react";
import * as Plotly from "plotly.js-dist-min";
import type { Cluster, Point } from "./types";
import { NOISE_COLOR, clusterColor } from "./colors";

type Props = {
  points: Point[];
  clusters: Cluster[];
  selectedCluster: number | null;
  onSelectCluster: (id: number | null) => void;
  onOpenThread: (point: Point) => void;
};

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function Scatter({
  points,
  clusters,
  selectedCluster,
  onSelectCluster,
  onOpenThread,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const plotInit = useRef(false);
  const pointsRef = useRef<Point[]>(points);
  const onOpenRef = useRef(onOpenThread);
  const onSelectRef = useRef(onSelectCluster);
  const selectedRef = useRef<number | null>(selectedCluster);
  pointsRef.current = points;
  onOpenRef.current = onOpenThread;
  onSelectRef.current = onSelectCluster;
  selectedRef.current = selectedCluster;

  const clusterLabels = useMemo(() => {
    const m = new Map<number, string>();
    clusters.forEach((c) => m.set(c.id, c.label));
    return m;
  }, [clusters]);

  const traces = useMemo(() => {
    const byCluster = new Map<number, Point[]>();
    for (const p of points) {
      const arr = byCluster.get(p.c) ?? [];
      arr.push(p);
      byCluster.set(p.c, arr);
    }
    const ordered: number[] = [];
    if (byCluster.has(-1)) ordered.push(-1);
    const rest = [...byCluster.entries()]
      .filter(([k]) => k !== -1)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k]) => k);
    ordered.push(...rest);

    return ordered.map((cid) => {
      const pts = byCluster.get(cid)!;
      const isNoise = cid === -1;
      const isSelected = selectedCluster === cid;
      const dim = selectedCluster !== null && !isSelected;
      const color = isNoise ? NOISE_COLOR : clusterColor(cid);
      const label = isNoise ? "field" : (clusterLabels.get(cid) ?? `#${cid}`);
      return {
        type: "scattergl" as const,
        mode: "markers" as const,
        x: pts.map((p) => p.x),
        y: pts.map((p) => p.y),
        name: isNoise ? "field" : `#${cid} · ${label.slice(0, 50)}`,
        marker: {
          size: isNoise ? 3 : isSelected ? 8 : 5,
          color,
          opacity: dim ? 0.06 : isNoise ? 0.35 : isSelected ? 0.95 : 0.82,
          line: isSelected ? { width: 1, color: "#f2ebd9" } : undefined,
        },
        customdata: pts.map((p) => ({
          id: p.id,
          text: escapeHtml(p.t),
          repo: escapeHtml(p.r),
          cluster: p.c,
          label: escapeHtml(isNoise ? "field" : (clusterLabels.get(p.c) ?? "")),
        })),
        hovertemplate:
          "<span style='font-family:Fraunces,serif;font-size:12px;color:#e7c074'>" +
          "#%{customdata.cluster} · %{customdata.label}</span><br>" +
          "<span style='font-family:IBM Plex Mono,monospace;font-size:10.5px;color:#8c8472'>%{customdata.repo}</span><br><br>" +
          "<span style='font-family:Fraunces,serif;font-size:12px;color:#f2ebd9'>%{customdata.text}</span>" +
          "<extra></extra>",
        hoverlabel: {
          bgcolor: "#0b1120",
          bordercolor: "#d4a85a",
          font: { color: "#f2ebd9", family: "Fraunces, serif", size: 12 },
          align: "left" as const,
        },
        meta: { clusterId: cid },
      };
    });
  }, [points, clusterLabels, selectedCluster]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const layout: Partial<Plotly.Layout> = {
      autosize: true,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      hovermode: "closest",
      dragmode: "pan",
      xaxis: {
        visible: false,
        fixedrange: false,
        zeroline: false,
        showgrid: true,
        gridcolor: "rgba(212, 168, 90, 0.04)",
        gridwidth: 1,
      },
      yaxis: {
        visible: false,
        fixedrange: false,
        scaleanchor: "x",
        scaleratio: 1,
        zeroline: false,
        showgrid: true,
        gridcolor: "rgba(212, 168, 90, 0.04)",
        gridwidth: 1,
      },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
    };
    const config: Partial<Plotly.Config> = {
      displayModeBar: false,
      responsive: true,
      scrollZoom: true,
    };

    const plotEl = el as unknown as Plotly.PlotlyHTMLElement;
    if (!plotInit.current) {
      Plotly.newPlot(plotEl, traces as unknown as Plotly.Data[], layout, config);
      plotInit.current = true;

      plotEl.on("plotly_click", (ev: Plotly.PlotMouseEvent) => {
        const hit = ev.points?.[0];
        if (!hit) return;
        const custom = hit.customdata as unknown as
          | { id: string; cluster: number }
          | undefined;
        if (!custom) return;
        const shift = (ev.event as MouseEvent | undefined)?.shiftKey;
        if (shift) {
          const current = selectedRef.current;
          onSelectRef.current(custom.cluster === current ? null : custom.cluster);
          return;
        }
        const clicked = pointsRef.current.find((p) => p.id === custom.id);
        if (clicked) onOpenRef.current(clicked);
      });
    } else {
      Plotly.react(plotEl, traces as unknown as Plotly.Data[], layout, config);
    }
  }, [traces]);

  useEffect(() => {
    return () => {
      if (ref.current) Plotly.purge(ref.current);
      plotInit.current = false;
    };
  }, []);

  return <div ref={ref} className="w-full h-full" />;
}
