import { Router } from 'express';
import prisma from '../db.js';
import { io } from '../index.js';
import { resolvePrepScreen, resolveCommissionCents } from '../services/routing.js';
import { sendOrderConfirmationEmail } from '../services/email.js';
import { nanoid } from 'nanoid';
import type { OrderItemInput } from '../services/routing.js';

const CANCEL_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export default function ordersRouter() {
  const r = Router();

  // Create an order (from /t/:code eat-in or /l/:code delivery).
  r.post('/', async (req, res) => {
    const body = req.body as any;
    const tableCode = body.tableCode ? String(body.tableCode).toUpperCase() : undefined;
    const locationCode = body.locationCode ? String(body.locationCode).toUpperCase() : undefined;
    const itemsIn: OrderItemInput[] = Array.isArray(body.items) ? body.items : [];
    if (!itemsIn.length) return res.status(400).json({ error: 'Lege bestelling' });

    let table: any = null;
    let location: any = null;

    if (tableCode) {
      table = await prisma.table.findUnique({ where: { code: tableCode }, include: { location: true } });
      if (!table || !table.active) return res.status(404).json({ error: 'Tafel niet gevonden' });
      location = table.location;
      // eat-in table may have no location — that's fine; treat as standalone eat-in.
    } else if (locationCode) {
      location = await prisma.location.findUnique({ where: { code: locationCode } });
      if (!location) return res.status(404).json({ error: 'Locatie niet gevonden' });
    }
    // For eat-in (table with location), determine kind; for table without location default to EAT_IN.
    const isDelivery = location ? location.kind === 'DELIVERY' : false;
    if (!table && !location) return res.status(400).json({ error: 'Geen locatie of tafel opgegeven' });
    if (isDelivery && !String(body.customerName || '').trim()) return res.status(400).json({ error: 'Naam verplicht' });
    if (isDelivery && !String(body.customerPhone || '').trim()) return res.status(400).json({ error: 'Telefoonnummer verplicht' });

    // Build items with resolved prep screen + commission snapshots.
    const itemCreates: any[] = [];
    for (const it of itemsIn) {
      const variant = await prisma.variant.findUnique({ where: { id: it.variantId }, include: { product: { include: { category: true } } } });
      if (!variant) continue;
      const unitPrice = variant.priceCents + (it.choices || []).reduce((s, c) => s + Number(c.priceCents || 0), 0);
      const prepScreenId = await resolvePrepScreen({ variantId: it.variantId, locationId: location?.id ?? 0, tableId: table?.id ?? null });
      const commissionCents = location ? await resolveCommissionCents({ variantId: it.variantId, locationId: location.id }) : 0;
      itemCreates.push({
        variantId: it.variantId,
        qty: Math.max(1, Number(it.qty) || 1),
        lineNote: it.note || null,
        unitPriceCents: unitPrice,
        commissionCents,
        prepScreenId,
        choices: it.choices && it.choices.length ? {
          create: it.choices.map((c: any) => ({
            menuName: String(c.menuName),
            optionName: c.optionName ?? null,
            priceCents: Number(c.priceCents || 0),
            appendToEnd: !!c.appendToEnd,
          })),
        } : undefined,
      });
    }
    if (!itemCreates.length) return res.status(400).json({ error: 'Geen geldige items' });

    const deliveryMode = isDelivery ? (body.deliveryMode === 'TAKEAWAY' ? 'TAKEAWAY' : 'DELIVERY') : 'EAT_IN';
    const payMethod = isDelivery ? (body.payMethod === 'ONLINE' ? 'ONLINE' : 'ON_DELIVERY') : 'NONE';

    const order = await prisma.order.create({
      data: {
        cancelToken: nanoid(24),
        deliveryMode,
        payMethod,
        note: body.note || null,
        locationId: location?.id ?? null,
        tableId: table?.id ?? null,
        tableLabel: isDelivery ? (body.tableLabel || null) : null,
        customerName: body.customerName || null,
        customerEmail: body.customerEmail || null,
        customerPhone: body.customerPhone || null,
        items: { create: itemCreates },
      },
      include: {
        items: { include: { choices: true, variant: { include: { product: { include: { category: true } } } }, prepScreen: true } },
        location: true,
        table: true,
        assignment: { include: { agent: true } },
      },
    });

    io.emit('newOrder', order);

    // Email (delivery only, if address present).
    if (isDelivery && order.customerEmail) {
      const lines = order.items.map((it: any) => {
        const label = it.variant?.product?.name + (it.variant?.name ? ` ${it.variant.name}` : '');
        const choices = (it.choices || []).filter((c: any) => !c.appendToEnd).map((c: any) => `${c.menuName}: ${c.optionName || 'geen'}`);
        return { label, qty: it.qty, choices };
      });
      sendOrderConfirmationEmail({
        to: order.customerEmail,
        order: { id: order.id, cancelToken: order.cancelToken, tableLabel: order.tableLabel, note: order.note, locationName: location.name, payMethod },
        lines,
      }).catch((e) => console.error('[email] confirmation failed', e));
    }

    res.status(201).json(order);
  });

  // List orders. ?status=ALL&locationId=&prepScreenId=&tableId=
  r.get('/', async (req, res) => {
    const status = String(req.query.status || 'ALL');
    const where: any = {};
    if (status !== 'ALL') where.status = status;
    if (req.query.locationId) where.locationId = Number(req.query.locationId);
    if (req.query.tableId) where.tableId = Number(req.query.tableId);
    if (req.query.prepScreenId) where.items = { some: { prepScreenId: Number(req.query.prepScreenId) } };
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        location: true, table: true, payment: true,
        assignment: { include: { agent: true } },
        items: { include: { choices: true, variant: { include: { product: { include: { category: true } } } }, prepScreen: true } },
      },
    });
    res.json(orders);
  });

  // Change status of an order.
  r.post('/:id/status', async (req, res) => {
    const id = Number(req.params.id);
    const status = String((req.body as any)?.status ?? '').toUpperCase();
    const allowed = ['NEW', 'IN_PREP', 'READY', 'BUSY', 'ON_THE_WAY', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'DONE', 'CANCELLED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const data: any = { status };
    const terminal = ['DELIVERED', 'DONE', 'CANCELLED'].includes(status);
    if (terminal) data.closedAt = new Date();
    if (status === 'CANCELLED') data.cancelledAt = new Date();
    // On any terminal status, release the bezorger so their phone stops showing this order.
    if (terminal) data.assignedAgentId = null;
    const order = await prisma.order.update({ where: { id }, data, include: { location: true, table: true } });
    if (terminal) {
      await prisma.deliveryAssignment.updateMany({
        where: { orderId: id, status: { in: ['ASSIGNED', 'PICKED_UP'] } },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      }).catch(() => {});
    }
    io.emit('orderUpdated', { orderId: id, status });
    if (terminal) io.emit('dispatchUpdated', { orderId: id, agentId: null });
    res.json(order);
  });

  // Per-item prep status (persistent, shared across screens/devices).
  r.post('/:orderId/items/:itemId/status', async (req, res) => {
    const orderId = Number(req.params.orderId);
    const itemId = Number(req.params.itemId);
    const status = String((req.body as any)?.status ?? '').toUpperCase();
    const allowed = ['PENDING', 'PREPARING', 'READY', 'DONE'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid item status' });
    const data: any = { itemStatus: status };
    if (status === 'DONE') data.itemDoneAt = new Date();
    const item = await prisma.orderItem.update({ where: { id: itemId, orderId }, data });
    io.emit('itemUpdated', { orderId, itemId, status });
    res.json(item);
  });

  // Per-item prepared toggle is client-side only (preserves manual screen layout).
  // But order-level status is server-side and broadcast.

  // Customer tracking page: get order by cancel token.
  r.get('/by-token/:token', async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { cancelToken: req.params.token },
      include: {
        location: true, table: true, payment: true,
        items: { include: { choices: true, variant: { include: { product: true } } } },
      },
    });
    if (!order) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    res.json(order);
  });

  // Cancel within 2 minutes.
  r.post('/by-token/:token/cancel', async (req, res) => {
    const order = await prisma.order.findUnique({ where: { cancelToken: req.params.token }, include: { payment: true } });
    if (!order) return res.status(404).json({ error: 'Bestelling niet gevonden' });
    if (['DONE', 'DELIVERED', 'CANCELLED'].includes(order.status)) {
      return res.status(409).json({ error: 'already terminal' });
    }
    const elapsed = Date.now() - order.createdAt.getTime();
    if (elapsed > CANCEL_WINDOW_MS) return res.status(410).json({ error: 'cancel window expired' });
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', closedAt: new Date(), cancelledAt: new Date() },
    });
    io.emit('orderUpdated', { orderId: order.id, status: 'CANCELLED' });
    // If the order was paid online, trigger a Mollie refund.
    if (order.payment?.status === 'PAID' && order.payment?.providerId) {
      try {
        const { refundMolliePayment } = await import('../services/mollie.js');
        await refundMolliePayment(order.payment.providerId);
        console.log(`[payments] refund triggered for order #${order.id}`);
      } catch (e) { console.error('[payments] refund failed:', e); }
    }
    res.json({ ok: true, order: updated });
  });

  return r;
}
