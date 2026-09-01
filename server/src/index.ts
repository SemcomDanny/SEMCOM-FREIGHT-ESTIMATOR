import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate, runDataMigrations } from './db.js';
import { assertProductionConfig } from './security.js';
import { authRouter } from './routes/auth.js';
import { masterRouter } from './routes/master.js';
import { ratesRouter } from './routes/rates.js';
import { jobsRouter } from './routes/jobs.js';
import { estimateRouter } from './routes/estimate.js';
import { publicRfqRouter, rfqRouter } from './routes/rfq.js';
import { seedIfEmpty } from './seed.js';

assertProductionConfig();
migrate();
seedIfEmpty();
runDataMigrations();

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// Behind a platform proxy (Railway, Fly, nginx) so secure cookies and the
// client IP the login throttle keys on are read from the forwarded headers.
app.set('trust proxy', 1);

app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// In production the API and the frontend are the same origin, so CORS is only
// enabled when a cross-origin dev server is explicitly configured.
const corsOrigin = process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === 'production' ? null : 'http://localhost:5173');
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin, credentials: true }));
}

app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
app.use('/api/auth', authRouter);
app.use('/api/master', masterRouter);
app.use('/api/rates', ratesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/estimate', estimateRouter);
app.use('/api/rfq', rfqRouter);
// Unauthenticated: the forwarder has only their tokenised link.
app.use('/api/public/rfq', publicRfqRouter);

// Serve the built frontend when there is one (single-container deployment).
const webDist = path.resolve(process.cwd(), 'web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  // On an office machine the useful address is the one other computers can
  // reach, so print those rather than just localhost.
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  // eslint-disable-next-line no-console
  console.log(`\nSemcom Freight Estimator is running.\n`);
  // eslint-disable-next-line no-console
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const address of addresses) {
    // eslint-disable-next-line no-console
    console.log(`  On the network:     http://${address}:${PORT}`);
  }
  if (addresses.length === 0) {
    // eslint-disable-next-line no-console
    console.log('  (no network address found — other computers will not be able to reach this)');
  }
  // eslint-disable-next-line no-console
  console.log('\nLeave this window open. Closing it stops the tool for everyone.\n');
});
