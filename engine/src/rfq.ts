import type { ConsignmentMetrics, PalletBuild } from './types.js';

export type Incoterm = 'EXW' | 'FCA' | 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DDP';

export interface RfqInput {
  jobRef?: string;
  client?: string;
  originPort: string;
  destinationPort: string;
  incoterm: Incoterm;
  cargoReadyDate?: string;
  commodity: string;
  hsCode?: string;
  dangerousGoods: boolean;
  dgDetails?: string;
  metrics: ConsignmentMetrics;
  palletBuilds?: PalletBuild[];
  loadingMode: 'floor' | 'palletised';
  containerSummary?: string;
  /** Free text appended before the sign-off. */
  notes?: string;
  senderName?: string;
}

export interface RfqEmail {
  subject: string;
  body: string;
}

function fmt(n: number, dp = 2): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Build a ready-to-send rate request for the forwarder. */
export function buildRfqEmail(input: RfqInput): RfqEmail {
  const m = input.metrics;
  const lines: string[] = [];

  const subjectParts = [
    'Rate request',
    `${input.originPort} - ${input.destinationPort}`,
    `${fmt(m.totalVolumeCbm, 3)} CBM / ${fmt(m.totalWeightKg, 0)} kg`,
  ];
  if (input.jobRef) subjectParts.push(`ref ${input.jobRef}`);

  lines.push('Hi,');
  lines.push('');
  lines.push(
    `Could you please quote LCL and FCL for the consignment below, ${input.incoterm} ${input.originPort}?`,
  );
  lines.push('');
  lines.push('CONSIGNMENT');
  lines.push(`  Origin:            ${input.originPort}`);
  lines.push(`  Destination:       ${input.destinationPort}`);
  lines.push(`  Incoterm:          ${input.incoterm}`);
  if (input.cargoReadyDate) lines.push(`  Cargo ready:       ${input.cargoReadyDate}`);
  lines.push(`  Commodity:         ${input.commodity}`);
  if (input.hsCode) lines.push(`  HS code:           ${input.hsCode}`);
  lines.push(
    `  Dangerous goods:   ${input.dangerousGoods ? `YES — ${input.dgDetails ?? 'details to follow'}` : 'No'}`,
  );
  lines.push('');
  lines.push('CARGO');
  lines.push(`  Cartons:           ${m.totalCartons}`);
  lines.push(`  Total volume:      ${fmt(m.totalVolumeCbm, 3)} CBM`);
  lines.push(`  Chargeable (W/M):  ${fmt(m.chargeableCbm, 3)} CBM  (${m.chargeableBasis}-based)`);
  lines.push(`  Gross weight:      ${fmt(m.totalWeightKg, 1)} kg`);
  lines.push(`  Density:           ${fmt(m.densityKgPerCbm, 0)} kg/CBM`);
  lines.push('');
  lines.push('  Carton breakdown:');
  for (const l of m.lines) {
    lines.push(
      `    - ${l.description}: ${l.qty} ctn @ ${fmt(l.volumeCbmEach, 4)} CBM = ` +
        `${fmt(l.volumeCbmTotal, 3)} CBM, ${fmt(l.weightKgTotal, 1)} kg`,
    );
  }

  if (input.loadingMode === 'palletised' && input.palletBuilds?.length) {
    lines.push('');
    lines.push('PALLET CONFIGURATION');
    for (const b of input.palletBuilds) {
      lines.push(
        `    - ${b.description}: ${b.palletCount} x ${b.palletTypeName} ` +
          `(${b.cartonsPerLayer}/layer x ${b.layers} layers), ` +
          `${Math.round(b.loadedHeightMm)} mm loaded height, ${fmt(b.palletGrossKg, 1)} kg each`,
      );
    }
  }

  if (input.containerSummary) {
    lines.push('');
    lines.push('INDICATIVE LOADING');
    lines.push(`  ${input.containerSummary}`);
    lines.push('  (Our estimate only — actual stow subject to your packer.)');
  }

  if (input.notes) {
    lines.push('');
    lines.push('NOTES');
    lines.push(`  ${input.notes}`);
  }

  lines.push('');
  lines.push('Please include origin charges, ocean freight, destination charges, customs clearance');
  lines.push('and delivery, and confirm the free time and any minimum charges that apply.');
  lines.push('');
  lines.push('Thanks,');
  if (input.senderName) lines.push(input.senderName);

  return { subject: subjectParts.join(' | '), body: lines.join('\n') };
}
