import { Router } from 'express';
import QRCode from 'qrcode';
import prisma from '../db.js';
import { io } from '../index.js';
import { createMolliePayment, checkMolliePayment, refundMolliePayment } from '../services/mollie.js';
import { sendPaymentLinkEmail } from '../services/email.js';

// Shared by /create (customer's own checkout) and /resend (rider/staff
// triggering a link for a customer who can't pay cash at the door).
async function startPayment(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, location: true },
  });
  if (!order) throw Object.assign(new Error('order not found'), { status: 404 });
  if (['DELIVERED', 'DONE', 'CANCELLED'].includes(order.status)) {
    throw Object.assign(new Error('order is already closed'), { status: 409 });
  }

  const totalCents = order.items.reduce((s: number, it: any) => s + (it.unitPriceCents || 0) * it.qty, 0);
  if (totalCents <= 0) throw Object.assign(new Error('order total is zero'), { status: 400 });

  const description = `Bestelling #${order.id} — ${order.location?.name || 'Up t Gemak'}`;
  const { checkoutUrl, mollieId } = await createMolliePayment(orderId, totalCents, description);

  await prisma.payment.upsert({
    where: { orderId },
    update: { providerId: mollieId, amountCents: totalCents, status: 'PENDING', provider: 'MOLLIE' },
    create: { orderId, provider: 'MOLLIE', providerId: mollieId, amountCents: totalCents, status: 'PENDING' },
  });
  await prisma.order.update({ where: { id: orderId }, data: { payMethod: 'ONLINE' } });

  return { order, checkoutUrl, mollieId };
}

export default function paymentsRouter() {
  const r = Router();

  // Create a payment for an order (customer chose "Online betalen").
  // Returns the Mollie checkout URL — the frontend redirects there.
  r.post('/create', async (req, res) => {
    const orderId = Number((req.body as any)?.orderId);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: 'orderId required' });
    try {
      const { checkoutUrl, mollieId } = await startPayment(orderId);
      res.json({ checkoutUrl, mollieId });
    } catch (e: any) {
      console.error('[payments] create failed:', e?.message);
      // This is the customer's own checkout: the order was created seconds ago
      // and is now unpayable (Mollie down, onboarding incomplete, bad key...).
      // Roll it back so the kitchen never starts on an order nobody was asked
      // to pay for. The customer keeps their cart and re-orders as "bij
      // levering", which places a fresh order. Only NEW, unpaid orders are
      // touched — /resend deliberately does not go through here.
      try {
        const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
        if (order && order.status === 'NEW' && order.payment?.status !== 'PAID') {
          await prisma.order.update({
            where: { id: orderId },
            data: { status: 'CANCELLED', cancelledAt: new Date(), closedAt: new Date() },
          });
          io.emit('orderUpdated', { orderId, status: 'CANCELLED' });
          console.warn(`[payments] order #${orderId} cancelled — payment could not be started`);
        }
      } catch (rollbackErr: any) {
        console.error('[payments] rollback failed for order', orderId, rollbackErr?.message);
      }
      res.status(e?.status || 502).json({ error: e?.status ? e.message : 'Betaling kon niet worden gestart', detail: e?.message });
    }
  });

  // Public: delivery rider (or dispatch staff) triggers this when a customer
  // can't pay cash at the door. Creates a fresh payment link, shows it as a
  // QR code the rider can hold up right there, and emails it too if the
  // customer left an address (optional on the order, so can't rely on it alone).
  r.post('/resend/:orderId', async (req, res) => {
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(orderId)) return res.status(400).json({ error: 'invalid order id' });
    try {
      const { order, checkoutUrl } = await startPayment(orderId);
      const qrDataUrl = await QRCode.toDataURL(checkoutUrl, { margin: 1, width: 320 });

      let emailed = false;
      if (order.customerEmail) {
        try {
          await sendPaymentLinkEmail({ to: order.customerEmail, order: { id: order.id, locationName: order.location?.name || 'Up t Gemak' }, checkoutUrl });
          emailed = true;
        } catch (e) { console.error('[payments] resend email failed:', e); }
      }

      res.json({ checkoutUrl, qrDataUrl, emailed, hasEmail: !!order.customerEmail });
    } catch (e: any) {
      console.error('[payments] resend failed:', e?.message);
      res.status(e?.status || 502).json({ error: e?.status ? e.message : 'Betaallink kon niet worden aangemaakt', detail: e?.message });
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
