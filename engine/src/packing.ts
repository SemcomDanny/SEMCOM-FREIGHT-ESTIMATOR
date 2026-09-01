import type {
  ContainerType,
  PackItem,
  PackResult,
  PackedContainer,
  Placement,
  UnplacedItem,
} from './types.js';
import { boxVolumeCbm } from './units.js';

/**
 * Real containers never load to the geometric optimum. The theoretical fit is
 * multiplied by this before a container is called full.
 */
export const DEFAULT_STOW_EFFICIENCY = 0.85;

export interface PackOptions {
  stowEfficiency?: number;
  /** Safety valve so a bad input cannot spin forever. */
  maxContainers?: number;
}

interface FreeSpace {
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
}

interface Orientation {
  l: number;
  w: number;
  h: number;
}

/** Axis permutations. "This way up" items keep their height axis vertical. */
function orientations(item: PackItem): Orientation[] {
  const { lMm: l, wMm: w, hMm: h } = item;
  const upright: Orientation[] = [
    { l, w, h },
    { l: w, w: l, h },
  ];
  if (item.thisWayUp) return dedupe(upright);
  return dedupe([
    ...upright,
    { l, w: h, h: w },
    { l: h, w: l, h: w },
    { l: w, w: h, h: l },
    { l: h, w, h: l },
  ]);
}

function dedupe(list: Orientation[]): Orientation[] {
  const seen = new Set<string>();
  const out: Orientation[] = [];
  for (const o of list) {
    const key = `${o.l}x${o.w}x${o.h}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

interface Candidate {
  spaceIndex: number;
  itemIndex: number;
  orientation: Orientation;
  nx: number;
  ny: number;
  nz: number;
  count: number;
  volume: number;
}

/**
 * Pack as many of `items` as will fit into one container.
 *
 * Deterministic block-and-guillotine heuristic, not a true 3D optimum:
 *  1. identical items are grouped into rectangular blocks;
 *  2. every allowed orientation is tried in every free space;
 *  3. the block that fills the most volume wins, ties going to the lowest,
 *     then most door-ward position, so heavy items land on the floor first;
 *  4. the space is guillotine-split into the three cuboids left over.
 * A container is called full once the placed volume reaches the stow
 * efficiency share of its interior, or its payload limit is reached.
 */
export function packContainer(
  items: PackItem[],
  container: ContainerType,
  containerIndex: number,
  opts: PackOptions = {},
): { placements: Placement[]; remaining: PackItem[]; payloadLimited: boolean } {
  const eff = opts.stowEfficiency ?? DEFAULT_STOW_EFFICIENCY;
  const interiorCbm = boxVolumeCbm(container.intLMm, container.intWMm, container.intHMm);
  const volumeCap = interiorCbm * eff;

  const remaining = items.map((i) => ({ ...i }));
  // Heaviest first: they must end up on the floor.
  const order = remaining
    .map((_, i) => i)
    .sort((a, b) => remaining[b]!.weightKg - remaining[a]!.weightKg);

  let spaces: FreeSpace[] = [
    { x: 0, y: 0, z: 0, l: container.intLMm, w: container.intWMm, h: container.intHMm },
  ];
  const placements: Placement[] = [];
  let placedVolume = 0;
  let placedWeight = 0;
  let payloadLimited = false;

  const EPS = 1e-6;
  let guard = 0;

  while (guard++ < 5000) {
    let best: Candidate | null = null;

    for (let s = 0; s < spaces.length; s++) {
      const space = spaces[s]!;
      for (const idx of order) {
        const item = remaining[idx]!;
        if (item.qty <= 0) continue;
        const itemVol = boxVolumeCbm(item.lMm, item.wMm, item.hMm);
        if (itemVol <= 0) continue;

        for (const o of orientations(item)) {
          const nx = Math.floor((space.l + EPS) / o.l);
          const ny = Math.floor((space.w + EPS) / o.w);
          let nz = Math.floor((space.h + EPS) / o.h);
          if (nx < 1 || ny < 1 || nz < 1) continue;
          if (!item.stackable) nz = 1;
          if (item.maxStackLayers && item.maxStackLayers > 0) {
            nz = Math.min(nz, item.maxStackLayers);
          }

          let count = Math.min(nx * ny * nz, item.qty);

          // Stow efficiency cap.
          const volumeRoom = volumeCap - placedVolume;
          if (volumeRoom <= 0) continue;
          count = Math.min(count, Math.floor((volumeRoom + EPS) / itemVol));

          // Payload cap.
          if (item.weightKg > 0) {
            const weightRoom = container.maxPayloadKg - placedWeight;
            const byWeight = Math.floor((weightRoom + EPS) / item.weightKg);
            if (byWeight < count) payloadLimited = true;
            count = Math.min(count, byWeight);
          }
          if (count < 1) continue;

          const volume = count * itemVol;
          if (
            best === null ||
            volume > best.volume + EPS ||
            (Math.abs(volume - best.volume) < EPS &&
              (space.z < spaces[best.spaceIndex]!.z ||
                (space.z === spaces[best.spaceIndex]!.z && space.x < spaces[best.spaceIndex]!.x)))
          ) {
            best = { spaceIndex: s, itemIndex: idx, orientation: o, nx, ny, nz, count, volume };
          }
        }
      }
    }

    if (!best) break;

    const space = spaces[best.spaceIndex]!;
    const item = remaining[best.itemIndex]!;
    const o = best.orientation;

    // Lay the block out x-major, then y, then z, so the loading sequence in the
    // 3D view reads the way a packer would actually build it.
    let placedInBlock = 0;
    let usedX = 0;
    let usedY = 0;
    let usedZ = 0;
    outer: for (let k = 0; k < best.nz; k++) {
      for (let j = 0; j < best.ny; j++) {
        for (let i = 0; i < best.nx; i++) {
          if (placedInBlock >= best.count) break outer;
          placements.push({
            refId: item.refId,
            label: item.label,
            containerIndex,
            x: space.x + i * o.l,
            y: space.y + j * o.w,
            z: space.z + k * o.h,
            lMm: o.l,
            wMm: o.w,
            hMm: o.h,
            weightKg: item.weightKg,
            colorIndex: item.colorIndex,
            deckHeightMm: item.deckHeightMm,
          });
          placedInBlock++;
          usedX = Math.max(usedX, (i + 1) * o.l);
          usedY = Math.max(usedY, (j + 1) * o.w);
          usedZ = Math.max(usedZ, (k + 1) * o.h);
        }
      }
    }

    item.qty -= placedInBlock;
    placedVolume += placedInBlock * boxVolumeCbm(item.lMm, item.wMm, item.hMm);
    placedWeight += placedInBlock * item.weightKg;

    // Guillotine split of the consumed space into three disjoint remainders.
    const next: FreeSpace[] = [];
    for (let s = 0; s < spaces.length; s++) {
      if (s !== best.spaceIndex) next.push(spaces[s]!);
    }
    if (space.l - usedX > EPS) {
      next.push({ x: space.x + usedX, y: space.y, z: space.z, l: space.l - usedX, w: space.w, h: space.h });
    }
    if (space.w - usedY > EPS) {
      next.push({ x: space.x, y: space.y + usedY, z: space.z, l: usedX, w: space.w - usedY, h: space.h });
    }
    // Nothing may be stacked on a non-stackable item, and a "max stack layers"
    // limit seals the column once it is reached — the constraint is about how
    // high the column may go, not just how many of this carton go in one block.
    const layersPlaced = o.h > 0 ? Math.round(usedZ / o.h) : 0;
    const stackSealed =
      !item.stackable ||
      (item.maxStackLayers !== undefined &&
        item.maxStackLayers > 0 &&
        layersPlaced >= item.maxStackLayers);
    if (!stackSealed && space.h - usedZ > EPS) {
      next.push({ x: space.x, y: space.y, z: space.z + usedZ, l: usedX, w: usedY, h: space.h - usedZ });
    }
    spaces = next.filter((sp) => sp.l > EPS && sp.w > EPS && sp.h > EPS);
    spaces.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);

    if (placedVolume >= volumeCap - EPS) break;
  }

  return {
    placements,
    remaining: remaining.filter((i) => i.qty > 0),
    payloadLimited,
  };
}

/** Pack a consignment into as many containers of one type as it takes. */
export function packConsignment(
  items: PackItem[],
  container: ContainerType,
  opts: PackOptions = {},
): PackResult {
  const maxContainers = opts.maxContainers ?? 30;
  const eff = opts.stowEfficiency ?? DEFAULT_STOW_EFFICIENCY;
  const containers: PackedContainer[] = [];
  let queue = items.filter((i) => i.qty > 0).map((i) => ({ ...i }));
  const interiorCbm = boxVolumeCbm(container.intLMm, container.intWMm, container.intHMm);

  while (queue.length > 0 && containers.length < maxContainers) {
    const before = queue.reduce((s, i) => s + i.qty, 0);
    const { placements, remaining, payloadLimited } = packContainer(
      queue,
      container,
      containers.length,
      opts,
    );
    if (placements.length === 0) break; // nothing fits at all — bail out
    const placedVolumeCbm = placements.reduce((s, p) => s + boxVolumeCbm(p.lMm, p.wMm, p.hMm), 0);
    const placedWeightKg = placements.reduce((s, p) => s + p.weightKg, 0);
    containers.push({
      index: containers.length,
      containerTypeId: container.id,
      containerTypeName: container.name,
      placements,
      placedVolumeCbm,
      placedWeightKg,
      volumeUtilisation: interiorCbm > 0 ? placedVolumeCbm / interiorCbm : 0,
      payloadUtilisation: container.maxPayloadKg > 0 ? placedWeightKg / container.maxPayloadKg : 0,
      payloadLimited,
    });
    queue = remaining;
    const after = queue.reduce((s, i) => s + i.qty, 0);
    if (after >= before) break; // no progress — stop rather than loop
  }

  const unplaced: UnplacedItem[] = queue.map((i) => ({
    refId: i.refId,
    label: i.label,
    qty: i.qty,
    reason:
      i.lMm > Math.max(container.intLMm, container.intWMm) ||
      i.hMm > container.intHMm ||
      containers.length >= maxContainers
        ? `Does not fit a ${container.name}`
        : `Exceeded ${maxContainers} containers`,
  }));

  const totalPlacedVolumeCbm = containers.reduce((s, c) => s + c.placedVolumeCbm, 0);
  const totalPlacedWeightKg = containers.reduce((s, c) => s + c.placedWeightKg, 0);

  return {
    containers,
    unplaced,
    meanVolumeUtilisation:
      containers.length > 0
        ? containers.reduce((s, c) => s + c.volumeUtilisation, 0) / containers.length
        : 0,
    meanPayloadUtilisation:
      containers.length > 0
        ? containers.reduce((s, c) => s + c.payloadUtilisation, 0) / containers.length
        : 0,
    totalPlacedVolumeCbm,
    totalPlacedWeightKg,
    stowEfficiency: eff,
  };
}

/** Nominal capacity of a container type, CBM. */
export function containerCbm(c: ContainerType): number {
  return boxVolumeCbm(c.intLMm, c.intWMm, c.intHMm);
}
