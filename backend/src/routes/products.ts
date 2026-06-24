import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../db.js';
import { euroToCents } from '../util.js';
import { UPLOADS_DIR, ensureUploadsDir } from '../uploads.js';

export default function productsRouter() {
  const r = Router();

  // Full product tree, filtered to a profile's categories.
  // ?profileId=  -> single profile tree
  // (no profileId) -> default (first) profile
  r.get('/tree', async (req, res) => {
    const profileId = req.query.profileId ? Number(req.query.profileId) : undefined;
    const profile = profileId
      ? await prisma.profile.findUnique({ where: { id: profileId } })
      : await prisma.profile.findFirst({ orderBy: { id: 'asc' } });
    if (!profile) return res.json({ id: null, name: '', categories: [] });

    const cats = await prisma.category.findMany({
      where: { profileId: profile.id, active: true },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      include: {
        prepScreen: true,
        products: {
          where: { active: true },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          include: {
            prepScreen: true,
            variants: { orderBy: { id: 'asc' } },
            productMenus: { orderBy: { sort: 'asc' }, include: { menu: { include: { options: { orderBy: { sort: 'asc' } } } } } },
          },
        },
      },
    });
    res.json({ id: profile.id, name: profile.name, categories: cats });
  });

  // ---------- Categories ----------
  r.post('/categories', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    const profileId = Number((req.body as any)?.profileId);
    if (!name || !Number.isFinite(profileId)) return res.status(400).json({ error: 'name and profileId required' });
    const maxSort = await prisma.category.aggregate({ where: { profileId }, _max: { sort: true } });
    const created = await prisma.category.create({
      data: { name, profileId, sort: (maxSort._max.sort ?? -1) + 1, prepScreenId: (req.body as any)?.prepScreenId ?? null },
    });
    res.status(201).json(created);
  });

  r.patch('/categories/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    for (const k of ['name', 'active']) {
      if ((req.body as any)?.[k] !== undefined) data[k] = (req.body as any)[k];
    }
    for (const k of ['sort', 'prepScreenId']) {
      const v = (req.body as any)?.[k];
      if (v === undefined) continue;
      if (v === '' || v === null) data[k] = null;
      else data[k] = Number(v);
    }
    const updated = await prisma.category.update({ where: { id }, data });
    res.json(updated);
  });

  r.delete('/categories/:id', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.category.update({ where: { id }, data: { active: false } });
    res.json({ ok: true });
  });

  r.post('/categories/reorder', async (req, res) => {
    const ids: number[] = Array.isArray((req.body as any)?.ids) ? (req.body as any).ids.map(Number) : [];
    for (let i = 0; i < ids.length; i++) {
      await prisma.category.update({ where: { id: ids[i] }, data: { sort: i } });
    }
    res.json({ ok: true });
  });

  // ---------- Products ----------
  r.post('/', async (req, res) => {
    const name = String((req.body as any)?.name ?? '').trim();
    const categoryId = Number((req.body as any)?.categoryId);
    if (!name || !Number.isFinite(categoryId)) return res.status(400).json({ error: 'name and categoryId required' });
    const variantsIn = Array.isArray((req.body as any)?.variants) ? (req.body as any).variants : [];
    const maxSort = await prisma.product.aggregate({ where: { categoryId }, _max: { sort: true } });
    const created = await prisma.product.create({
      data: {
        name,
        categoryId,
        description: (req.body as any)?.description || null,
        imageUrl: (req.body as any)?.imageUrl || null,
        allergens: (req.body as any)?.allergens || null,
        prepScreenId: (req.body as any)?.prepScreenId ?? null,
        sort: (maxSort._max.sort ?? -1) + 1,
        variants: { create: variantsIn.map((v: any) => ({ name: String(v.name ?? '').trim(), priceCents: Number(v.priceCents ?? 0) })) },
      },
      include: { variants: true },
    });
    res.status(201).json(created);
  });

  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const data: any = {};
    for (const k of ['name', 'description', 'imageUrl', 'allergens']) {
      if ((req.body as any)?.[k] !== undefined) data[k] = (req.body as any)[k];
    }
    for (const k of ['active', 'largeCard', 'recommended']) {
      if ((req.body as any)?.[k] !== undefined) data[k] = !!(req.body as any)[k];
    }
    {
      const v = (req.body as any)?.prepScreenId;
      if (v !== undefined) data.prepScreenId = (v === '' || v === null) ? null : Number(v);
    }
    const updated = await prisma.product.update({ where: { id }, data });
    res.json(updated);
  });

  // ---------- Product image upload ----------
  // The frontend reads the chosen file as a base64 data URL and POSTs it here
  // (no multipart/multer dependency). We decode, write it under UPLOADS_DIR and
  // store the public /uploads/<file> path on the product.
  r.post('/:id/image', async (req, res) => {
    const id = Number(req.params.id);
    const dataUrl = String((req.body as any)?.dataUrl ?? '');
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'Ongeldige afbeelding' });
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Afbeelding te groot (max 5MB)' });

    const prod = await prisma.product.findUnique({ where: { id } });
    if (!prod) return res.status(404).json({ error: 'Product niet gevonden' });

    ensureUploadsDir();
    const fname = `prod-${id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
    // best-effort cleanup of the previous upload (ignore externally-hosted URLs)
    if (prod.imageUrl && prod.imageUrl.startsWith('/uploads/')) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(prod.imageUrl))); } catch { /* gone */ }
    }
    const updated = await prisma.product.update({ where: { id }, data: { imageUrl: `/uploads/${fname}` } });
    res.json(updated);
  });

  r.delete('/:id/image', async (req, res) => {
    const id = Number(req.params.id);
    const prod = await prisma.product.findUnique({ where: { id } });
    if (prod?.imageUrl && prod.imageUrl.startsWith('/uploads/')) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, path.basename(prod.imageUrl))); } catch { /* gone */ }
    }
    const updated = await prisma.product.update({ where: { id }, data: { imageUrl: null } });
    res.json(updated);
  });

  r.post('/:id/move', async (req, res) => {
    const id = Number(req.params.id);
    const toCategoryId = (req.body as any)?.toCategoryId != null ? Number((req.body as any).toCategoryId) : null;
    const toIndex = Math.max(0, Number((req.body as any)?.toIndex ?? 0));
    await prisma.$transaction(async (tx: any) => {
      const prod = await tx.product.findUnique({ where: { id } });
      if (!prod) throw new Error('not found');
      const fromCategoryId = prod.categoryId;
      if (toCategoryId && fromCategoryId !== toCategoryId) {
        // move to a different category: append at end (then reorder below)
        await tx.product.update({ where: { id }, data: { categoryId: toCategoryId, sort: 999999 } });
      }
      const targetCat = toCategoryId ?? fromCategoryId;
      const siblings = await tx.product.findMany({ where: { categoryId: targetCat, id: { not: id }, active: true }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
      const ordered = [...siblings.slice(0, toIndex), { id }, ...siblings.slice(toIndex)];
      for (let i = 0; i < ordered.length; i++) {
        await tx.product.update({ where: { id: ordered[i].id }, data: { sort: i } });
      }
    });
    res.json({ ok: true });
  });

  r.delete('/:id', async (req, res) => {
    const id = Number(req.params.id);
    await prisma.product.update({ where: { id }, data: { active: false } });
    res.json({ ok: true });
  });

  // ---------- Variants ----------
  r.post('/:id/variants', async (req, res) => {
    const id = Number(req.params.id);
    const name = String((req.body as any)?.name ?? '').trim();
    const cents = euroToCents((req.body as any)?.priceCents ?? (req.body as any)?.price ?? 0);
    if (Number.isNaN(cents)) return res.status(400).json({ error: 'invalid price' });
    const created = await prisma.variant.create({ data: { productId: id, name, priceCents: cents } });
    res.status(201).json(created);
  });

  r.patch('/variants/:variantId', async (req, res) => {
    const id = Number(req.params.variantId);
    const data: any = {};
    if ((req.body as any)?.name !== undefined) data.name = String((req.body as any).name).trim();
    if ((req.body as any)?.priceCents !== undefined) data.priceCents = Number((req.body as any).priceCents);
    if ((req.body as any)?.soldOut !== undefined) data.soldOut = !!((req.body as any).soldOut);
    const updated = await prisma.variant.update({ where: { id }, data });
    res.json(updated);
  });

  r.delete('/variants/:variantId', async (req, res) => {
    const id = Number(req.params.variantId);
    await prisma.variant.delete({ where: { id } });
    res.json({ ok: true });
  });

  return r;
}
