import { describe, expect, it } from 'vitest';
import {
  SEED_CONTAINER_TYPES,
  SEED_PALLET_TYPES,
  bestLayerPattern,
  cartonPackItems,
  containerCbm,
  packConsignment,
  palletiseLine,
} from '../src/index.js';
import type { CartonLine, ContainerType } from '../src/index.js';

const c20 = SEED_CONTAINER_TYPES[0]!;
const c40hc = SEED_CONTAINER_TYPES[2]!;

const line = (over: Partial<CartonLine> & { id: string }): CartonLine => ({
  description: over.id,
  lengthMm: 400,
  widthMm: 300,
  heightMm: 250,
  weightKg: 8,
  qty: 10,
  stackable: true,
  ...over,
});

describe('container packing', () => {
  it('places cartons without overlapping and inside the walls', () => {
    const items = cartonPackItems([
      line({ id: 'A', lengthMm: 600, widthMm: 400, heightMm: 300, weightKg: 12, qty: 200 }),
      line({ id: 'B', lengthMm: 400, widthMm: 300, heightMm: 250, weightKg: 5, qty: 300 }),
    ]);
    const result = packConsignment(items, c40hc, { stowEfficiency: 0.85 });
    expect(result.containers.length).toBeGreaterThan(0);

    for (const container of result.containers) {
      for (const p of container.placements) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.x + p.lMm).toBeLessThanOrEqual(c40hc.intLMm + 1e-6);
        expect(p.y + p.wMm).toBeLessThanOrEqual(c40hc.intWMm + 1e-6);
        expect(p.z + p.hMm).toBeLessThanOrEqual(c40hc.intHMm + 1e-6);
      }
      // No two placements may intersect.
      const ps = container.placements;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i]!;
          const b = ps[j]!;
          const overlap =
            a.x < b.x + b.lMm - 1e-6 &&
            b.x < a.x + a.lMm - 1e-6 &&
            a.y < b.y + b.wMm - 1e-6 &&
            b.y < a.y + a.wMm - 1e-6 &&
            a.z < b.z + b.hMm - 1e-6 &&
            b.z < a.z + a.hMm - 1e-6;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('utilisation percentages agree with what was actually placed', () => {
    const items = cartonPackItems([
      line({ id: 'A', lengthMm: 500, widthMm: 400, heightMm: 300, weightKg: 10, qty: 400 }),
    ]);
    const result = packConsignment(items, c20, { stowEfficiency: 0.85 });
    const c = result.containers[0]!;
    const placedVol = c.placements.length * ((500 * 400 * 300) / 1e9);
    expect(c.placedVolumeCbm).toBeCloseTo(placedVol, 6);
    expect(c.volumeUtilisation).toBeCloseTo(placedVol / containerCbm(c20), 6);
    expect(c.payloadUtilisation).toBeCloseTo((c.placements.length * 10) / c20.maxPayloadKg, 6);
  });

  it('never exceeds the stow efficiency share of the container', () => {
    const items = cartonPackItems([
      line({ id: 'A', lengthMm: 500, widthMm: 470, heightMm: 478, weightKg: 2, qty: 5000 }),
    ]);
    for (const eff of [0.7, 0.85, 1]) {
      const r = packConsignment(items, c20, { stowEfficiency: eff });
      for (const c of r.containers) {
        expect(c.volumeUtilisation).toBeLessThanOrEqual(eff + 1e-6);
      }
    }
  });

  it('stops on payload before it fills by volume for dense cargo', () => {
    const items = cartonPackItems([
      line({ id: 'lead', lengthMm: 400, widthMm: 400, heightMm: 400, weightKg: 120, qty: 1000 }),
    ]);
    const r = packConsignment(items, c20, { stowEfficiency: 0.85 });
    const c = r.containers[0]!;
    expect(c.placedWeightKg).toBeLessThanOrEqual(c20.maxPayloadKg);
    expect(c.payloadLimited).toBe(true);
    expect(c.payloadUtilisation).toBeGreaterThan(c.volumeUtilisation);
  });

  it('does not stack anything on a non-stackable carton', () => {
    const items = cartonPackItems([
      line({ id: 'fragile', lengthMm: 1000, widthMm: 1000, heightMm: 500, qty: 20, stackable: false }),
    ]);
    const r = packConsignment(items, c20, { stowEfficiency: 1 });
    for (const c of r.containers) {
      for (const p of c.placements) expect(p.z).toBe(0);
    }
  });

  it('honours a max stack layer limit', () => {
    // "This way up" keeps the 400 mm height vertical, so a 2-layer limit means
    // nothing may sit above 400 mm even though the container is 2,390 mm tall.
    const items = cartonPackItems([
      line({
        id: 'A',
        lengthMm: 1000,
        widthMm: 1000,
        heightMm: 400,
        qty: 60,
        maxStackLayers: 2,
        thisWayUp: true,
      }),
    ]);
    const r = packConsignment(items, c20, { stowEfficiency: 1 });
    expect(r.containers.length).toBeGreaterThan(0);
    for (const c of r.containers) {
      for (const p of c.placements) {
        expect(p.hMm).toBe(400);
        expect(p.z).toBeLessThanOrEqual(400);
      }
    }
  });

  it('keeps a "this way up" carton upright', () => {
    const items = cartonPackItems([
      line({ id: 'A', lengthMm: 600, widthMm: 400, heightMm: 300, qty: 50, thisWayUp: true }),
    ]);
    const r = packConsignment(items, c20, { stowEfficiency: 1 });
    for (const c of r.containers) {
      for (const p of c.placements) expect(p.hMm).toBe(300);
    }
  });

  it('reports items that cannot fit at all', () => {
    const huge: ContainerType = c20;
    const items = cartonPackItems([
      line({ id: 'monster', lengthMm: 7000, widthMm: 2000, heightMm: 2000, qty: 1 }),
    ]);
    const r = packConsignment(items, huge, { stowEfficiency: 1 });
    expect(r.containers).toHaveLength(0);
    expect(r.unplaced[0]!.qty).toBe(1);
  });

  it('is deterministic', () => {
    const items = cartonPackItems([
      line({ id: 'A', lengthMm: 600, widthMm: 400, heightMm: 300, qty: 120 }),
      line({ id: 'B', lengthMm: 350, widthMm: 350, heightMm: 350, qty: 90 }),
    ]);
    const a = packConsignment(items, c40hc, { stowEfficiency: 0.85 });
    const b = packConsignment(items, c40hc, { stowEfficiency: 0.85 });
    expect(JSON.stringify(a.containers)).toBe(JSON.stringify(b.containers));
  });
});

describe('palletisation', () => {
  it('finds the best cartons-per-layer across both orientations', () => {
    // 1200 x 800 Euro pallet, 400 x 300 carton: 3 x 2 = 6 either way.
    const p = bestLayerPattern(1200, 800, 400, 300);
    expect(p.count).toBe(8);
  });

  it('builds pallets that respect height and weight limits', () => {
    const pallet = SEED_PALLET_TYPES[1]!; // EUR1 1200x800, 1150 max load height
    const build = palletiseLine(
      line({ id: 'A', lengthMm: 400, widthMm: 300, heightMm: 250, weightKg: 8, qty: 100 }),
      { palletType: pallet },
    );
    expect(build.cartonsPerLayer).toBeGreaterThan(0);
    expect(build.layers).toBe(4); // floor(1150 / 250)
    expect(build.loadedHeightMm).toBe(150 + 4 * 250);
    expect(build.cartonsPerPallet).toBe(build.cartonsPerLayer * build.layers);
    expect(build.palletCount).toBe(Math.ceil(100 / build.cartonsPerPallet));
    expect(build.palletGrossKg).toBeLessThanOrEqual(pallet.maxLoadKg + 25);
  });

  it('caps layers by pallet weight limit for dense cartons', () => {
    const pallet = SEED_PALLET_TYPES[2]!; // EUR2 1200x1000
    const build = palletiseLine(
      line({ id: 'dense', lengthMm: 600, widthMm: 500, heightMm: 200, weightKg: 60, qty: 40 }),
      { palletType: pallet },
    );
    expect(build.cartonsPerLayer * build.layers * 60).toBeLessThanOrEqual(pallet.maxLoadKg);
  });

  it('does not stack a non-stackable carton on a pallet', () => {
    const build = palletiseLine(
      line({ id: 'ns', heightMm: 200, qty: 20, stackable: false }),
      { palletType: SEED_PALLET_TYPES[1]! },
    );
    expect(build.layers).toBe(1);
  });

  it('cubes the pallet on its footprint and loaded height', () => {
    const pallet = SEED_PALLET_TYPES[1]!;
    const build = palletiseLine(
      line({ id: 'A', lengthMm: 400, widthMm: 400, heightMm: 200, weightKg: 5, qty: 60 }),
      { palletType: pallet },
    );
    const expected = (pallet.lMm * pallet.wMm * build.loadedHeightMm) / 1e9;
    expect(build.cubedVolumeCbmEach).toBeCloseTo(expected, 6);
    expect(build.cubedVolumeCbmEach).toBeGreaterThan(0);
  });
});
