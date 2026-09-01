import { Router } from 'express';
import { requireAdmin, requireAuth, createUser, signToken, verifyLogin } from '../auth.js';
import { audit, db } from '../db.js';
import { loginThrottle } from '../security.js';

export const authRouter = Router();

const throttle = loginThrottle();

authRouter.post('/login', throttle.middleware, (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  const user = verifyLogin(email, password);
  if (!user) {
    throttle.recordFailure(req);
    res.status(401).json({ error: 'Email or password is incorrect' });
    return;
  }
  throttle.recordSuccess(req);
  const token = signToken(user);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 3600 * 1000,
  });
  res.json({ user, token });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.get('/users', requireAuth, requireAdmin, (_req, res) => {
  res.json(
    db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY name').all(),
  );
});

authRouter.post('/users', requireAuth, requireAdmin, (req, res) => {
  const { email, name, role, password } = req.body ?? {};
  if (!email || !name || !password || !['estimator', 'admin'].includes(role)) {
    res.status(400).json({ error: 'email, name, password and a valid role are required' });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  try {
    const user = createUser(email, name, role, password);
    audit('users', user.id, 'created', req.user!.id, { email, role });
    res.status(201).json(user);
  } catch {
    res.status(409).json({ error: 'That email is already registered' });
  }
});

authRouter.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { role, active } = req.body ?? {};
  if (role && !['estimator', 'admin'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' });
    return;
  }
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  }
  audit('users', req.params.id, 'updated', req.user!.id, { role, active });
  res.json({ ok: true });
});
