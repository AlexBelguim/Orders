import { Router } from 'express';
import prisma from '../db.js';
import { genCode } from '../util.js';
import { requireAdmin } from '../middleware/auth.js';

export default function tablesRouter() {
  const r = Router();

  // Public: the customer order page (/t/:code) looks up its table by code.
  r.get('/code/:code', async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const table = await prisma.table.findUnique({
      where: { code },
      include: { location: { include: { allowedProfiles: { include: { profile: true } } } } },
    });
    if (!table || !table.active) return res.status(404).json({ error: 'Tafel niet gevonden' });
    res.json(table);
  });

  // Everything below is admin-only management.
  r.use(requireAdmin);

  r.get('/', async (_req, res) => {
    const list = await prisma.table.findMany({
      orderBy: [{ id: 'asc' }],
      include: { location: true, routeOverrides: { include: { fromScreen: true, toScreen: true } } },
    });
    res.json(list);
  });

  r.post('/', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const locationId = (req.body as any)?.locationId != null ? Number((req.body as any).locationId) : null;
    // code: provided, else slug of name, else random
    let attempts = 0;
    let table: any = null;
    while (attempts < 5) {
      const requested = String((req.body as any)?.code ?? '').trim().toUpperCase();
      const fallback = name.replace(/\s+/g, '').toUpperCase();
      const code = (requested || fallback || genCode()).slice(0, 12);
      try {
        table = await prisma.table.create({ data: { name, code, locationId } });
        break;
      } catch (e: any) {
        if (e?.code === 'P2002') { attempts++; continue; }
        throw e;
      }
    }
    if (!table) return res.status(409).json({ error: 'Code conflict, probeer opnieuw' });
    res.status(201).json(table);
  });

  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    if ((req.body as any)?.name !== undefined) data.name = String((req.body as any).name).trim();
    if ((req.body as any)?.code !== undefined) data.code = String((req.body as any).code).trim().toUpperCase();
    if ((req.body as any)?.locationId !== undefined) data.locationId = (req.body as any).locationId === '' ? null : Number((req.body as any).locationId);
    if ((req.body as any)?.active !== undefined) data.active = !!((req.body as any).active);
    res.json(await prisma.table.update({ where: { id }, data }));
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.table.update({ where: { id }, data: { active: false } });
    res.json({ ok: true });
  });

  r.delete('/:id/hard', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx: any) => {
      await tx.routeOverride.deleteMany({ where: { tableId: id } });
      const items = await tx.orderItem.findMany({ where: { order: { tableId: id } }, select: { id: true } });
      if (items.length) {
        await tx.orderItemChoice.deleteMany({ where: { orderItemId: { in: items.map((i: any) => i.id) } } });
        await tx.orderItem.deleteMany({ where: { id: { in: items.map((i: any) => i.id) } } });
      }
      await tx.payment.deleteMany({ where: { order: { tableId: id } } });
      await tx.order.deleteMany({ where: { tableId: id } });
      await tx.table.delete({ where: { id } });
    });
    res.json({ ok: true });
  });

  // ---------- Route overrides (per-table prep redirect) ----------
  r.post('/:id/route-override', async (req, res) => {
    const tableId = Number(req.params.id);
    const fromScreenId = Number((req.body as any)?.fromScreenId);
    const toScreenId = Number((req.body as any)?.toScreenId);
    if (!Number.isFinite(fromScreenId) || !Number.isFinite(toScreenId)) return res.status(400).json({ error: 'fromScreenId and toScreenId required' });
    const saved = await prisma.routeOverride.upsert({
      where: { tableId_fromScreenId: { tableId, fromScreenId } } as any,
      update: { toScreenId },
      create: { tableId, fromScreenId, toScreenId },
    });
    res.status(201).json(saved);
  });

  r.delete('/:id/route-override/:fromScreenId', async (req, res) => {
    const tableId = Number(req.params.id);
    const fromScreenId = Number(req.params.fromScreenId);
    await prisma.routeOverride.deleteMany({ where: { tableId_fromScreenId: { tableId, fromScreenId } } as any });
    res.json({ ok: true });
  });

  return r;
}
