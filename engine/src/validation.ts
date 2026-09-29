import type { CartonLine, ContainerType, PalletBuild, PalletType } from './types.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** Carton line id the issue belongs to, when it is line-specific. */
  lineId?: string;
}

/** Single-carton weight above which manual handling becomes a WHS problem. */
export const MANUAL_HANDLING_KG = 30;

/** ISO container internal width — Australian Standard pallets sit badly in it. */
export const AUS_STANDARD_FOOTPRINT_MM = 1165;

export function validateCartonLine(line: CartonLine): Issue[] {
  const issues: Issue[] = [];
  const dims: [string, number][] = [
    ['length', line.lengthMm],
    ['width', line.widthMm],
    ['height', line.heightMm],
  ];
  for (const [name, value] of dims) {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({
        severity: 'error',
        code: 'DIM_NOT_POSITIVE',
        lineId: line.id,
        message: `${line.description || 'Line'}: ${name} must be greater than zero.`,
      });
    }
  }
  if (!Number.isFinite(line.weightKg) || line.weightKg < 0) {
    issues.push({
      severity: 'error',
      code: 'WEIGHT_NEGATIVE',
      lineId: line.id,
      message: `${line.description || 'Line'}: weight cannot be negative.`,
    });
  }
  if (!Number.isFinite(line.qty) || line.qty < 0 || !Number.isInteger(line.qty)) {
    issues.push({
      severity: 'error',
      code: 'QTY_INVALID',
      lineId: line.id,
      message: `${line.description || 'Line'}: quantity must be a whole number of cartons.`,
    });
  }
  if (line.weightKg > MANUAL_HANDLING_KG) {
    issues.push({
      severity: 'warning',
      code: 'MANUAL_HANDLING',
      lineId: line.id,
      message: `${line.description || 'Line'}: ${line.weightKg} kg per carton exceeds the ${MANUAL_HANDLING_KG} kg manual handling limit — mechanical handling or a two-person lift is required.`,
    });
  }
  return issues;
}

/** A carton has to physically go through the container door and sit inside it. */
export function validateAgainstContainer(line: CartonLine, container: ContainerType): Issue[] {
  const issues: Issue[] = [];
  const dims = [line.lengthMm, line.widthMm, line.heightMm].sort((a, b) => b - a);
  const opening = [container.intLMm, container.intWMm, container.intHMm].sort((a, b) => b - a);
  const fits = dims.every((d, i) => d <= opening[i]! + 1e-6);
  if (!fits) {
    issues.push({
      severity: 'error',
      code: 'CARTON_OVERSIZE',
      lineId: line.id,
      message: `${line.description || 'Line'}: ${Math.round(line.lengthMm)} x ${Math.round(line.widthMm)} x ${Math.round(line.heightMm)} mm will not fit inside a ${container.name} (${container.intLMm} x ${container.intWMm} x ${container.intHMm} mm) in any orientation.`,
    });
  }
  return issues;
}

export function validatePalletBuild(build: PalletBuild, pallet: PalletType): Issue[] {
  const issues: Issue[] = build.warnings.map((message) => ({
    severity: 'warning' as Severity,
    code: 'PALLET_BUILD',
    lineId: build.lineId,
    message,
  }));
  if (build.palletGrossKg > pallet.maxLoadKg) {
    issues.push({
      severity: 'warning',
      code: 'PALLET_OVERWEIGHT',
      lineId: build.lineId,
      message: `${build.description}: pallet gross ${Math.round(build.palletGrossKg)} kg exceeds the ${pallet.maxLoadKg} kg limit.`,
    });
  }
  if (build.loadedHeightMm > pallet.deckHMm + pallet.maxLoadHMm) {
    issues.push({
      severity: 'warning',
      code: 'PALLET_OVERHEIGHT',
      lineId: build.lineId,
      message: `${build.description}: loaded height ${Math.round(build.loadedHeightMm)} mm exceeds deck + max load height.`,
    });
  }
  return issues;
}

/**
 * Two Australian Standard pallets across is 2,330 mm in a 2,350 mm internal
 * width, which leaves no working clearance for a forklift or for dunnage.
 */
export function validatePalletInContainer(pallet: PalletType, container: ContainerType): Issue[] {
  const issues: Issue[] = [];
  const across = Math.floor(container.intWMm / pallet.wMm);
  const clearance = container.intWMm - across * pallet.wMm;
  if (pallet.lMm === AUS_STANDARD_FOOTPRINT_MM && pallet.wMm === AUS_STANDARD_FOOTPRINT_MM) {
    issues.push({
      severity: 'warning',
      code: 'AUS_PALLET_ISO',
      message: `Australian Standard pallets (1165 x 1165 mm) load inefficiently in a ${container.name}: two across is ${2 * pallet.wMm} mm in a ${container.intWMm} mm internal width, leaving ${container.intWMm - 2 * pallet.wMm} mm total clearance. Expect wasted space and slow loading.`,
    });
  } else if (across >= 1 && clearance < 40) {
    issues.push({
      severity: 'info',
      code: 'TIGHT_PALLET_FIT',
      message: `${across} x ${pallet.name} across a ${container.name} leaves only ${clearance} mm clearance — tight but workable.`,
    });
  }
  return issues;
}

export interface PayloadCheck {
  totalWeightKg: number;
  totalVolumeCbm: number;
  container: ContainerType;
  containersByVolume: number;
}

/** Warn when weight, not volume, is what forces an extra container. */
export function validatePayload(check: PayloadCheck): Issue[] {
  const issues: Issue[] = [];
  const byWeight = Math.ceil(check.totalWeightKg / check.container.maxPayloadKg);
  if (byWeight > check.containersByVolume) {
    issues.push({
      severity: 'warning',
      code: 'PAYLOAD_LIMITED',
      message: `Payload, not volume, drives the container count: ${Math.round(check.totalWeightKg)} kg needs ${byWeight} x ${check.container.name} at ${check.container.maxPayloadKg} kg each, but only ${check.containersByVolume} by volume.`,
    });
  }
  return issues;
}

export function validateAll(
  lines: CartonLine[],
  containers: ContainerType[],
): Issue[] {
  const issues: Issue[] = [];
  for (const line of lines) {
    issues.push(...validateCartonLine(line));
    // Only flag oversize when it fits none of the available containers.
    if (containers.length > 0) {
      const fitsSomething = containers.some((c) => validateAgainstContainer(line, c).length === 0);
      if (!fitsSomething) issues.push(...validateAgainstContainer(line, containers[0]!));
    }
  }
  return issues;
}
