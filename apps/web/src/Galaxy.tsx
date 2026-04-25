import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, OrbitControls, Stars, Text } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import * as THREE from "three";
import type { Cluster, Point } from "./types";
import { clusterColor } from "./colors";
import { planetsFromPoints, type Planet } from "./orbits";

type Hover = { planetIdx: number | null; mouseX: number; mouseY: number };

type Props = {
  points: Point[];
  clusters: Cluster[];
  selectedCluster: number | null;
  onSelectCluster: (id: number | null) => void;
  onOpenThread: (point: Point) => void;
};

const PLANET_BASE_RADIUS = 0.09;
const SUN_BASE_RADIUS = 0.22;
const SELECTED_PLANET_RADIUS = 0.19;
const HOVER_PLANET_RADIUS = 0.26;

export function Galaxy(props: Props) {
  const [hover, setHover] = useState<Hover>({ planetIdx: null, mouseX: 0, mouseY: 0 });
  const hoverPlanetRef = useRef<{ planets: Planet[]; clusters: Cluster[] } | null>(null);
  const { planets } = useMemo(() => planetsFromPoints(props.points, props.clusters), [props.points, props.clusters]);
  hoverPlanetRef.current = { planets, clusters: props.clusters };

  const hovered = hover.planetIdx !== null ? planets[hover.planetIdx] ?? null : null;
  const hoveredCluster = hovered ? props.clusters.find((c) => c.id === hovered.clusterId) : null;

  return (
    <div
      className="w-full h-full relative"
      onPointerMove={(e) => {
        setHover((h) => ({ ...h, mouseX: e.clientX, mouseY: e.clientY }));
      }}
    >
      <Canvas
        camera={{ position: [0, 8, 42], fov: 48, near: 0.1, far: 2000 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 2]}
        onPointerMissed={() => props.onSelectCluster(null)}
      >
        <color attach="background" args={["#050812"]} />
        <fog attach="fog" args={["#050812", 55, 120]} />
        <Suspense fallback={null}>
          <Scene
            {...props}
            onHoverPlanet={(idx) => setHover((h) => ({ ...h, planetIdx: idx }))}
            hoveredIdx={hover.planetIdx}
          />
        </Suspense>
      </Canvas>
      {hovered && hoveredCluster && props.selectedCluster === hovered.clusterId && (
        <div
          className="pointer-events-none fixed z-[60] max-w-[380px] px-3 py-2.5 rounded-[3px] border border-[color:var(--color-brass-dim)]/60 bg-[color:var(--color-ink-deep)]/95 backdrop-blur shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.min(window.innerWidth - 400, hover.mouseX + 14),
            top: Math.min(window.innerHeight - 140, hover.mouseY + 14),
          }}
        >
          <div
            className="smallcaps"
            style={{ color: clusterColor(hovered.clusterId) }}
          >
            #{String(hovered.clusterId).padStart(3, "0")} · {hoveredCluster.label}
          </div>
          <div className="mt-1 mono text-[10px] text-[color:var(--color-dust)] tracking-[0.08em]">
            {hovered.repo}
          </div>
          <div className="mt-2 font-body text-[12.5px] leading-[1.5] text-[color:var(--color-ivory)]">
            {hovered.text}
          </div>
        </div>
      )}
    </div>
  );
}

type SceneProps = Props & {
  hoveredIdx: number | null;
  onHoverPlanet: (idx: number | null) => void;
};

function Scene({
  points,
  clusters,
  selectedCluster,
  onSelectCluster,
  onOpenThread,
  hoveredIdx,
  onHoverPlanet,
}: SceneProps) {
  // Stretch cluster centers along X so the galaxy fills widescreen displays
  // instead of sitting as a roughly-square cloud in the middle of the viewport.
  const stretchedClusters = useMemo(() => {
    const X_SCALE = 1.7;
    return clusters.map((c) => ({
      ...c,
      center3d: [c.center3d[0] * X_SCALE, c.center3d[1], c.center3d[2]] as [
        number,
        number,
        number,
      ],
    }));
  }, [clusters]);

  const { planets, planetsByCluster } = useMemo(
    () => planetsFromPoints(points, stretchedClusters),
    [points, stretchedClusters],
  );
  const clusterById = useMemo(() => {
    const m = new Map<number, Cluster>();
    for (const c of stretchedClusters) m.set(c.id, c);
    return m;
  }, [stretchedClusters]);
  const pointById = useMemo(() => {
    const m = new Map<string, Point>();
    for (const p of points) m.set(p.id, p);
    return m;
  }, [points]);

  return (
    <>
      <ambientLight intensity={0.12} />
      <pointLight position={[0, 0, 0]} intensity={0.4} color="#f2ebd9" />
      <Stars radius={300} depth={80} count={9000} factor={6} saturation={0} fade speed={0.3} />

      <Suns
        clusters={stretchedClusters}
        selectedCluster={selectedCluster}
        onSelectCluster={onSelectCluster}
      />

      <Planets
        planets={planets}
        clusterById={clusterById}
        selectedCluster={selectedCluster}
        hoveredIdx={hoveredIdx}
        onHover={onHoverPlanet}
        onClick={(planet) => {
          const pt = pointById.get(planet.id);
          if (pt) onOpenThread(pt);
        }}
      />

      {selectedCluster !== null && clusterById.has(selectedCluster) && (
        <OrbitRings
          center={clusterById.get(selectedCluster)!.center3d}
          planets={planetsByCluster.get(selectedCluster) ?? []}
          color={clusterColor(selectedCluster)}
        />
      )}

      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={0.5}
        maxDistance={180}
        dampingFactor={0.08}
        zoomSpeed={1.0}
        rotateSpeed={0.55}
        panSpeed={0.9}
      />
      <CameraRig selectedCluster={selectedCluster} clusters={stretchedClusters} />
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom
          intensity={0.95}
          luminanceThreshold={0.18}
          luminanceSmoothing={0.12}
          kernelSize={KernelSize.LARGE}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

function Suns({
  clusters,
  selectedCluster,
  onSelectCluster,
}: {
  clusters: Cluster[];
  selectedCluster: number | null;
  onSelectCluster: (id: number | null) => void;
}) {
  const focused = selectedCluster !== null;
  return (
    <group>
      {clusters.map((c) => {
        const color = clusterColor(c.id);
        const r = SUN_BASE_RADIUS * (0.75 + Math.log10(Math.max(2, c.size)) * 0.35);
        const isSel = selectedCluster === c.id;
        const dimmed = focused && !isSel;
        // When zoomed into a specific cluster, aggressively push everything
        // else toward invisibility so the selected system is readable. The old
        // values (sun=0.1, corona=0.012) still left a soup of faint circles
        // bleeding through. The selected sun's corona also shrinks so it
        // doesn't glare over its own planets.
        const sunOpacity = dimmed ? 0.035 : 1;
        const coronaOpacity = dimmed ? 0.002 : isSel ? 0.08 : 0.18;
        const coronaRadius = isSel ? r * 1.3 : r * 1.9;
        const labelOpacity = dimmed ? 0.04 : 1;
        const primaryLabelColor = dimmed ? "#0f1624" : isSel ? "#f2ebd9" : "#d9d1bd";
        const secondaryLabelColor = dimmed ? "#0a0f1a" : "#8c8472";
        return (
          <group key={c.id} position={c.center3d as [number, number, number]}>
            <mesh
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onSelectCluster(selectedCluster === c.id ? null : c.id);
              }}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => (document.body.style.cursor = "")}
              visible={!dimmed || sunOpacity > 0.02}
            >
              <sphereGeometry args={[r, 28, 28]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={sunOpacity}
                depthWrite={!dimmed}
                toneMapped={false}
              />
            </mesh>
            {/* Corona — shrunk when this sun is the focused one so it doesn't
                wash out the planets orbiting around it. */}
            <mesh visible={!dimmed || coronaOpacity > 0.001}>
              <sphereGeometry args={[coronaRadius, 24, 24]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={coronaOpacity}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            <Billboard>
              <Text
                position={[0, r + 0.5, 0]}
                fontSize={isSel ? 0.32 : 0.26}
                color={primaryLabelColor}
                fillOpacity={labelOpacity}
                anchorX="center"
                anchorY="bottom"
                outlineColor="#050812"
                outlineWidth={dimmed ? 0 : 0.012}
                outlineOpacity={dimmed ? 0 : 1}
                maxWidth={4.2}
                material-toneMapped={false}
                material-transparent
                material-depthWrite={false}
                // Selected label is ALWAYS on top: disable depth test so other
                // clusters' geometry can't occlude it, and push renderOrder high.
                material-depthTest={!isSel}
                renderOrder={isSel ? 1000 : dimmed ? 0 : 5}
              >
                {c.label}
              </Text>
              {!dimmed && (
                <Text
                  position={[0, r + 0.22, 0]}
                  fontSize={0.14}
                  color={secondaryLabelColor}
                  fillOpacity={labelOpacity}
                  anchorX="center"
                  anchorY="bottom"
                  letterSpacing={0.1}
                  material-toneMapped={false}
                  material-transparent
                  material-depthWrite={false}
                  material-depthTest={!isSel}
                  renderOrder={isSel ? 1000 : 5}
                >
                  {`#${String(c.id).padStart(3, "0")} · N=${c.size}`}
                </Text>
              )}
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}

function Planets({
  planets,
  clusterById,
  selectedCluster,
  hoveredIdx,
  onHover,
  onClick,
}: {
  planets: Planet[];
  clusterById: Map<number, Cluster>;
  selectedCluster: number | null;
  hoveredIdx: number | null;
  onHover: (idx: number | null) => void;
  onClick: (planet: Planet) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const outlineRef = useRef<THREE.InstancedMesh | null>(null);
  const temp = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  // Scale factor for the outline sphere. A tight halo (1.22 = +22% radius) is
  // enough to separate overlapping planets without creating a thick "shadow"
  // that reads as on top of the planet.
  const OUTLINE_SCALE = 1.22;
  // Planets in the focused solar system orbit at this fraction of their normal
  // speed, so you can read the orbits clearly once you've selected a cluster.
  const FOCUSED_SPEED_FACTOR = 0.18;

  // Per-planet accumulated angle. Using delta-time accumulation (instead of
  // `phase + t * speed`) keeps orbits continuous when the speed multiplier
  // changes on selection — no jump to a new angle.
  const accumAngles = useMemo(
    () => planets.map((p) => p.phase),
    [planets],
  );

  // Precompute per-planet cluster center + base color.
  const centers = useMemo(
    () =>
      planets.map((p) => {
        const c = clusterById.get(p.clusterId);
        return c ? (c.center3d as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
      }),
    [planets, clusterById],
  );
  const baseColors = useMemo(
    () =>
      planets.map((p) => {
        // Per-planet hue + brightness variation so same-cluster planets read as
        // distinct objects when their orbits overlap. The cluster identity
        // survives because the shift is small and deterministic.
        const c = new THREE.Color(clusterColor(p.clusterId));
        c.offsetHSL(p.hue, 0, (p.brightness - 1) * 0.22);
        c.multiplyScalar(p.brightness);
        return c;
      }),
    [planets],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < planets.length; i++) {
      mesh.setColorAt(i, baseColors[i]!);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [planets, baseColors]);

  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    const outline = outlineRef.current;
    if (!mesh) return;
    // Clamp delta so a tab-switch pause doesn't fast-forward all orbits.
    const dt = Math.min(delta, 0.1);
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i]!;
      const [cx, cy, cz] = centers[i]!;
      const isHovered = i === hoveredIdx;
      const inSelected = selectedCluster === p.clusterId;
      const dimmed = selectedCluster !== null && !inSelected;

      // Focused solar system orbits slowly so the structure is readable.
      const speedFactor = inSelected ? FOCUSED_SPEED_FACTOR : 1;
      accumAngles[i] = accumAngles[i]! + dt * p.angularSpeed * speedFactor;
      const angle = accumAngles[i]!;
      const localX = p.orbitRadius * Math.cos(angle);
      const localZ = p.orbitRadius * Math.sin(angle);
      const cosT = Math.cos(p.tilt);
      const sinT = Math.sin(p.tilt);
      const y1 = -localZ * sinT;
      const z1 = localZ * cosT;
      const cosN = Math.cos(p.nodeAxis);
      const sinN = Math.sin(p.nodeAxis);
      const x2 = localX * cosN + z1 * sinN;
      const z2 = -localX * sinN + z1 * cosN;

      // When a cluster is focused, shrink non-selected planets to near-zero
      // scale (effectively hides them) so only the focused solar system is
      // rendered. Keeps the system fully clickable + reversible on deselect.
      const scale = isHovered
        ? HOVER_PLANET_RADIUS / PLANET_BASE_RADIUS
        : inSelected
          ? SELECTED_PLANET_RADIUS / PLANET_BASE_RADIUS
          : dimmed
            ? 0.02
            : 1;

      const x = cx + x2;
      const y = cy + y1;
      const z = cz + z2;

      temp.position.set(x, y, z);
      temp.scale.setScalar(scale);
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);

      if (outline) {
        // Same shrink for the outline so we don't leak a black dot where the
        // planet used to be.
        temp.scale.setScalar(scale * OUTLINE_SCALE);
        temp.updateMatrix();
        outline.setMatrixAt(i, temp.matrix);
      }

      if (dimmed) {
        tempColor.copy(baseColors[i]!).lerp(new THREE.Color("#070b15"), 0.95);
        mesh.setColorAt(i, tempColor);
      } else {
        mesh.setColorAt(
          i,
          isHovered ? tempColor.copy(baseColors[i]!).multiplyScalar(1.5) : baseColors[i]!,
        );
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (outline) outline.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {/* Outline: slightly larger black sphere, back-face only. Renders first so
          the planet fill overlays it, leaving a thin silhouette around each planet. */}
      <instancedMesh
        ref={outlineRef}
        args={[undefined, undefined, planets.length]}
        frustumCulled={false}
        renderOrder={-1}
      >
        <sphereGeometry args={[PLANET_BASE_RADIUS, 10, 10]} />
        <meshBasicMaterial
          color="#000000"
          side={THREE.BackSide}
          toneMapped={false}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, planets.length]}
        frustumCulled={false}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (selectedCluster === null) return;
          if (typeof e.instanceId !== "number") return;
          const planet = planets[e.instanceId];
          // Only react to planets that belong to the selected cluster.
          if (!planet || planet.clusterId !== selectedCluster) return;
          e.stopPropagation();
          onHover(e.instanceId);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          if (selectedCluster === null) return;
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (selectedCluster === null) return;
          if (typeof e.instanceId !== "number") return;
          const planet = planets[e.instanceId];
          if (!planet || planet.clusterId !== selectedCluster) return;
          e.stopPropagation();
          onClick(planet);
        }}
      >
        <sphereGeometry args={[PLANET_BASE_RADIUS, 14, 14]} />
        {/* toneMapped + higher lum threshold downstream: planets don't bloom
            into each other, so overlapping orbits stay readable as separate discs. */}
        <meshBasicMaterial toneMapped />
      </instancedMesh>
    </>
  );
}

function OrbitRings({
  center,
  planets,
  color,
}: {
  center: [number, number, number];
  planets: Planet[];
  color: string;
}) {
  const ringColor = useMemo(() => new THREE.Color(color), [color]);
  return (
    <group position={center}>
      {planets.map((p, i) => {
        // Build rotated ring: orbit plane is rotated by tilt (x) then nodeAxis (y).
        const rot = new THREE.Euler(p.tilt, p.nodeAxis, 0, "YXZ");
        return (
          <mesh key={p.id + i} rotation={rot as unknown as [number, number, number]}>
            <ringGeometry args={[p.orbitRadius - 0.003, p.orbitRadius + 0.003, 96]} />
            <meshBasicMaterial
              color={ringColor}
              transparent
              opacity={0.12}
              side={THREE.DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function CameraRig({
  selectedCluster,
  clusters,
}: {
  selectedCluster: number | null;
  clusters: Cluster[];
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; update: () => void } | null;
  };
  const targetVec = useRef(new THREE.Vector3(0, 0, 0));
  const camVec = useRef(new THREE.Vector3().copy(camera.position));
  const flying = useRef(false);
  const lastSelection = useRef<number | "__init__" | null>("__init__");

  // Arm a fly-to only when the selection actually changes. The first render doesn't
  // arm anything so the user can explore freely from the start.
  useEffect(() => {
    if (lastSelection.current === "__init__") {
      lastSelection.current = selectedCluster;
      return;
    }
    if (selectedCluster === lastSelection.current) return;
    lastSelection.current = selectedCluster;

    if (selectedCluster === null) {
      targetVec.current.set(0, 0, 0);
      camVec.current.set(0, 8, 42);
    } else {
      const c = clusters.find((x) => x.id === selectedCluster);
      if (!c) return;
      const [x, y, z] = c.center3d;
      targetVec.current.set(x, y, z);
      // Pull back farther for bigger clusters so all planets stay visible + clickable.
      const pullBack = 5.5 + Math.min(6, Math.log2(Math.max(2, c.size)) * 1.2);
      camVec.current.set(x + pullBack * 0.55, y + pullBack * 0.38, z + pullBack);
    }
    flying.current = true;
  }, [selectedCluster, clusters]);

  useFrame(() => {
    if (!flying.current) return;
    const ctrl = controls;
    camera.position.lerp(camVec.current, 0.09);
    if (ctrl?.target) {
      ctrl.target.lerp(targetVec.current, 0.11);
      ctrl.update();
    }
    if (camera.position.distanceTo(camVec.current) < 0.05) {
      flying.current = false;
    }
  });
  return null;
}

