import type { CartonLine, PalletBuild, PalletPatternCell, PalletType } from './types.js';
import { boxVolumeCbm } from './units.js';

/** Weight allowance for the empty pallet itself. */
export const DEFAULT_PALLET_TARE_KG = 25;

export interface PalletiseOptions {
  palletType: PalletType;
  /** Per-estimate overrides of the pallet master data. */
  maxLoadHMm?: number;
  maxLoadKg?: number;
  overhangMm?: number;
  palletTareKg?: number;
}

interface LayerPattern {
  cells: PalletPatternCell[];
  count: number;
  extentLMm: number;
  extentWMm: number;
}

/**
 * Build one layer pattern for a given base orientation and leftover-strip
 * direction. `none` gives the plain uniform block; `L` and `W` fill the strip
 * left over along that axis with cartons turned 90 degrees, which is the
 * simple form of the pinwheel patterns packers actually use.
 */
function buildPattern(
  footL: number,
  footW: number,
  cl: number,
  cw: number,
  baseRotated: boolean,
  split: 'none' | 'L' | 'W',
): LayerPattern {
  const [bl, bw] = baseRotated ? [cw, cl] : [cl, cw];
  const [al, aw] = baseRotated ? [cl, cw] : [cw, cl];
  const cells: PalletPatternCell[] = [];

  const nx = Math.floor(footL / bl);
  const ny = Math.floor(footW / bw);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      cells.push({ x: i * bl, y: j * bw, lMm: bl, wMm: bw, rotated: baseRotated });
    }
  }

  if (split === 'L') {
    const stripX = nx * bl;
    const stripL = footL - stripX;
    const mx = Math.floor(stripL / al);
    const my = Math.floor(footW / aw);
    for (let i = 0; i < mx; i++) {
      for (let j = 0; j < my; j++) {
        cells.push({ x: stripX + i * al, y: j * aw, lMm: al, wMm: aw, rotated: !baseRotated });
      }
    }
  } else if (split === 'W') {
    const stripY = ny * bw;
    const stripW = footW - stripY;
    const mx = Math.floor(footL / al);
    const my = Math.floor(stripW / aw);
    for (let i = 0; i < mx; i++) {
      for (let j = 0; j < my; j++) {
        cells.push({ x: i * al, y: stripY + j * aw, lMm: al, wMm: aw, rotated: !baseRotated });
      }
    }
  }

  let extentLMm = 0;
  let extentWMm = 0;
  for (const c of cells) {
    extentLMm = Math.max(extentLMm, c.x + c.lMm);
    extentWMm = Math.max(extentWMm, c.y + c.wMm);
  }
  return { cells, count: cells.length, extentLMm, extentWMm };
}

/** Best cartons-per-layer pattern across both orientations and both strip fills. */
export function bestLayerPattern(footL: number, footW: number, cl: number, cw: number): LayerPattern {
  const candidates: LayerPattern[] = [];
  for (const rotated of [false, true]) {
    for (const split of ['none', 'L', 'W'] as const) {
      candidates.push(buildPattern(footL, footW, cl, cw, rotated, split));
    }
  }
  // Deterministic: most cartons wins; ties resolved by the tighter footprint,
  // then by enumeration order so the same inputs always give the same pattern.
  let best = candidates[0]!;
  for (const c of candidates) {
    if (
      c.count > best.count ||
      (c.count === best.count && c.extentLMm * c.extentWMm < best.extentLMm * best.extentWMm)
    ) {
      best = c;
    }
  }
  return best;
}

/** Palletise one carton line onto the given pallet type. */
export function palletiseLine(
  line: CartonLine,
  opts: PalletiseOptions,
  colorIndex = 0,
): PalletBuild {
  const pt = opts.palletType;
  const overhang = opts.overhangMm ?? pt.overhangMm ?? 0;
  const maxLoadH = opts.maxLoadHMm ?? pt.maxLoadHMm;
  const maxLoadKg = opts.maxLoadKg ?? pt.maxLoadKg;
  const tare = opts.palletTareKg ?? DEFAULT_PALLET_TARE_KG;
  const warnings: string[] = [];

  const footL = pt.lMm + overhang * 2;
  const footW = pt.wMm + overhang * 2;

  // Cartons may sit on either footprint face but are never tipped onto their
  // side when "this way up" is set; palletising always keeps height vertical.
  const pattern = bestLayerPattern(footL, footW, line.lengthMm, line.widthMm);
  const cartonsPerLayer = pattern.count;

  if (cartonsPerLayer === 0) {
    warnings.push(
      `Carton ${Math.round(line.lengthMm)} x ${Math.round(line.widthMm)} mm does not fit the ` +
        `${pt.name} pallet footprint (${pt.lMm} x ${pt.wMm} mm).`,
    );
  }

  let layersByHeight = line.heightMm > 0 ? Math.floor(maxLoadH / line.heightMm) : 0;
  if (line.stackable === false) layersByHeight = Math.min(layersByHeight, 1);
  if (line.maxStackLayers && line.maxStackLayers > 0) {
    layersByHeight = Math.min(layersByHeight, line.maxStackLayers);
  }
  if (line.heightMm > maxLoadH) {
    warnings.push(
      `Carton height ${Math.round(line.heightMm)} mm exceeds the ${maxLoadH} mm max load height.`,
    );
  }

  const layerWeight = cartonsPerLayer * (line.weightKg || 0);
  const usableKg = Math.max(0, maxLoadKg - 0); // tare is carried by the deck, not the load limit
  let layersByWeight = layerWeight > 0 ? Math.floor(usableKg / layerWeight) : layersByHeight;
  if (layersByWeight < 1 && cartonsPerLayer > 0) {
    warnings.push(
      `A single layer of ${cartonsPerLayer} cartons weighs ${Math.round(layerWeight)} kg, over the ` +
        `${maxLoadKg} kg pallet limit — reduce cartons per layer or raise the limit.`,
    );
    layersByWeight = 1;
  }

  const layers = Math.max(cartonsPerLayer > 0 ? 1 : 0, Math.min(layersByHeight, layersByWeight));
  const cartonsPerPallet = cartonsPerLayer * layers;

  const qty = Math.max(0, line.qty || 0);
  const fullPallets = cartonsPerPallet > 0 ? Math.floor(qty / cartonsPerPallet) : 0;
  const remainderCartons = cartonsPerPallet > 0 ? qty % cartonsPerPallet : qty;
  const palletCount = fullPallets + (remainderCartons > 0 ? 1 : 0);

  const loadedHeightMm = pt.deckHMm + layers * line.heightMm;
  const palletGrossKg = tare + cartonsPerPallet * (line.weightKg || 0);

  const fitL = Math.max(pt.lMm, pattern.extentLMm);
  const fitW = Math.max(pt.wMm, pattern.extentWMm);
  const cubedVolumeCbmEach = boxVolumeCbm(fitL, fitW, loadedHeightMm);

  // The part-filled pallet is genuinely shorter, so cube it at its own height.
  const remLayers = cartonsPerLayer > 0 ? Math.ceil(remainderCartons / cartonsPerLayer) : 0;
  const remainderHeightMm = pt.deckHMm + remLayers * line.heightMm;
  const cubedVolumeCbmTotal =
    fullPallets * cubedVolumeCbmEach +
    (remainderCartons > 0 ? boxVolumeCbm(fitL, fitW, remainderHeightMm) : 0);

  return {
    lineId: line.id,
    description: line.description,
    palletTypeId: pt.id,
    palletTypeName: pt.name,
    cartonsPerLayer,
    layers,
    cartonsPerPallet,
    fullPallets,
    remainderCartons,
    palletCount,
    loadedHeightMm,
    palletGrossKg,
    cubedVolumeCbmEach,
    cubedVolumeCbmTotal,
    pattern: pattern.cells,
    footprintLMm: fitL,
    footprintWMm: fitW,
    warnings,
    colorIndex,
  };
}

/** Height and weight of the part-filled pallet, if there is one. */
export function remainderPallet(
  build: PalletBuild,
  line: CartonLine,
  deckHMm: number,
  tareKg = DEFAULT_PALLET_TARE_KG,
): { heightMm: number; weightKg: number; cartons: number } | null {
  if (build.remainderCartons <= 0 || build.cartonsPerLayer <= 0) return null;
  const layers = Math.ceil(build.remainderCartons / build.cartonsPerLayer);
  return {
    heightMm: deckHMm + layers * line.heightMm,
    weightKg: tareKg + build.remainderCartons * (line.weightKg || 0),
    cartons: build.remainderCartons,
  };
}

export function palletiseAll(
  lines: CartonLine[],
  opts: PalletiseOptions,
): { builds: PalletBuild[]; totalPallets: number; totalCubedCbm: number; totalWeightKg: number } {
  const tare = opts.palletTareKg ?? DEFAULT_PALLET_TARE_KG;
  const builds = lines.map((l, i) => palletiseLine(l, opts, i));
  const totalWeightKg = builds.reduce((sum, b, i) => {
    const line = lines[i]!;
    const cargo = (line.weightKg || 0) * Math.max(0, line.qty || 0);
    return sum + cargo + tare * b.palletCount;
  }, 0);
  return {
    builds,
    totalPallets: builds.reduce((s, b) => s + b.palletCount, 0),
    totalCubedCbm: builds.reduce((s, b) => s + b.cubedVolumeCbmTotal, 0),
    totalWeightKg,
  };
}
