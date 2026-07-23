import { Router } from 'express';
import prisma from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export default function choicesRouter() {
  const r = Router();
  r.use(requireAdmin);

  // ---------- Menus ----------
  r.get('/menus', async (_req, res) => {
    const list = await prisma.choiceMenu.findMany({
      orderBy: { id: 'asc' },
      include: { options: { orderBy: [{ sort: 'asc' }, { id: 'asc' }] } },
    });
    res.json(list);
  });

  r.post('/menus', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const created = await prisma.choiceMenu.create({
      data: { name, requireOne: !!((req.body as any)?.requireOne), allowMultiple: !!((req.body as any)?.allowMultiple), appendToEnd: !!((req.body as any)?.appendToEnd) },
    });
    res.status(201).json(created);
  });

  r.patch('/menus/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    for (const k of ['name', 'requireOne', 'allowMultiple', 'appendToEnd']) {
      if ((req.body as any)?.[k] !== undefined) data[k] = (req.body as any)[k];
    }
    res.json(await prisma.choiceMenu.update({ where: { id }, data }));
  });

  r.delete('/menus/:id', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx: any) => {
      await tx.productChoiceMenu.deleteMany({ where: { menuId: id } });
      await tx.choiceOption.deleteMany({ where: { menuId: id } });
      await tx.choiceMenu.delete({ where: { id } });
    });
    res.json({ ok: true });
  });

  // ---------- Options ----------
  r.post('/menus/:id/options', async (req, res) => {
    const menuId = Number(req.params.id);
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const priceCents = Math.max(0, Number((req.body as any)?.priceCents ?? 0));
    const maxSort = await prisma.choiceOption.aggregate({ where: { menuId }, _max: { sort: true } });
    const created = await prisma.choiceOption.create({ data: { menuId, name, priceCents, sort: (maxSort._max.sort ?? -1) + 1 } });
    res.status(201).json(created);
  });

  r.patch('/options/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    for (const k of ['name', 'priceCents', 'sort']) {
      if ((req.body as any)?.[k] !== undefined) data[k] = (req.body as any)[k];
    }
    res.json(await prisma.choiceOption.update({ where: { id }, data }));
  });

  r.delete('/options/:id', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.choiceOption.delete({ where: { id } });
    res.json({ ok: true });
  });

  r.post('/menus/:id/options/reorder', async (req, res) => {
    const ids: number[] = Array.isArray((req.body as any)?.idsInOrder) ? (req.body as any).idsInOrder.map(Number) : [];
    for (let i = 0; i < ids.length; i++) await prisma.choiceOption.update({ where: { id: ids[i] }, data: { sort: i } });
    res.json({ ok: true });
  });

  // ---------- Attach / detach / reorder (menu <-> product) ----------
  r.post('/attach', async (req, res) => {
    const productId = Number((req.body as any)?.productId);
    const menuId = Number((req.body as any)?.menuId);
    const index = (req.body as any)?.index != null ? Number((req.body as any).index) : null;
    if (!Number.isFinite(productId) || !Number.isFinite(menuId)) return res.status(400).json({ error: 'productId and menuId required' });
    const maxSort = await prisma.productChoiceMenu.aggregate({ where: { productId }, _max: { sort: true } });
    await prisma.productChoiceMenu.upsert({
      where: { productId_menuId: { productId, menuId } } as any,
      update: {},
      create: { productId, menuId, sort: (maxSort._max.sort ?? -1) + 1 },
    });
    if (index != null) {
      const all = await prisma.productChoiceMenu.findMany({ where: { productId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      const target = all.find((x) => x.menuId === menuId);
      if (target) {
        const without = all.filter((x) => x.menuId !== menuId);
        const ordered = [...without.slice(0, index), target, ...without.slice(index)];
        for (let i = 0; i < ordered.length; i++) await prisma.productChoiceMenu.update({ where: { id: ordered[i].id }, data: { sort: i } });
      }
    }
    const refreshed = await prisma.product.findUnique({
      where: { id: productId },
      include: { productMenus: { orderBy: { sort: 'asc' }, include: { menu: true } } },
    });
    res.json(refreshed?.productMenus || []);
  });

  r.post('/detach', async (req, res) => {
    const productId = Number((req.body as any)?.productId);
    const menuId = Number((req.body as any)?.menuId);
    await prisma.productChoiceMenu.deleteMany({ where: { productId_menuId: { productId, menuId } } as any });
    const all = await prisma.productChoiceMenu.findMany({ where: { productId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    for (let i = 0; i < all.length; i++) await prisma.productChoiceMenu.update({ where: { id: all[i].id }, data: { sort: i } });
    res.json({ ok: true });
  });

  r.post('/reorder', async (req, res) => {
    const productId = Number((req.body as any)?.productId);
    const menuIds: number[] = Array.isArray((req.body as any)?.menuIdsInOrder) ? (req.body as any).menuIdsInOrder.map(Number) : [];
    for (let i = 0; i < menuIds.length; i++) {
      await prisma.productChoiceMenu.updateMany({ where: { productId, menuId: menuIds[i] }, data: { sort: i } });
    }
    res.json({ ok: true });
  });

  return r;
}
