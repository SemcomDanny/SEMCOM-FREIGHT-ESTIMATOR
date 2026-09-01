import type { NextFunction, Request, Response } from 'express';

/**
 * Fail fast on a misconfigured production deployment.
 *
 * This tool holds commercially sensitive rate cards behind a login. A known
 * signing key would let anyone mint an admin session, and a known seeded
 * password is the same problem by another route, so neither is allowed to
 * reach production by default.
 */
export function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    problems.push(
      'JWT_SECRET must be set to at least 32 characters. Generate one with: openssl rand -hex 32',
    );
  }
  if (!process.env.SEED_ADMIN_PASSWORD && !process.env.ALLOW_DEFAULT_ADMIN_PASSWORD) {
    problems.push(
      'SEED_ADMIN_PASSWORD must be set so the first admin does not get a published default password.',
    );
  }

  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `\nRefusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`,
    );
    process.exit(1);
  }
}

interface Attempt {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

/**
 * Small in-memory throttle for the login endpoint.
 *
 * Single process, single container, so a Map is enough — this is a brute-force
 * speed bump for an internet-reachable login, not a distributed rate limiter.
 * State resets on restart, which is acceptable for that purpose.
 */
export function loginThrottle(options: { maxAttempts?: number; windowMs?: number; blockMs?: number } = {}) {
  const maxAttempts = options.maxAttempts ?? 8;
  const windowMs = options.windowMs ?? 10 * 60_000;
  const blockMs = options.blockMs ?? 15 * 60_000;
  const attempts = new Map<string, Attempt>();

  const key = (req: Request): string => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip ?? 'unknown'}|${email}`;
  };

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const k = key(req);
    const entry = attempts.get(k);

    if (entry && entry.blockedUntil > now) {
      const seconds = Math.ceil((entry.blockedUntil - now) / 1000);
      res.status(429).json({
        error: `Too many failed sign-in attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
      });
      return;
    }
    if (entry && now - entry.firstAt > windowMs) attempts.delete(k);

    // Opportunistic cleanup so the map cannot grow without bound.
    if (attempts.size > 5000) {
      for (const [mapKey, value] of attempts) {
        if (value.blockedUntil < now && now - value.firstAt > windowMs) attempts.delete(mapKey);
      }
    }
    next();
  };

  const recordFailure = (req: Request): void => {
    const now = Date.now();
    const k = key(req);
    const entry = attempts.get(k) ?? { count: 0, firstAt: now, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= maxAttempts) {
      entry.blockedUntil = now + blockMs;
      entry.count = 0;
      entry.firstAt = now;
    }
    attempts.set(k, entry);
  };

  const recordSuccess = (req: Request): void => {
    attempts.delete(key(req));
  };

  return { middleware, recordFailure, recordSuccess };
}
