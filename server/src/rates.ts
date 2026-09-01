import type { AncillaryCharge, FitModel, RateCard, ShipMode } from '@semcom/engine';
import { db, audit, newId } from './db.js';

interface CardRow {
  id: string;
  lane_id: string;
  mode: ShipMode;
  currency: string;
  fx_to_aud: number;
  effective_from: string;
  entered_by: string | null;
  entered_at: string;
  note: string | null;
  superseded_by: string | null;
}

/** Hydrate a full rate card, including whichever rate tables its mode uses. */
export function getRateCard(id: string): RateCard | null {
  const row = db.prepare('SELECT * FROM rate_cards WHERE id = ?').get(id) as CardRow | undefined;
  if (!row) return null;

  const card: RateCard = {
    id: row.id,
    laneId: row.lane_id,
    mode: row.mode,
    currency: row.currency,
    fxToAud: row.fx_to_aud,
    effectiveFrom: row.effective_from,
    enteredBy: row.entered_by ?? undefined,
    enteredAt: row.entered_at,
    note: row.note ?? undefined,
    supersededBy: row.superseded_by,
  };

  if (row.mode === 'FCL') {
    card.fcl = db
      .prepare('SELECT container_type_id, ocean_cost, origin_charges, dest_charges FROM fcl_rates WHERE rate_card_id = ?')
      .all(id)
      .map((r) => {
        const f = r as { container_type_id: string; ocean_cost: number; origin_charges: number; dest_charges: number };
        return {
          containerTypeId: f.container_type_id,
          oceanCost: f.ocean_cost,
          originCharges: f.origin_charges,
          destCharges: f.dest_charges,
        };
      });
  }

  if (row.mode === 'LCL') {
    card.lclPoints = db
      .prepare('SELECT volume_cbm, total_price FROM lcl_points WHERE rate_card_id = ? ORDER BY volume_cbm')
      .all(id)
      .map((r) => {
        const p = r as { volume_cbm: number; total_price: number };
        return { volumeCbm: p.volume_cbm, totalPrice: p.total_price };
      });
    const cfg = db.prepare('SELECT fit_model, min_charge, min_cbm FROM lcl_config WHERE rate_card_id = ?').get(id) as
      | { fit_model: FitModel; min_charge: number; min_cbm: number }
      | undefined;
    card.lclConfig = {
      fitModel: cfg?.fit_model ?? 'piecewise_linear',
      minCharge: cfg?.min_charge ?? 0,
      minCbm: cfg?.min_cbm ?? 0,
    };
  }

  if (row.mode === 'AIR') {
    const air = db.prepare('SELECT * FROM air_rates WHERE rate_card_id = ?').get(id) as
      | {
          min_charge: number;
          breaks_json: string;
          fuel_surcharge_per_kg: number;
          security_surcharge_per_kg: number;
          volumetric_divisor: number;
        }
      | undefined;
    if (air) {
      card.air = {
        minCharge: air.min_charge,
        breaks: JSON.parse(air.breaks_json),
        fuelSurchargePerKg: air.fuel_surcharge_per_kg,
        securitySurchargePerKg: air.security_surcharge_per_kg,
        volumetricDivisor: air.volumetric_divisor,
      };
    }
  }

  card.ancillaries = db
    .prepare('SELECT id, name, basis, amount FROM ancillary_charges WHERE rate_card_id = ?')
    .all(id) as AncillaryCharge[];

  return card;
}

/** Every version for a lane and mode, newest effective date first. */
export function listRateCards(laneId: string, mode?: ShipMode): CardRow[] {
  const sql = mode
    ? 'SELECT * FROM rate_cards WHERE lane_id = ? AND mode = ? ORDER BY effective_from DESC, entered_at DESC'
    : 'SELECT * FROM rate_cards WHERE lane_id = ? ORDER BY effective_from DESC, entered_at DESC';
  return (mode ? db.prepare(sql).all(laneId, mode) : db.prepare(sql).all(laneId)) as CardRow[];
}

/** The version in force on `asOf` — the newest one that had already taken effect. */
export function activeRateCard(laneId: string, mode: ShipMode, asOf?: string): RateCard | null {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT id FROM rate_cards
       WHERE lane_id = ? AND mode = ? AND effective_from <= ?
       ORDER BY effective_from DESC, entered_at DESC LIMIT 1`,
    )
    .get(laneId, mode, date) as { id: string } | undefined;
  return row ? getRateCard(row.id) : null;
}

export interface NewRateCardInput {
  laneId: string;
  mode: ShipMode;
  currency: string;
  fxToAud: number;
  effectiveFrom: string;
  note?: string;
  fcl?: { containerTypeId: string; oceanCost: number; originCharges: number; destCharges: number }[];
  lclPoints?: { volumeCbm: number; totalPrice: number }[];
  lclConfig?: { fitModel: FitModel; minCharge: number; minCbm: number };
  air?: {
    minCharge: number;
    breaks: { thresholdKg: number; ratePerKg: number }[];
    fuelSurchargePerKg: number;
    securitySurchargePerKg: number;
    volumetricDivisor: number;
  };
  ancillaries?: { name: string; basis: string; amount: number }[];
}

/**
 * Save a new rate version.
 *
 * Nothing is overwritten. The previously current version for the lane and mode
 * has its superseded_by stamped so the chain stays walkable, but its own rate
 * rows are untouched and every past estimate still resolves.
 */
export function createRateCard(input: NewRateCardInput, userId: string): RateCard {
  const id = newId('rc');
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const previous = db
      .prepare(
        `SELECT id FROM rate_cards
         WHERE lane_id = ? AND mode = ? AND superseded_by IS NULL
         ORDER BY effective_from DESC, entered_at DESC LIMIT 1`,
      )
      .get(input.laneId, input.mode) as { id: string } | undefined;

    db.prepare(
      `INSERT INTO rate_cards (id, lane_id, mode, currency, fx_to_aud, effective_from, entered_by, entered_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.laneId,
      input.mode,
      input.currency,
      input.fxToAud,
      input.effectiveFrom,
      userId,
      now,
      input.note ?? null,
    );

    if (previous) {
      db.prepare('UPDATE rate_cards SET superseded_by = ? WHERE id = ?').run(id, previous.id);
      audit('rate_cards', previous.id, 'superseded', userId, { supersededBy: id });
    }

    for (const f of input.fcl ?? []) {
      db.prepare(
        `INSERT INTO fcl_rates (id, rate_card_id, container_type_id, ocean_cost, origin_charges, dest_charges)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId('fcl'), id, f.containerTypeId, f.oceanCost, f.originCharges, f.destCharges);
    }

    for (const p of input.lclPoints ?? []) {
      db.prepare('INSERT INTO lcl_points (id, rate_card_id, volume_cbm, total_price) VALUES (?, ?, ?, ?)').run(
        newId('lp'),
        id,
        p.volumeCbm,
        p.totalPrice,
      );
    }

    if (input.mode === 'LCL') {
      const cfg = input.lclConfig ?? { fitModel: 'piecewise_linear' as FitModel, minCharge: 0, minCbm: 1 };
      db.prepare(
        'INSERT INTO lcl_config (rate_card_id, fit_model, min_charge, min_cbm) VALUES (?, ?, ?, ?)',
      ).run(id, cfg.fitModel, cfg.minCharge, cfg.minCbm);
    }

    if (input.air) {
      db.prepare(
        `INSERT INTO air_rates (rate_card_id, min_charge, breaks_json, fuel_surcharge_per_kg, security_surcharge_per_kg, volumetric_divisor)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.air.minCharge,
        JSON.stringify(input.air.breaks),
        input.air.fuelSurchargePerKg,
        input.air.securitySurchargePerKg,
        input.air.volumetricDivisor,
      );
    }

    for (const a of input.ancillaries ?? []) {
      db.prepare(
        'INSERT INTO ancillary_charges (id, rate_card_id, name, basis, amount) VALUES (?, ?, ?, ?, ?)',
      ).run(newId('anc'), id, a.name, a.basis, a.amount);
    }

    audit('rate_cards', id, 'created', userId, {
      laneId: input.laneId,
      mode: input.mode,
      effectiveFrom: input.effectiveFrom,
      note: input.note,
    });
  });

  tx();
  return getRateCard(id)!;
}
