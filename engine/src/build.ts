import type { CartonLine, PackItem, PalletBuild, PalletType } from './types.js';
import { DEFAULT_PALLET_TARE_KG } from './pallets.js';

/** Turn carton lines into pack items for floor-loading. */
export function cartonPackItems(lines: CartonLine[]): PackItem[] {
  return lines
    .filter((l) => l.qty > 0 && l.lengthMm > 0 && l.widthMm > 0 && l.heightMm > 0)
    .map((l, i) => ({
      refId: l.id,
      label: l.description || `Line ${i + 1}`,
      lMm: l.lengthMm,
      wMm: l.widthMm,
      hMm: l.heightMm,
      weightKg: l.weightKg || 0,
      qty: l.qty,
      colorIndex: i,
      stackable: l.stackable !== false,
      maxStackLayers: l.maxStackLayers,
      thisWayUp: l.thisWayUp,
    }));
}

/**
 * Turn pallet builds into pack items. Full pallets and the part-filled tail
 * pallet are separate items because the tail is genuinely shorter — cubing it
 * at full height would overstate the container requirement.
 */
export function palletPackItems(
  builds: PalletBuild[],
  lines: CartonLine[],
  palletType: PalletType,
  tareKg = DEFAULT_PALLET_TARE_KG,
): PackItem[] {
  const items: PackItem[] = [];
  builds.forEach((b, i) => {
    const line = lines.find((l) => l.id === b.lineId);
    if (!line || b.palletCount === 0) return;
    if (b.fullPallets > 0) {
      items.push({
        refId: `${b.lineId}::pallet`,
        label: `${b.description} — pallet (${b.cartonsPerPallet} ctn)`,
        lMm: b.footprintLMm,
        wMm: b.footprintWMm,
        hMm: b.loadedHeightMm,
        weightKg: b.palletGrossKg,
        qty: b.fullPallets,
        colorIndex: i,
        // Pallets are only stacked when the cargo allows it and the height
        // budget is there; the packer decides, the flag just permits it.
        stackable: line.stackable !== false,
        thisWayUp: true,
      });
    }
    if (b.remainderCartons > 0 && b.cartonsPerLayer > 0) {
      const layers = Math.ceil(b.remainderCartons / b.cartonsPerLayer);
      items.push({
        refId: `${b.lineId}::pallet-part`,
        label: `${b.description} — part pallet (${b.remainderCartons} ctn)`,
        lMm: b.footprintLMm,
        wMm: b.footprintWMm,
        hMm: b.loadedHeightMm - (b.layers - layers) * line.heightMm,
        weightKg: tareKg + b.remainderCartons * (line.weightKg || 0),
        qty: 1,
        colorIndex: i,
        stackable: line.stackable !== false,
        thisWayUp: true,
      });
    }
  });
  return items;
}
