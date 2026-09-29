import { Router } from 'express';
import type { FitModel, ForecastMethod, ShipMode } from '@semcom/engine';
import { fitLclCurve, forecast, isStale, sampleCurve, summariseVariance } from '@semcom/engine';
import { requireAdmin, requireAuth } from '../auth.js';
import { db, getSetting } from '../db.js';
import { activeRateCard, createRateCard, getRateCard, listRateCards } from '../rates.js';
import { rateSeries } from '../history.js';

export const ratesRouter = Router();
ratesRouter.use(requireAuth);

const MODES: ShipMode[] = ['LCL', 'FCL', 'AIR'];

function parseMode(value: unknown): ShipMode | undefined {
  return MODES.includes(value as ShipMode) ? (value as ShipMode) : undefined;
}

/** Every version for a lane, newest first — nothing is ever removed. */
ratesRouter.get('/cards', (req, res) => {
  const laneId = String(req.query.laneId ?? '');
  if (!laneId) {
    res.status(400).json({ error: 'laneId is required' });
    return;
  }
  const rows = listRateCards(laneId, parseMode(req.query.mode));
  const withNames = rows.map((r) => {
    const user = r.entered_by
      ? (db.prepare('SELECT name FROM users WHERE id = ?').get(r.entered_by) as { name: string } | undefined)
      : undefined;
    return { ...r, entered_by_name: user?.name ?? null };
  });
  res.json(withNames);
});

ratesRouter.get('/cards/:id', (req, res) => {
  const card = getRateCard(req.params.id);
  if (!card) {
    res.status(404).json({ error: 'Rate version not found' });
    return;
  }
  res.json(card);
});

/** The version in force for a lane on a given date. */
ratesRouter.get('/active', (req, res) => {
  const laneId = String(req.query.laneId ?? '');
  const asOf = req.query.asOf ? String(req.query.asOf) : undefined;
  if (!laneId) {
    res.status(400).json({ error: 'laneId is required' });
    return;
  }
  const staleDays = Number(getSetting('stale_rate_days', '60'));
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const out = MODES.map((mode) => {
    const card = activeRateCard(laneId, mode, asOf);
    const series = rateSeries(laneId, mode, { referenceCbm: Number(req.query.referenceCbm) || 5 });
    // A rate quoted with a future start date is a version that exists but is
    // not in force. Without this the estimator sees "no rates" and has no way
    // to know one is scheduled.
    const upcoming = db
      .prepare(
        `SELECT effective_from FROM rate_cards
         WHERE lane_id = ? AND mode = ? AND effective_from > ?
         ORDER BY effective_from LIMIT 1`,
      )
      .get(laneId, mode, today) as { effective_from: string } | undefined;
    return {
      mode,
      card,
      stale: isStale(series, staleDays),
      versions: series.length,
      nextEffectiveFrom: upcoming?.effective_from ?? null,
    };
  });
  res.json(out);
});

/**
 * Save a rate change. This always inserts a new version — the previous one is
 * kept and stays queryable, and appears on the history chart.
 */
ratesRouter.post('/cards', requireAdmin, (req, res) => {
  const body = req.body ?? {};
  const mode = parseMode(body.mode);
  if (!body.laneId || !mode || !body.effectiveFrom) {
    res.status(400).json({ error: 'laneId, mode and effectiveFrom are required' });
    return;
  }
  if (mode === 'LCL') {
    const points = body.lclPoints ?? [];
    if (points.length < 3) {
      res.status(400).json({ error: 'At least three volume/price points are required for an LCL curve' });
      return;
    }
    if (points.some((p: { volumeCbm: number }) => !(p.volumeCbm > 0))) {
      res.status(400).json({ error: 'Every LCL point needs a volume greater than zero' });
      return;
    }
  }
  if (mode === 'FCL' && !(body.fcl?.length > 0)) {
    res.status(400).json({ error: 'At least one container rate is required' });
    return;
  }

  const card = createRateCard(
    {
      laneId: body.laneId,
      mode,
      currency: body.currency ?? 'AUD',
      fxToAud: Number(body.fxToAud ?? 1),
      effectiveFrom: body.effectiveFrom,
      note: body.note,
      fcl: body.fcl,
      lclPoints: body.lclPoints,
      lclConfig: body.lclConfig,
      air: body.air,
      ancillaries: body.ancillaries,
    },
    req.user!.id,
  );
  res.status(201).json(card);
});

/** Preview a curve fit before saving, so the shape can be sanity-checked. */
ratesRouter.post('/preview-curve', (req, res) => {
  const points = req.body?.points ?? [];
  const model: FitModel = req.body?.fitModel ?? 'piecewise_linear';
  const config = {
    fitModel: model,
    minCharge: Number(req.body?.minCharge ?? 0),
    minCbm: Number(req.body?.minCbm ?? 0),
  };
  const curve = fitLclCurve(points, model);
  res.json({
    model,
    params: curve.params,
    r2: curve.r2,
    residuals: curve.residuals,
    warnings: curve.warnings,
    description: curve.describe(),
    points: curve.points,
    samples: sampleCurve(curve, config, 0.5, Math.max(25, ...points.map((p: { volumeCbm: number }) => p.volumeCbm * 1.5)), 80),
  });
});

/** History chart, variance metrics and the forecast options for a lane. */
ratesRouter.get('/history', (req, res) => {
  const laneId = String(req.query.laneId ?? '');
  const mode = parseMode(req.query.mode);
  if (!laneId || !mode) {
    res.status(400).json({ error: 'laneId and mode are required' });
    return;
  }
  const opts = {
    referenceCbm: Number(req.query.referenceCbm) || 5,
    containerTypeId: req.query.containerTypeId ? String(req.query.containerTypeId) : undefined,
    referenceKg: Number(req.query.referenceKg) || 100,
    inAud: req.query.inAud === 'true',
  };
  const series = rateSeries(laneId, mode, opts);
  const windows = [3, 6, 12];
  const staleDays = Number(getSetting('stale_rate_days', '60'));

  res.json({
    series,
    summary: summariseVariance(series),
    windows: windows.map((months) => ({
      months,
      summary: summariseVariance(
        series.filter((p) => {
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() - months);
          return p.date >= cutoff.toISOString().slice(0, 10);
        }),
      ),
    })),
    forecasts: (['latest', 'trailing_average', 'linear_trend'] as ForecastMethod[]).flatMap((method) =>
      method === 'latest'
        ? [forecast(series, method)].filter(Boolean)
        : windows.map((months) => forecast(series, method, months)).filter(Boolean),
    ),
    stale: isStale(series, staleDays),
    staleDays,
    reference: opts,
  });
});
