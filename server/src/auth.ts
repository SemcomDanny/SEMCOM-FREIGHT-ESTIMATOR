import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { db, newId } from './db.js';

export type Role = 'estimator' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const SECRET = process.env.JWT_SECRET ?? 'semcom-dev-secret-change-me';
const TOKEN_TTL = '12h';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.warn('JWT_SECRET is not set — set it before deploying beyond a local trial.');
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function createUser(
  email: string,
  name: string,
  role: Role,
  password: string,
): AuthUser {
  const id = newId('usr');
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, email.toLowerCase(), name, role, hashPassword(password), new Date().toISOString());
  return { id, email: email.toLowerCase(), name, role };
}

export function verifyLogin(email: string, password: string): AuthUser | null {
  const row = db
    .prepare('SELECT id, email, name, role, password_hash, active FROM users WHERE email = ?')
    .get(email.toLowerCase()) as
    | { id: string; email: string; name: string; role: Role; password_hash: string; active: number }
    | undefined;
  if (!row || !row.active) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, SECRET, { expiresIn: TOKEN_TTL });
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.token;
  return cookie ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  try {
    const payload = jwt.verify(token, SECRET) as AuthUser & { iat: number; exp: number };
    req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — sign in again' });
  }
}

/** Rate cards and master data are admin-only; everything else is read-write. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required for this change' });
    return;
  }
  next();
}
