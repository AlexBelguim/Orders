import { Router } from 'express';
import prisma from '../db.js';

export default function profilesRouter() {
  const r = Router();

  r.get('/', async (_req, res) => {
    const list = await prisma.profile.findMany({ orderBy: { id: 'asc' }, include: { categories: { orderBy: { sort: 'asc' } } } });
    res.json(list);
  });

  r.post('/', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const created = await prisma.profile.create({ data: { name } });
    res.status(201).json(created);
  });

  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const name = (req.body as any)?.name != null ? String((req.body as any).name).trim() : undefined;
    const updated = await prisma.profile.update({ where: { id }, data: { name } });
    res.json(updated);
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    // Clear references before delete (categories will need reassignment — admin should reassign first).
    await prisma.locationProfile.deleteMany({ where: { profileId: id } });
    await prisma.profile.delete({ where: { id } });
    res.json({ ok: true });
  });

  return r;
}
