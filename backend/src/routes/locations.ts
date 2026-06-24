import { Router } from 'express';
import prisma from '../db.js';
import { genCode, slugify, uniqueSlug } from '../util.js';

export default function locationsRouter() {
  const r = Router();

  r.get('/', async (_req, res) => {
    const list = await prisma.location.findMany({
      orderBy: [{ id: 'asc' }],
      include: {
        prepScreen: true,
        tables: { orderBy: { id: 'asc' } },
        allowedProfiles: { include: { profile: true } },
        excludedCategories: { include: { category: true } },
        excludedProducts: { include: { product: true } },
        commissionOverrides: true,
      },
    });
    res.json(list);
  });

  r.get('/code/:code', async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const loc = await prisma.location.findUnique({
      where: { code },
      include: {
        prepScreen: true,
        allowedProfiles: { include: { profile: true } },
        excludedCategories: true,
        excludedProducts: true,
      },
    });
    if (!loc) return res.status(404).json({ error: 'Locatie niet gevonden' });
    res.json(loc);
  });

  r.post('/', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const kind = (req.body as any)?.kind === 'EAT_IN' ? 'EAT_IN' : 'DELIVERY';
    // generate a unique uppercase code
    let code = '';
    for (let i = 0; i < 5; i++) {
      const candidate = slugify(name).slice(0, 6).toUpperCase() || genCode();
      const exists = await prisma.location.findUnique({ where: { code: candidate } });
      if (!exists) { code = candidate; break; }
    }
    if (!code) code = genCode();
    const created = await prisma.location.create({
      data: {
        name,
        code,
        kind,
        deliveryNote: (req.body as any)?.deliveryNote || null,
        deliveryEtaMin: (req.body as any)?.deliveryEtaMin ?? null,
        minOrderCents: (req.body as any)?.minOrderCents ?? null,
        openFrom: (req.body as any)?.openFrom || null,
        openUntil: (req.body as any)?.openUntil || null,
        prepScreenId: (req.body as any)?.prepScreenId ?? null,
      },
    });
    res.status(201).json(created);
  });

  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    for (const k of ['name', 'kind', 'deliveryNote', 'openFrom', 'openUntil']) {
      if ((req.body as any)?.[k] !== undefined) data[k] = (req.body as any)[k];
    }
    // Numeric / nullable numeric fields: coerce strings → number, '' → null.
    for (const k of ['deliveryEtaMin', 'minOrderCents', 'prepScreenId', 'coordinatorScreenId']) {
      const v = (req.body as any)?.[k];
      if (v === undefined) continue;
      if (v === '' || v === null) data[k] = null;
      else data[k] = Number(v);
    }
    res.json(await prisma.location.update({ where: { id }, data }));
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.location.delete({ where: { id } });
    res.json({ ok: true });
  });

  // Replace the set of allowed profiles for a location.
  r.put('/:id/allowed-profiles', async (req, res) => {
    const id = Number(req.params.id);
    const profileIds: number[] = Array.isArray((req.body as any)?.profileIds) ? (req.body as any).profileIds.map(Number) : [];
    await prisma.$transaction(async (tx: any) => {
      await tx.locationProfile.deleteMany({ where: { locationId: id } });
      if (profileIds.length) {
        await tx.locationProfile.createMany({ data: profileIds.map((profileId) => ({ locationId: id, profileId })) });
      }
    });
    const refreshed = await prisma.location.findUnique({ where: { id }, include: { allowedProfiles: { include: { profile: true } } } });
    res.json(refreshed?.allowedProfiles || []);
  });

  // Toggle category exclusion (POST adds, DELETE removes).
  r.post('/:id/exclude-category/:catId', async (req, res) => {
    const locationId = Number(req.params.id); const categoryId = Number(req.params.catId);
    await prisma.locationCategoryExclusion.upsert({ where: { locationId_categoryId: { locationId, categoryId } } as any, update: {}, create: { locationId, categoryId } });
    res.json({ ok: true });
  });
  r.delete('/:id/exclude-category/:catId', async (req, res) => {
    const locationId = Number(req.params.id); const categoryId = Number(req.params.catId);
    await prisma.locationCategoryExclusion.deleteMany({ where: { locationId_categoryId: { locationId, categoryId } } as any });
    res.json({ ok: true });
  });

  r.post('/:id/exclude-product/:prodId', async (req, res) => {
    const locationId = Number(req.params.id); const productId = Number(req.params.prodId);
    await prisma.locationProductExclusion.upsert({ where: { locationId_productId: { locationId, productId } } as any, update: {}, create: { locationId, productId } });
    res.json({ ok: true });
  });
  r.delete('/:id/exclude-product/:prodId', async (req, res) => {
    const locationId = Number(req.params.id); const productId = Number(req.params.prodId);
    await prisma.locationProductExclusion.deleteMany({ where: { locationId_productId: { locationId, productId } } as any });
    res.json({ ok: true });
  });

  // ---------- Commission overrides ----------
  r.get('/:id/commission', async (req, res) => {
    const locationId = Number(req.params.id);
    const list = await prisma.commissionOverride.findMany({ where: { locationId } });
    res.json(list);
  });

  // Upsert one commission override. body: { scope: CATEGORY|PRODUCT, targetId, fixedCents }
  r.put('/:id/commission', async (req, res) => {
    const locationId = Number(req.params.id);
    const scope = String((req.body as any)?.scope ?? '').toUpperCase() === 'CATEGORY' ? 'CATEGORY' : 'PRODUCT';
    const targetId = Number((req.body as any)?.targetId);
    const fixedCents = Math.max(0, Number((req.body as any)?.fixedCents ?? 0));
    if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'targetId required' });
    const saved = await prisma.commissionOverride.upsert({
      where: { locationId_scope_targetId: { locationId, scope, targetId } } as any,
      update: { fixedCents },
      create: { locationId, scope, targetId, fixedCents },
    });
    res.json(saved);
  });

  r.delete('/:id/commission/:scope/:targetId', async (req, res) => {
    const locationId = Number(req.params.id);
    const scope = String(req.params.scope).toUpperCase() === 'CATEGORY' ? 'CATEGORY' : 'PRODUCT';
    const targetId = Number(req.params.targetId);
    await prisma.commissionOverride.deleteMany({ where: { locationId_scope_targetId: { locationId, scope, targetId } } as any });
    res.json({ ok: true });
  });

  return r;
}
