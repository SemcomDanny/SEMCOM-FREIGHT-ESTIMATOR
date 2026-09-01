import type { AirRate, ContainerType, PalletType } from './types.js';

/**
 * Seed equipment data. These are defaults an admin can edit — internal
 * dimensions vary by carrier and by build, so never treat them as gospel.
 */
export const SEED_CONTAINER_TYPES: ContainerType[] = [
  { id: '20GP', name: "20' GP", intLMm: 5900, intWMm: 2350, intHMm: 2390, maxPayloadKg: 28000, active: true },
  { id: '40GP', name: "40' GP", intLMm: 12030, intWMm: 2350, intHMm: 2390, maxPayloadKg: 26500, active: true },
  { id: '40HC', name: "40' HC", intLMm: 12030, intWMm: 2350, intHMm: 2690, maxPayloadKg: 26500, active: true },
  { id: '45HC', name: "45' HC", intLMm: 13550, intWMm: 2350, intHMm: 2690, maxPayloadKg: 27500, active: true },
];

export const SEED_PALLET_TYPES: PalletType[] = [
  {
    id: 'AU-STD',
    name: 'Australian Standard',
    lMm: 1165,
    wMm: 1165,
    deckHMm: 150,
    maxLoadHMm: 1150,
    maxLoadKg: 1000,
    overhangMm: 0,
    active: true,
  },
  {
    id: 'EUR1',
    name: 'Euro EUR1',
    lMm: 1200,
    wMm: 800,
    deckHMm: 150,
    maxLoadHMm: 1150,
    maxLoadKg: 1000,
    overhangMm: 0,
    active: true,
  },
  {
    id: 'EUR2',
    name: 'Euro EUR2 / Industrial',
    lMm: 1200,
    wMm: 1000,
    deckHMm: 150,
    maxLoadHMm: 1150,
    maxLoadKg: 1000,
    overhangMm: 0,
    active: true,
  },
];

/** IATA-style weight breaks, used as the shape for a new air rate card. */
export const SEED_AIR_RATE: AirRate = {
  minCharge: 150,
  breaks: [
    { thresholdKg: 0, ratePerKg: 8.5 },
    { thresholdKg: 45, ratePerKg: 6.9 },
    { thresholdKg: 100, ratePerKg: 5.8 },
    { thresholdKg: 300, ratePerKg: 5.1 },
    { thresholdKg: 500, ratePerKg: 4.6 },
  ],
  fuelSurchargePerKg: 1.1,
  securitySurchargePerKg: 0.25,
  volumetricDivisor: 6000,
};

/** Ancillary charges the team actually sees on an Australian import. */
export const SEED_ANCILLARY_NAMES = [
  'Customs clearance',
  'CTO / unpack fee',
  'Quarantine (DAFF) inspection allowance',
  'Fumigation',
  'Delivery cartage to warehouse',
  'Documentation',
] as const;

/**
 * Distinct, colour-blind-safe hues for carton types. The 3D view, the legend
 * and the input table all index into this same list so they cannot disagree.
 */
export const CARTON_COLORS = [
  '#2563eb',
  '#f97316',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#4d7c0f',
  '#7c3aed',
  '#0d9488',
  '#b45309',
] as const;

export function colorFor(index: number): string {
  return CARTON_COLORS[index % CARTON_COLORS.length]!;
}
