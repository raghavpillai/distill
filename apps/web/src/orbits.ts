// Derive deterministic orbital parameters per planet from its turn id.
// Hash → phase, tilt, node. Radius derived from embedding distance.
import type { Cluster, Point } from "./types";

export type Planet = {
  id: string;
  clusterId: number;
  text: string;
  repo: string;
  orbitRadius: number; // world units
  tilt: number; // radians, orbit plane tilt about the x axis
  nodeAxis: number; // radians, longitude of the ascending node (rotation about y)
  phase: number; // radians, initial angular position
  angularSpeed: number; // radians / second
  hue: number; // small hue offset, radians-of-hue-circle scale
  brightness: number; // multiplier on base color (0.72–1.18) for visual variety
};

function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand01(seed: number, salt: number): number {
  let x = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

const MIN_RADIUS = 0.85;
const RADIUS_SCALE = 5.2; // embedding distance (0..~0.35) → orbit radius
const RADIUS_JITTER = 0.55; // add per-planet variety so orbits don't overlap

export function planetsFromPoints(
  points: Point[],
  clusters: Cluster[],
): { planets: Planet[]; planetsByCluster: Map<number, Planet[]> } {
  const clusterSet = new Set(clusters.map((c) => c.id));
  // Count planets per cluster so crowded clusters get extra orbit spread.
  const sizeByCluster = new Map<number, number>();
  for (const p of points) {
    if (p.c === -1 || !clusterSet.has(p.c)) continue;
    sizeByCluster.set(p.c, (sizeByCluster.get(p.c) ?? 0) + 1);
  }
  const planets: Planet[] = [];
  const byCluster = new Map<number, Planet[]>();
  for (const p of points) {
    if (p.c === -1 || !clusterSet.has(p.c)) continue;
    const h = hash(p.id);
    const n = sizeByCluster.get(p.c) ?? 1;
    // Crowded clusters expand their outer radius so planets aren't piled up.
    const crowdBoost = Math.max(0, Math.log2(n / 4)) * 0.4;
    const baseR = p.d > 0 ? MIN_RADIUS + p.d * RADIUS_SCALE : MIN_RADIUS + 0.6;
    const jitter = (rand01(h, 1) - 0.5) * RADIUS_JITTER + crowdBoost * rand01(h, 8);
    const r = Math.max(MIN_RADIUS, baseR + jitter);
    const tilt = (rand01(h, 2) - 0.5) * 0.7;
    const nodeAxis = rand01(h, 3) * Math.PI * 2;
    const phase = rand01(h, 4) * Math.PI * 2;
    const direction = rand01(h, 5) > 0.08 ? 1 : -1; // 8% retrograde
    const base = 0.45 / Math.sqrt(Math.max(r, 0.4));
    const angularSpeed = direction * base * (0.85 + rand01(h, 6) * 0.3);
    const hue = (rand01(h, 7) - 0.5) * 0.18;
    const brightness = 0.72 + rand01(h, 8) * 0.46;
    const planet: Planet = {
      id: p.id,
      clusterId: p.c,
      text: p.t,
      repo: p.r,
      orbitRadius: r,
      tilt,
      nodeAxis,
      phase,
      angularSpeed,
      hue,
      brightness,
    };
    planets.push(planet);
    const list = byCluster.get(p.c) ?? [];
    list.push(planet);
    byCluster.set(p.c, list);
  }
  return { planets, planetsByCluster: byCluster };
}

export const GALAXY_SCALE = 1.0; // clusters already sized to ±~15 in pipeline
