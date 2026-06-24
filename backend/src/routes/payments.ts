import { Router } from 'express';
import prisma from '../db.js';
import { io } from '../index.js';
import { createMolliePayment, checkMolliePayment, refundMolliePayment } from '../services/mollie.js';

export default function paymentsRouter() {
  const r = Router();

  // Create a payment for an order (customer chose "Online betalen").
  // Returns the Mollie checkout URL — the frontend redirects there.
  r.post('/create', async (req, res) => {
    const orderId = Number((req.body as any)?.orderId);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: 'orderId required' });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, location: true },
    });
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (['DELIVERED', 'DONE', 'CANCELLED'].includes(order.status)) {
      return res.status(409).json({ error: 'order is already closed' });
    }

    // Calculate total from item snapshots
    const totalCents = order.items.reduce((s: number, it: any) => s + (it.unitPriceCents || 0) * it.qty, 0);
    if (totalCents <= 0) return res.status(400).json({ error: 'order total is zero' });

    const description = `Bestelling #${order.id} — ${order.location?.name || 'Up t Gemak'}`;

    try {
      const { checkoutUrl, mollieId } = await createMolliePayment(orderId, totalCents, description);

      // Store the payment record
      await prisma.payment.upsert({
        where: { orderId },
        update: { providerId: mollieId, amountCents: totalCents, status: 'PENDING', provider: 'MOLLIE' },
        create: { orderId, provider: 'MOLLIE', providerId: mollieId, amountCents: totalCents, status: 'PENDING' },
      });

      // Mark the order as ONLINE payment
      await prisma.order.update({ where: { id: orderId }, data: { payMethod: 'ONLINE' } });

      res.json({ checkoutUrl, mollieId });
    } catch (e: any) {
      console.error('[payments] create failed:', e?.message);
      res.status(502).json({ error: 'Betaling kon niet worden gestart', detail: e?.message });
    }
  });

  // Mollie webhook — Mollie calls this when payment status changes.
  // No auth header (Mollie sends form-encoded body); we verify by fetching the payment.
  r.post('/webhook', async (req, res) => {
    const mollieId = (req.body as any)?.id;
    if (!mollieId) return res.status(400).json({ error: 'id required' });

    try {
      const { status, paid } = await checkMolliePayment(mollieId);

      if (paid) {
        // Find the order and emit socket event
        const payment = await prisma.payment.findFirst({ where: { providerId: mollieId } });
        if (payment?.orderId) {
          io.emit('paymentUpdated', { orderId: payment.orderId, status: 'PAID' });
        }
      }

      // Always 200 to Mollie so they don't retry
      res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error('[payments] webhook error:', e?.message);
      // Still 200 so Mollie doesn't hammer us — we'll poll on the client side
      res.status(200).json({ ok: false });
    }
  });

  // Check payment status (polled by the frontend after redirect back from Mollie)
  r.get('/status/:orderId', async (req, res) => {
    const orderId = Number(req.params.orderId);
    const payment = await prisma.payment.findUnique({ where: { orderId } });
    if (!payment) return res.json({ status: 'NONE' });

    // If PENDING and we have a Mollie ID, poll Mollie for the real status
    if (payment.status === 'PENDING' && payment.providerId) {
      try {
        const { status, paid } = await checkMolliePayment(payment.providerId);
        res.json({ status, paid, mollieId: payment.providerId });
        return;
      } catch {}
    }

    res.json({ status: payment.status, paid: payment.status === 'PAID' });
  });

  return r;
}
