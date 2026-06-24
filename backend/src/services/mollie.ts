import prisma from '../db.js';

const MOLLIE_API = 'https://api.mollie.com/v2';

async function getApiKey() {
  const row = await prisma.setting.findUnique({ where: { key: 'mollie_api_key' } });
  return row?.value || '';
}

async function getBaseUrl() {
  const row = await prisma.setting.findUnique({ where: { key: 'PUBLIC_URL' } });
  return (row?.value || 'http://localhost:4000').replace(/\/+$/, '');
}

/** Create a Mollie payment for an order. Returns the checkout URL. */
export async function createMolliePayment(orderId: number, amountCents: number, description: string): Promise<{ checkoutUrl: string; mollieId: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Mollie API key not configured');

  let baseUrl = await getBaseUrl();
  // Mollie requires https:// URLs for redirect + webhook.
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;

  const body = new URLSearchParams();
  body.append('amount[value]', (amountCents / 100).toFixed(2));
  body.append('amount[currency]', 'EUR');
  body.append('description', description.slice(0, 255));
  body.append('redirectUrl', `${baseUrl}/o/payment-pending?order=${orderId}`);
  body.append('webhookUrl', `${baseUrl}/api/payments/webhook`);
  body.append('metadata', JSON.stringify({ orderId: String(orderId) }));

  const res = await fetch(`${MOLLIE_API}/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[mollie] create payment failed:', res.status, errText);
    throw new Error(`Mollie error: ${res.status}`);
  }

  const data = await res.json();
  return {
    checkoutUrl: data._links?.checkout?.href || data.checkoutUrl,
    mollieId: data.id,
  };
}

/** Check a Mollie payment status by its ID. Updates the local Payment record. */
export async function checkMolliePayment(mollieId: string): Promise<{ status: string; paid: boolean }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Mollie API key not configured');

  const res = await fetch(`${MOLLIE_API}/payments/${mollieId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) throw new Error(`Mollie fetch error: ${res.status}`);
  const data = await res.json();

  const status = data.status?.toUpperCase() || 'UNKNOWN';
  const paid = status === 'PAID';

  // Update our local Payment record
  const payment = await prisma.payment.findFirst({ where: { providerId: mollieId } });
  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        paidAt: paid ? new Date() : null,
        method: data.method || null,
      },
    });

    // If paid, emit via socket so screens update
    if (paid && payment.orderId) {
      const { io } = await import('../index.js');
      io.emit('paymentUpdated', { orderId: payment.orderId, status: 'PAID' });
    }
  }

  return { status, paid };
}

/** Refund a Mollie payment (used when an order is cancelled within the window). */
export async function refundMolliePayment(mollieId: string): Promise<boolean> {
  const apiKey = await getApiKey();
  if (!apiKey) return false;

  try {
    const res = await fetch(`${MOLLIE_API}/payments/${mollieId}/refunds`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ description: 'Order cancelled within 2 minutes' }),
    });

    if (!res.ok) {
      console.error('[mollie] refund failed:', res.status, await res.text());
      return false;
    }

    // Update local payment record
    const payment = await prisma.payment.findFirst({ where: { providerId: mollieId } });
    if (payment) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
    }
    return true;
  } catch (e) {
    console.error('[mollie] refund error:', e);
    return false;
  }
}
