/**
 * Domain types for the Semcom freight estimating engine.
 *
 * Canonical units throughout the engine:
 *   - all linear dimensions in millimetres (mm)
 *   - all weights in kilograms (kg)
 *   - all volumes in cubic metres (CBM)
 *   - all money in the rate card's own currency unless a field says `Aud`
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in';
export type WeightUnit = 'kg' | 'lb';

/** A carton line item as entered by the estimator. */
export interface CartonLine {
  id: string;
  description: string;
  /** Canonical millimetres. */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** Gross weight of one carton, kg. */
  weightKg: number;
  /** Number of cartons. */
  qty: number;
  /** Units of saleable product inside one carton (for per-unit allocation). */
  unitsPerCarton?: number;
  /** Whether anything may be stacked on top of this carton. */
  stackable?: boolean;
  /** Maximum number of these cartons in a vertical stack (including itself). */
  maxStackLayers?: number;
  /** "This way up" — the carton may not be tipped onto another face. */
  thisWayUp?: boolean;
}

export interface CartonLineMetrics {
  id: string;
  description: string;
  /** Volume of a single carton, CBM (rounded to 4 dp for display by the caller). */
  volumeCbmEach: number;
  /** qty x volumeCbmEach */
  volumeCbmTotal: number;
  weightKgTotal: number;
  qty: number;
  unitsTotal: number;
  /** kg per CBM for this line. */
  densityKgPerCbm: number;
}

export interface ConsignmentMetrics {
  lines: CartonLineMetrics[];
  totalCartons: number;
  totalUnits: number;
  /** Sum of geometric carton volume, CBM. */
  totalVolumeCbm: number;
  totalWeightKg: number;
  /** totalWeightKg / totalVolumeCbm (0 when there is no volume). */
  densityKgPerCbm: number;
  /** True when density exceeds 1,000 kg/CBM — the shipment is weight-charged. */
  weightCharged: boolean;
  /** W/M revenue tonne: max(totalVolumeCbm, totalWeightKg / 1000). */
  chargeableCbm: number;
  /** Which of the two drove the chargeable figure. */
  chargeableBasis: 'volume' | 'weight';
}

/* ------------------------------------------------------------------ */
/* Equipment                                                          */
/* ------------------------------------------------------------------ */

export interface ContainerType {
  id: string;
  name: string;
  intLMm: number;
  intWMm: number;
  intHMm: number;
  maxPayloadKg: number;
  active?: boolean;
}

export interface PalletType {
  id: string;
  name: string;
  lMm: number;
  wMm: number;
  /** Height of the pallet deck itself. */
  deckHMm: number;
  /** Maximum height of cargo stacked above the deck. */
  maxLoadHMm: number;
  maxLoadKg: number;
  /** Permitted carton overhang beyond the pallet footprint, per side. */
  overhangMm?: number;
  active?: boolean;
}

/* ------------------------------------------------------------------ */
/* Packing                                                            */
/* ------------------------------------------------------------------ */

/** A single placed box inside a container, in container-local mm coordinates. */
export interface Placement {
  /** Source line (carton) or pallet group id. */
  refId: string;
  label: string;
  /** Index of the container this placement belongs to (0-based). */
  containerIndex: number;
  x: number;
  y: number;
  z: number;
  /** Placed dimensions after orientation. */
  lMm: number;
  wMm: number;
  hMm: number;
  weightKg: number;
  /** Stable colour index so the 3D view and the input table agree. */
  colorIndex: number;
}

export interface PackedContainer {
  index: number;
  containerTypeId: string;
  containerTypeName: string;
  placements: Placement[];
  placedVolumeCbm: number;
  placedWeightKg: number;
  /** placedVolumeCbm / interior volume. */
  volumeUtilisation: number;
  /** placedWeightKg / maxPayloadKg. */
  payloadUtilisation: number;
  /** True when the container stopped filling because of the payload limit. */
  payloadLimited: boolean;
}

export interface UnplacedItem {
  refId: string;
  label: string;
  qty: number;
  reason: string;
}

export interface PackResult {
  containers: PackedContainer[];
  unplaced: UnplacedItem[];
  /** Weighted mean volumetric utilisation across all containers used. */
  meanVolumeUtilisation: number;
  meanPayloadUtilisation: number;
  totalPlacedVolumeCbm: number;
  totalPlacedWeightKg: number;
  /** Efficiency factor that was applied. */
  stowEfficiency: number;
}

/** A cuboid to be packed — either a carton or a built pallet. */
export interface PackItem {
  refId: string;
  label: string;
  lMm: number;
  wMm: number;
  hMm: number;
  weightKg: number;
  qty: number;
  colorIndex: number;
  /** May other items sit on top of this one? */
  stackable: boolean;
  /** Max identical items in a vertical stack. */
  maxStackLayers?: number;
  /** Must keep its height axis vertical (no tipping). */
  thisWayUp?: boolean;
}

/* ------------------------------------------------------------------ */
/* Palletisation                                                      */
/* ------------------------------------------------------------------ */

export interface PalletPatternCell {
  x: number;
  y: number;
  lMm: number;
  wMm: number;
  /** true when the carton was turned 90 degrees from its entered orientation. */
  rotated: boolean;
}

export interface PalletBuild {
  lineId: string;
  description: string;
  palletTypeId: string;
  palletTypeName: string;
  cartonsPerLayer: number;
  layers: number;
  cartonsPerPallet: number;
  /** Whole pallets built at the full pattern. */
  fullPallets: number;
  /** Cartons on the final part-filled pallet (0 when it divides evenly). */
  remainderCartons: number;
  palletCount: number;
  /** Deck + cargo height of a full pallet, mm. */
  loadedHeightMm: number;
  /** Gross weight of a full pallet including the deck allowance, kg. */
  palletGrossKg: number;
  /** Footprint L x W x loaded height, CBM — this is what governs container fit. */
  cubedVolumeCbmEach: number;
  cubedVolumeCbmTotal: number;
  /** Layer pattern for the 2D/3D view. */
  pattern: PalletPatternCell[];
  /** Effective footprint after allowable overhang. */
  footprintLMm: number;
  footprintWMm: number;
  warnings: string[];
  colorIndex: number;
}

/* ------------------------------------------------------------------ */
/* Rates                                                              */
/* ------------------------------------------------------------------ */

export type ShipMode = 'LCL' | 'FCL' | 'AIR';
export type FitModel = 'piecewise_linear' | 'log_linear' | 'power';
export type AncillaryBasis = 'per_shipment' | 'per_cbm' | 'per_container' | 'per_kg';

export interface LclPoint {
  volumeCbm: number;
  totalPrice: number;
}

export interface LclConfig {
  fitModel: FitModel;
  /** Dollar floor applied after the curve. */
  minCharge?: number;
  /** Volume floor — the curve is evaluated at max(volume, minCbm). */
  minCbm?: number;
}

export interface FclRate {
  containerTypeId: string;
  oceanCost: number;
  originCharges: number;
  destCharges: number;
}

export interface AncillaryCharge {
  id?: string;
  name: string;
  basis: AncillaryBasis;
  amount: number;
  /** Which mode the charge applies to; omitted = all modes. */
  mode?: ShipMode;
}

export interface AirBreak {
  /** Weight break threshold in kg (0 = the "under 45" / normal rate). */
  thresholdKg: number;
  ratePerKg: number;
}

export interface AirRate {
  minCharge: number;
  breaks: AirBreak[];
  fuelSurchargePerKg: number;
  securitySurchargePerKg: number;
  /** Volumetric divisor, cm3 per kg. IATA standard is 6000. */
  volumetricDivisor: number;
}

export interface RateCard {
  id: string;
  laneId: string;
  mode: ShipMode;
  currency: string;
  fxToAud: number;
  effectiveFrom: string;
  enteredBy?: string;
  enteredAt?: string;
  note?: string;
  supersededBy?: string | null;
  fcl?: FclRate[];
  lclPoints?: LclPoint[];
  lclConfig?: LclConfig;
  air?: AirRate;
  ancillaries?: AncillaryCharge[];
}

/* ------------------------------------------------------------------ */
/* Costing                                                            */
/* ------------------------------------------------------------------ */

/** One line of an estimate, carrying its own formula for the hover/expand panel. */
export interface CostComponent {
  label: string;
  amount: number;
  amountAud: number;
  /** Human-readable derivation, e.g. "curve(12.4 CBM) @ piecewise linear". */
  formula: string;
  /** Rate card version this component came from. */
  sourceRateCardId?: string;
}

export interface CostEstimate {
  mode: ShipMode;
  /** "12.40 CBM chargeable" or "1 x 40HC" */
  basis: string;
  currency: string;
  fxToAud: number;
  /** Ocean or air freight alone. */
  oceanCost: number;
  /** Origin + destination charges (THC, wharfage, docs, ISPS). FCL only. */
  portChargesCost: number;
  ancillariesCost: number;
  total: number;
  totalAud: number;
  components: CostComponent[];
  costPerCbm: number;
  costPerCarton: number;
  costPerUnit: number | null;
  /** For FCL: the container mix chosen. */
  containerMix?: { containerTypeId: string; containerTypeName: string; count: number }[];
  warnings: string[];
}
