import type { Request, Response, NextFunction } from 'express';
import prisma from '../db.js';

const DEFAULT_CODE = 'thisdudestinky';

// Gate for staff-only endpoints (admin, screens, stats, dispatch board).
// The frontend sends the access code (the same one used to unlock /admin,
// /screen/:slug, /stats, /dispatch) as an `x-access-code` header on every
// request once the user has logged in there. Customer-facing endpoints
// (ordering, tracking, payments) and delivery-agent endpoints (bezorger
// phone page) never go through this — they stay public by design.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-access-code') || '';
  const row = await prisma.setting.findUnique({ where: { key: 'ACCESS_CODE' } });
  const expected = row?.value || DEFAULT_CODE;
  if (!provided || provided !== expected) return res.status(401).json({ error: 'Toegangscode vereist' });
  next();
}
