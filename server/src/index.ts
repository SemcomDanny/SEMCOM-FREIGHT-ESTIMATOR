import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './db.js';
import { authRouter } from './routes/auth.js';
import { masterRouter } from './routes/master.js';
import { ratesRouter } from './routes/rates.js';
import { jobsRouter } from './routes/jobs.js';
import { estimateRouter } from './routes/estimate.js';
import { seedIfEmpty } from './seed.js';

migrate();
seedIfEmpty();

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
app.use('/api/auth', authRouter);
app.use('/api/master', masterRouter);
app.use('/api/rates', ratesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/estimate', estimateRouter);

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
  // eslint-disable-next-line no-console
  console.log(`Semcom freight estimator API listening on http://localhost:${PORT}`);
});
