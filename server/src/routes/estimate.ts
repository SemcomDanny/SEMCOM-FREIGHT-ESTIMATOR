import { Router } from 'express';
import { buildRfqEmail, landedCost } from '@semcom/engine';
import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { runEstimate } from '../estimateService.js';

export const estimateRouter = Router();
estimateRouter.use(requireAuth);

/**
 * Authoritative server-side estimate. The browser runs the same engine for the
 * live keystroke-by-keystroke figures; this endpoint is what gets stored
 * against a job, so a saved estimate is always reproducible from the rate
 * versions it names.
 */
estimateRouter.post('/', (req, res) => {
  const body = req.body ?? {};
  if (!body.laneId) {
    res.status(400).json({ error: 'laneId is required' });
    return;
  }
  if (!Array.isArray(body.lines)) {
    res.status(400).json({ error: 'lines must be an array of carton lines' });
    return;
  }
  try {
    res.json(runEstimate(body));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

estimateRouter.post('/rfq', (req, res) => {
  const body = req.body ?? {};
  if (!body.metrics) {
    res.status(400).json({ error: 'metrics are required' });
    return;
  }
  res.json(buildRfqEmail({ ...body, senderName: body.senderName ?? req.user!.name }));
});

estimateRouter.post('/landed-cost', (req, res) => {
  const b = req.body ?? {};
  res.json(
    landedCost({
      goodsValueAud: Number(b.goodsValueAud ?? 0),
      freightAud: Number(b.freightAud ?? 0),
      insuranceAud: Number(b.insuranceAud ?? 0),
      dutyRatePct: Number(b.dutyRatePct ?? 0),
      gstRatePct: Number(b.gstRatePct ?? 10),
    }),
  );
});

/** Lane list with a flag for whether it has any rates at all. */
estimateRouter.get('/lanes-with-rates', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM rate_cards rc WHERE rc.lane_id = l.id) AS rate_versions
         FROM lanes l WHERE l.active = 1 ORDER BY l.origin_port, l.destination_port`,
      )
      .all(),
  );
});
