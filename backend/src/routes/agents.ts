import { Router } from 'express';
import prisma from '../db.js';
import { genCode } from '../util.js';

export default function agentsRouter() {
  const r = Router();

  r.get('/', async (_req, res) => {
    const list = await prisma.deliveryAgent.findMany({
      orderBy: { id: 'asc' },
      include: { assignments: { where: { status: { in: ['ASSIGNED', 'PICKED_UP'] } }, include: { order: { include: { location: true } } } } },
    });
    res.json(list);
  });

  r.post('/', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const phone = (req.body as any)?.phone ? String((req.body as any).phone).trim() : null;
    // unique code
    let code = '';
    for (let i = 0; i < 5; i++) {
      const candidate = genCode();
      const exists = await prisma.deliveryAgent.findUnique({ where: { code: candidate } });
      if (!exists) { code = candidate; break; }
    }
    if (!code) code = genCode() + Date.now().toString(36);
    const created = await prisma.deliveryAgent.create({ data: { name, phone, code } });
    res.status(201).json(created);
  });

  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    if ((req.body as any)?.name != null) data.name = String((req.body as any).name).trim();
    if ((req.body as any)?.phone != null) data.phone = String((req.body as any).phone).trim() || null;
    if ((req.body as any)?.code != null) {
      const c = String((req.body as any).code).trim();
      if (c) data.code = c;
    }
    if ((req.body as any)?.active != null) data.active = !!((req.body as any).active);
    res.json(await prisma.deliveryAgent.update({ where: { id }, data }));
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    // Detach from active assignments first
    await prisma.deliveryAssignment.updateMany({ where: { agentId: id, status: 'ASSIGNED' }, data: { status: 'DELIVERED' } });
    await prisma.deliveryAgent.delete({ where: { id } });
    res.json({ ok: true });
  });

  return r;
}
