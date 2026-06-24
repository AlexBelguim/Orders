import { Router } from 'express';
import prisma from '../db.js';

export default function statsRouter() {
  const r = Router();

  // Aggregated sales + commission. ?locationId=&date=YYYY-MM-DD | &from=&to=
  // Only counts terminal orders (DELIVERED, DONE).
  r.get('/', async (req, res) => {
    const locationId = req.query.locationId ? Number(req.query.locationId) : undefined;
    const where: any = { status: { in: ['DELIVERED', 'DONE'] } };
    if (locationId) where.locationId = locationId;

    if (req.query.date) {
      // Parse as a local calendar date (YYYY-MM-DD) to avoid UTC off-by-one.
      const parts = String(req.query.date).split('-').map(Number);
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        const start = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
        const end = new Date(parts[0], parts[1] - 1, parts[2] + 1, 0, 0, 0, 0);
        where.createdAt = { gte: start, lt: end };
      }
    } else if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) { const p = String(req.query.from).split('-').map(Number); const f = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0); where.createdAt.gte = f; }
      if (req.query.to) { const p = String(req.query.to).split('-').map(Number); const t = new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999); where.createdAt.lte = t; }
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: { include: { variant: { include: { product: { include: { category: true } } } } } } },
    });

    type Row = { product: string; category?: string; qty: number; unitCents: number; totalCents: number; commissionCents: number };
    const map = new Map<string, Row>();
    let grand = 0, grandCommission = 0;
    for (const o of orders) {
      for (const it of o.items) {
        const productName = it.variant?.product?.name || 'Onbekend';
        const categoryName = it.variant?.product?.category?.name;
        const key = `${productName}__${categoryName || ''}__${it.variantId}`;
        const rec = map.get(key) || { product: productName, category: categoryName, qty: 0, unitCents: it.unitPriceCents, totalCents: 0, commissionCents: 0 };
        rec.qty += it.qty;
        rec.totalCents += it.unitPriceCents * it.qty;
        rec.commissionCents += (it.commissionCents || 0) * it.qty;
        map.set(key, rec);
        grand += it.unitPriceCents * it.qty;
        grandCommission += (it.commissionCents || 0) * it.qty;
      }
    }

    const items = Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents);
    res.json({
      orderCount: orders.length,
      grandTotalCents: grand,
      grandCommissionCents: grandCommission,
      netCents: grand - grandCommission,
      items,
    });
  });

  return r;
}
