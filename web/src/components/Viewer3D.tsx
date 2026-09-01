import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { colorFor } from '@semcom/engine';
import type { ContainerType, PackedContainer, Placement } from '@semcom/engine';
import { fmt } from './ui';

/** mm to scene units (metres) so the camera and lights behave sensibly. */
const S = 0.001;
/** Shrink each carton a hair so neighbouring boxes do not z-fight. */
const CARGO_INSET_MM = 4;
/** Pallet decks render as timber so the load is obviously sitting on one. */
const PALLET_DECK_COLOR = '#a16207';

interface LegendEntry {
  colorIndex: number;
  label: string;
  count: number;
}

function ContainerShell({ type, transparent }: { type: ContainerType; transparent: boolean }) {
  const l = type.intLMm * S;
  const w = type.intWMm * S;
  const h = type.intHMm * S;
  return (
    <group position={[l / 2, h / 2, w / 2]}>
      <mesh>
        <boxGeometry args={[l, h, w]} />
        <meshStandardMaterial
          color="#94a3b8"
          transparent
          opacity={transparent ? 0.06 : 0.18}
          side={THREE.BackSide}
          depthWrite={false}
        />
        <Edges color="#334155" />
      </mesh>
    </group>
  );
}

/** The 12 edges of a box, as vertex pairs for a LineSegments buffer. */
const EDGE_PAIRS: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0], // bottom face
  [4, 5], [5, 7], [7, 6], [6, 4], // top face
  [0, 4], [1, 5], [2, 6], [3, 7], // uprights
];

/**
 * One merged LineSegments holding the outline of every box.
 *
 * Without this, a stack of same-coloured cartons renders as one solid mass and
 * you cannot see how many there are or where one ends. An InstancedMesh cannot
 * carry per-instance edges, so the outlines are built once into a single
 * geometry — 24 vertices per box, cheap enough for thousands of cartons in one
 * draw call.
 */
function BoxEdges({ boxes, color, opacity = 1 }: { boxes: Box[]; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(boxes.length * EDGE_PAIRS.length * 2 * 3);
    let o = 0;
    for (const b of boxes) {
      const x0 = b.x * S;
      const y0 = b.y * S;
      const z0 = b.z * S;
      const x1 = (b.x + b.l) * S;
      const y1 = (b.y + b.h) * S;
      const z1 = (b.z + b.w) * S;
      // Corner order matches EDGE_PAIRS: bit 0 = x, bit 1 = z, bit 2 = y.
      const corners: [number, number, number][] = [
        [x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1],
      ];
      for (const [a, c] of EDGE_PAIRS) {
        const p = corners[a]!;
        const q = corners[c]!;
        positions[o++] = p[0]; positions[o++] = p[1]; positions[o++] = p[2];
        positions[o++] = q[0]; positions[o++] = q[1]; positions[o++] = q[2];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [boxes]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (boxes.length === 0) return null;
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </lineSegments>
  );
}

/** A box in container-local mm, already split into deck and cargo where needed. */
interface Box {
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
}

/** One instanced mesh per carton type keeps thousands of cartons interactive. */
function BoxGroup({ boxes, color, inset }: { boxes: Box[]; color: string; inset: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    boxes.forEach((b, i) => {
      dummy.position.set((b.x + b.l / 2) * S, (b.y + b.h / 2) * S, (b.z + b.w / 2) * S);
      dummy.scale.set(
        Math.max(b.l - inset, 1) * S,
        Math.max(b.h - inset, 1) * S,
        Math.max(b.w - inset, 1) * S,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = boxes.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [boxes, inset]);

  if (boxes.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
    </instancedMesh>
  );
}

/**
 * Split placements into what actually gets drawn.
 *
 * A palletised item arrives as one block covering deck plus cargo. Drawn that
 * way you cannot tell there is a pallet under the load at all, so it is split
 * into a deck slab and the cargo standing on it.
 */
function toBoxes(placements: Placement[]): { cargo: Box[]; decks: Box[] } {
  const cargo: Box[] = [];
  const decks: Box[] = [];
  for (const p of placements) {
    const deck = p.deckHeightMm ?? 0;
    if (deck > 0 && deck < p.hMm) {
      decks.push({ x: p.x, y: p.z, z: p.y, l: p.lMm, w: p.wMm, h: deck });
      cargo.push({ x: p.x, y: p.z + deck, z: p.y, l: p.lMm, w: p.wMm, h: p.hMm - deck });
    } else {
      cargo.push({ x: p.x, y: p.z, z: p.y, l: p.lMm, w: p.wMm, h: p.hMm });
    }
  }
  return { cargo, decks };
}

type ViewPreset = 'iso' | 'top' | 'side' | 'door';

function CameraRig({
  type,
  preset,
  nonce,
}: {
  type: ContainerType;
  preset: ViewPreset;
  nonce: number;
}) {
  const { camera } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const l = type.intLMm * S;
  const w = type.intWMm * S;
  const h = type.intHMm * S;
  const target = useMemo(() => new THREE.Vector3(l / 2, h / 2, w / 2), [l, h, w]);

  useEffect(() => {
    const d = Math.max(l, w, h);
    const positions: Record<ViewPreset, [number, number, number]> = {
      iso: [l + d * 0.7, h + d * 0.6, w + d * 1.1],
      top: [l / 2, h + d * 1.4, w / 2 + 0.001],
      side: [l / 2, h / 2, w + d * 1.5],
      door: [-d * 1.2, h * 0.8, w / 2],
    };
    camera.position.set(...positions[preset]);
    camera.lookAt(target);
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
    }
  }, [camera, preset, nonce, l, w, h, target]);

  return <OrbitControls ref={controls} makeDefault target={target} enableDamping dampingFactor={0.12} />;
}

/** Captures the canvas to PNG on demand, after a fresh render. */
function Capture({ trigger, onReady }: { trigger: number; onReady: (dataUrl: string) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (trigger === 0) return;
    gl.render(scene, camera);
    onReady(gl.domElement.toDataURL('image/png'));
  }, [trigger, gl, scene, camera, onReady]);
  return null;
}

export function Viewer3D({
  containers,
  containerTypes,
  legend,
  title,
  onImageCaptured,
}: {
  containers: PackedContainer[];
  containerTypes: ContainerType[];
  legend: LegendEntry[];
  title?: string;
  /** Handed the PNG data URL so the RFQ email can attach the same picture. */
  onImageCaptured?: (dataUrl: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [transparent, setTransparent] = useState(true);
  const [isolated, setIsolated] = useState<number | null>(null);
  const [preset, setPreset] = useState<ViewPreset>('iso');
  const [nonce, setNonce] = useState(0);
  const [captureTrigger, setCaptureTrigger] = useState(0);
  const [step, setStep] = useState<number | null>(null);

  const container = containers[Math.min(index, Math.max(containers.length - 1, 0))];
  const type = containerTypes.find((t) => t.id === container?.containerTypeId);

  useEffect(() => {
    setStep(null);
    setIndex((i) => (i < containers.length ? i : 0));
  }, [containers]);

  const visible = useMemo(() => {
    if (!container) return [];
    const limit = step ?? container.placements.length;
    return container.placements
      .slice(0, limit)
      .filter((p) => isolated === null || p.colorIndex === isolated);
  }, [container, step, isolated]);

  const groups = useMemo(() => {
    const byColor = new Map<number, Placement[]>();
    for (const p of visible) {
      const list = byColor.get(p.colorIndex);
      if (list) list.push(p);
      else byColor.set(p.colorIndex, [p]);
    }
    return [...byColor.entries()].map(([colorIndex, placements]) => ({
      colorIndex,
      ...toBoxes(placements),
    }));
  }, [visible]);

  const allBoxes = useMemo(
    () => groups.flatMap((g) => [...g.cargo, ...g.decks]),
    [groups],
  );
  const hasPallets = useMemo(() => groups.some((g) => g.decks.length > 0), [groups]);

  const handleCapture = (dataUrl: string) => {
    onImageCaptured?.(dataUrl);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${(title ?? 'container-load').replace(/\W+/g, '-').toLowerCase()}.png`;
    a.click();
  };

  if (!container || !type) {
    return (
      <div className="flex h-72 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Nothing to show yet — enter cartons with dimensions and quantities.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-sm">
        {containers.length > 1 && (
          <select className="field w-auto py-1" value={index} onChange={(e) => setIndex(Number(e.target.value))}>
            {containers.map((c, i) => (
              <option key={c.index} value={i}>
                Container {i + 1} of {containers.length} — {c.containerTypeName}
              </option>
            ))}
          </select>
        )}
        <div className="flex overflow-hidden rounded border border-slate-300">
          {(['iso', 'top', 'side', 'door'] as ViewPreset[]).map((p) => (
            <button
              key={p}
              className={`px-2 py-1 text-xs capitalize ${
                preset === p ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
              onClick={() => {
                setPreset(p);
                setNonce((n) => n + 1);
              }}
            >
              {p === 'door' ? 'Door end' : p}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
          Transparent walls
        </label>
        <button className="btn-ghost text-xs" onClick={() => setCaptureTrigger((n) => n + 1)}>
          Export PNG
        </button>
      </div>

      <div className="h-[420px] w-full bg-slate-900/95">
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ fov: 40, near: 0.1, far: 200 }}
        >
          <color attach="background" args={['#0f172a']} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[8, 12, 6]} intensity={1.1} castShadow />
          <directionalLight position={[-6, 6, -8]} intensity={0.4} />
          <gridHelper
            args={[40, 40, '#334155', '#1e293b']}
            position={[type.intLMm * S * 0.5, -0.002, type.intWMm * S * 0.5]}
          />
          <ContainerShell type={type} transparent={transparent} />
          {groups.map((g) => (
            <group key={g.colorIndex}>
              <BoxGroup boxes={g.cargo} color={colorFor(g.colorIndex)} inset={CARGO_INSET_MM} />
              <BoxGroup boxes={g.decks} color={PALLET_DECK_COLOR} inset={0} />
            </group>
          ))}
          {/* Drawn last, over the solid boxes, so every carton reads separately. */}
          <BoxEdges boxes={allBoxes} color="#0f172a" opacity={0.55} />
          <CameraRig type={type} preset={preset} nonce={nonce} />
          <Capture trigger={captureTrigger} onReady={handleCapture} />
        </Canvas>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-slate-500">Loading sequence</span>
            <input
              type="range"
              className="flex-1"
              min={1}
              max={container.placements.length}
              value={step ?? container.placements.length}
              onChange={(e) => setStep(Number(e.target.value))}
            />
            <span className="tabular w-24 text-right text-slate-600">
              {step ?? container.placements.length} / {container.placements.length}
            </span>
          </label>
          {step !== null && (
            <button className="btn-ghost text-xs" onClick={() => setStep(null)}>
              Show all
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {legend.map((entry) => (
            <button
              key={entry.colorIndex}
              onClick={() => setIsolated(isolated === entry.colorIndex ? null : entry.colorIndex)}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-opacity ${
                isolated !== null && isolated !== entry.colorIndex
                  ? 'border-slate-200 opacity-40'
                  : 'border-slate-300'
              }`}
              title="Click to isolate this type"
            >
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: colorFor(entry.colorIndex) }}
              />
              {entry.label}
              <span className="tabular text-slate-500">×{entry.count}</span>
            </button>
          ))}
          {hasPallets && (
            <span
              className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
              title="The pallet deck under each load"
            >
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: PALLET_DECK_COLOR }}
              />
              Pallet deck
            </span>
          )}
          {isolated !== null && (
            <button className="btn-ghost text-xs" onClick={() => setIsolated(null)}>
              Show all types
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <span>
            Volumetric utilisation{' '}
            <strong className="tabular">{fmt.pct(container.volumeUtilisation)}</strong>
          </span>
          <span>
            Payload utilisation{' '}
            <strong className="tabular">{fmt.pct(container.payloadUtilisation)}</strong>{' '}
            ({fmt.kg(container.placedWeightKg, 0)} of {fmt.kg(type.maxPayloadKg, 0)} kg)
          </span>
          <span>
            Loaded <strong className="tabular">{fmt.cbm(container.placedVolumeCbm)}</strong> CBM in{' '}
            {container.placements.length} item(s)
          </span>
        </div>
      </div>
    </div>
  );
}
