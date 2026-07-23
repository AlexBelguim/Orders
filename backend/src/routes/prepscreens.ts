import { Router } from 'express';
import prisma from '../db.js';
import { io } from '../index.js';
import { slugify, uniqueSlug } from '../util.js';
import { requireAdmin } from '../middleware/auth.js';

// The subset of a screen that customer pages may see (order page banner /
// greyed items). No slugs or admin flags — just what the pause UI needs.
const pausePublic = (s: any) => ({
  id: s.id,
  name: s.name,
  pauseFrom: s.pauseFrom,
  pauseUntil: s.pauseUntil,
  pauseMessage: s.pauseMessage,
  pauseOverridePaused: s.pauseOverridePaused,
  pauseOverrideUntil: s.pauseOverrideUntil,
});

export default function prepScreensRouter() {
  const r = Router();
  r.use(requireAdmin);

  r.get('/', async (_req, res) => {
    const list = await prisma.prepScreen.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    res.json(list);
  });

  r.post('/', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const isTakeaway = !!((req.body as any)?.isTakeaway);
    const existing = (await prisma.prepScreen.findMany({ select: { slug: true } })).map((s) => s.slug);
    const slug = uniqueSlug(slugify(name), existing);
    const created = await prisma.prepScreen.create({ data: { name, slug, isTakeaway, sort: (req.body as any)?.sort ?? 0 } });
    res.status(201).json(created);
  });

  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    if ((req.body as any)?.name != null) data.name = String((req.body as any).name).trim();
    if ((req.body as any)?.isTakeaway != null) data.isTakeaway = !!((req.body as any).isTakeaway);
    if ((req.body as any)?.quickMode != null) data.quickMode = !!((req.body as any).quickMode);
    if ((req.body as any)?.sort != null) data.sort = Number((req.body as any).sort);
    // Rush pause: schedule window + message ('' clears), manual override.
    for (const k of ['pauseFrom', 'pauseUntil', 'pauseMessage'] as const) {
      const v = (req.body as any)?.[k];
      if (v !== undefined) data[k] = v === '' || v === null ? null : String(v);
    }
    if ((req.body as any)?.pauseOverridePaused !== undefined) data.pauseOverridePaused = !!((req.body as any).pauseOverridePaused);
    if ((req.body as any)?.pauseOverrideUntil !== undefined) {
      const v = (req.body as any).pauseOverrideUntil;
      data.pauseOverrideUntil = v ? new Date(v) : null;
      if (data.pauseOverrideUntil && Number.isNaN(data.pauseOverrideUntil.getTime())) return res.status(400).json({ error: 'Ongeldige tijd' });
    }
    const updated = await prisma.prepScreen.update({ where: { id }, data });
    // Let open order pages + prep screens react without a reload.
    io.emit('screenUpdated', pausePublic(updated));
    res.json(updated);
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    // Detach from routing references first.
    await prisma.category.updateMany({ where: { prepScreenId: id }, data: { prepScreenId: null } });
    await prisma.product.updateMany({ where: { prepScreenId: id }, data: { prepScreenId: null } });
    await prisma.location.updateMany({ where: { prepScreenId: id }, data: { prepScreenId: null } });
    await prisma.routeOverride.deleteMany({ where: { OR: [{ fromScreenId: id }, { toScreenId: id }] } });
    await prisma.prepScreen.delete({ where: { id } });
    res.json({ ok: true });
  });

  return r;
}
