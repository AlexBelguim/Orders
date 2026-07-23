import { Router } from 'express';
import prisma from '../db.js';
import { io } from '../index.js';
import { testEmailConnection } from '../services/email.js';
import { requireAdmin } from '../middleware/auth.js';

// Order/dispatch tables that hold transactional sales data, in a safe
// delete order (children before parents). Product/menu tables are NOT
// touched, so the catalogue stays intact.
const SALES_TABLES = [
  'PositionPing',
  'OrderItemChoice',
  'OrderItem',
  'Payment',
  'DeliveryAssignment',
  'Order',
] as const;

export default function settingsRouter() {
  const r = Router();

  // Get one or many settings. ?keys=PUBLIC_URL,ACCESS_CODE or no keys → all.
  // Admin-only: full listing includes SMTP/Mollie secrets.
  r.get('/', requireAdmin, async (req, res) => {
    const keys = (req.query.keys as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean);
    const rows = await prisma.setting.findMany(keys && keys.length ? { where: { key: { in: keys } } } : undefined);
    const obj: Record<string, string> = {};
    rows.forEach((row: any) => { obj[row.key] = row.value; });
    res.json(obj);
  });

  // Upsert a single key/value.
  r.put('/:key', requireAdmin, async (req, res) => {
    const key = String(req.params.key);
    const value = String((req.body as any)?.value ?? '');
    const saved = await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    res.json(saved);
  });

  // Bulk upsert (array of {key,value} or an object).
  r.put('/', requireAdmin, async (req, res) => {
    const body = req.body as any;
    const entries: { key: string; value: string }[] = Array.isArray(body)
      ? body.map((e: any) => ({ key: String(e.key), value: String(e.value ?? '') }))
      : Object.entries(body || {}).map(([key, value]) => ({ key, value: String(value ?? '') }));
    for (const e of entries) {
      await prisma.setting.upsert({ where: { key: e.key }, update: { value: e.value }, create: { key: e.key, value: e.value } });
    }
    res.json({ ok: true, count: entries.length });
  });

  // Test SMTP connection.
  r.post('/test-email', requireAdmin, async (_req, res) => {
    try {
      const ok = await testEmailConnection();
      res.json({ ok });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'unknown error' });
    }
  });

  // Check the admin access code (POST { code }).
  r.post('/verify-code', async (req, res) => {
    const code = String((req.body as any)?.code ?? '');
    const row = await prisma.setting.findUnique({ where: { key: 'ACCESS_CODE' } });
    const expected = row?.value || 'thisdudestinky';
    res.json({ ok: code === expected });
  });

  // Sold-out variant ids (broadcast so screens + customer pages update).
  r.get('/sold-out', async (_req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: 'SOLD_OUT_VARIANT_IDS' } });
    let ids: number[] = [];
    try { const v = row?.value ? JSON.parse(row.value) : []; ids = Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []; } catch {}
    res.json({ variantIds: ids });
  });

  r.put('/sold-out', requireAdmin, async (req, res) => {
    const ids = Array.isArray((req.body as any)?.variantIds) ? (req.body as any).variantIds.map(Number).filter(Number.isFinite) : [];
    await prisma.setting.upsert({ where: { key: 'SOLD_OUT_VARIANT_IDS' }, update: { value: JSON.stringify(ids) }, create: { key: 'SOLD_OUT_VARIANT_IDS', value: JSON.stringify(ids) } });
    io.emit('soldOutUpdated', ids);
    res.json({ variantIds: ids });
  });

  // Wipe all orders, items, payments, assignments and GPS pings.
  // Products, menus, locations, tables, agents, screens and settings are kept.
  // Guarded by a typed confirmation string the UI must send ("DELETE-ALL-ORDERS").
  r.post('/clear-orders', requireAdmin, async (req, res) => {
    const confirm = String((req.body as any)?.confirm ?? '');
    if (confirm !== 'DELETE-ALL-ORDERS') {
      return res.status(400).json({ error: 'Bevestiging ontbreekt of is onjuist.' });
    }
    // Delete in dependency order inside one transaction.
    const results = await prisma.$transaction(
      SALES_TABLES.map((model) => (prisma as any)[model].deleteMany({})),
    );
    const deleted: Record<string, number> = {};
    SALES_TABLES.forEach((model, i) => { deleted[model] = results[i].count; });
    io.emit('ordersCleared', {});
    res.json({ ok: true, deleted });
  });

  return r;
}
