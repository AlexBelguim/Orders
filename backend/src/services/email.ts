import nodemailer from 'nodemailer';
import prisma from '../db.js';

// SMTP settings live in the Setting table (Gmail: smtp.gmail.com:587 + app password).
// Pattern adapted from F:\git\booking\server\services\email.js.
async function getEmailSettings() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'restaurant_name', 'restaurant_email'] } },
  });
  const cfg: Record<string, string> = {};
  rows.forEach((r: any) => { cfg[r.key] = r.value; });
  return cfg;
}

async function createTransporter() {
  const s = await getEmailSettings();
  if (!s.smtp_host || !s.smtp_user) return null;
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: parseInt(s.smtp_port) || 587,
    secure: parseInt(s.smtp_port) === 465,
    auth: { user: s.smtp_user, pass: s.smtp_pass },
  });
}

async function getBaseUrl() {
  const row = await prisma.setting.findUnique({ where: { key: 'PUBLIC_URL' } });
  return (row?.value || 'http://localhost:4000').replace(/\/+$/, '');
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export type OrderSummaryLine = { label: string; qty: number; choices?: string[] };

function buildOrderTable(lines: OrderSummaryLine[]): string {
  const rows = lines.map((l) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(String(l.qty))}×</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(l.label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">
        ${(l.choices || []).map(escapeHtml).join('<br>')}
      </td>
    </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead><tr style="text-align:left;color:#888;">
      <th style="padding:8px 12px;">Aantal</th><th style="padding:8px 12px;">Item</th><th style="padding:8px 12px;">Extra's</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/** Send confirmation email to a delivery customer, with a track link. */
export async function sendOrderConfirmationEmail(args: {
  to: string;
  order: { id: number; cancelToken: string; tableLabel?: string | null; note?: string | null; locationName: string; payMethod: string };
  lines: OrderSummaryLine[];
}): Promise<void> {
  const s = await getEmailSettings();
  const transporter = await createTransporter();
  if (!transporter) { console.warn('[email] SMTP not configured, skipping confirmation email.'); return; }

  const base = await getBaseUrl();
  const restaurantName = s.restaurant_name || 'Up t Gemak';
  const fromEmail = s.restaurant_email || s.smtp_user;

  const trackUrl = `${base}/o/${args.order.cancelToken}`;

  const payNote = args.order.payMethod === 'ONLINE' ? 'Betaald online.' : 'Betaal bij levering (cash of kaart).';
  const tableHtml = args.order.tableLabel ? `<div style="color:#555;">Tafel: <strong>${escapeHtml(args.order.tableLabel)}</strong></div>` : '';
  const noteHtml = args.order.note ? `<div style="margin-top:8px;color:#555;">Opmerking: ${escapeHtml(args.order.note)}</div>` : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#222;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#0D47A1,#1976D2);padding:24px 28px;color:#fff;">
      <div style="font-size:20px;font-weight:700;">${escapeHtml(restaurantName)}</div>
      <div style="margin-top:4px;opacity:0.9;">Bestelling ontvangen — ${escapeHtml(args.order.locationName)}</div>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 12px;">Bedankt voor je bestelling! We zijn ermee bezig.</p>
      ${tableHtml}
      <div style="color:#555;margin-top:4px;">${payNote}</div>
      ${noteHtml}
      <div style="margin:20px 0 8px;">${buildOrderTable(args.lines)}</div>
      <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap;">
        <a href="${trackUrl}" style="display:inline-block;background:#1976D2;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Volg je bestelling →</a>
      </div>
    </div>
  </div></body></html>`;

  await transporter.sendMail({
    from: `"${restaurantName}" <${fromEmail}>`,
    replyTo: fromEmail,
    to: args.to,
    subject: `Bestelling ontvangen — ${args.order.locationName}`,
    html,
  });
}

/** Sent when a delivery rider/staff triggers a payment link for a customer
 * who can't pay cash at the door. */
export async function sendPaymentLinkEmail(args: {
  to: string;
  order: { id: number; locationName: string };
  checkoutUrl: string;
}): Promise<void> {
  const s = await getEmailSettings();
  const transporter = await createTransporter();
  if (!transporter) { console.warn('[email] SMTP not configured, skipping payment link email.'); return; }

  const restaurantName = s.restaurant_name || 'Up t Gemak';
  const fromEmail = s.restaurant_email || s.smtp_user;

  const html = `<!DOCTYPE html><html><body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;color:#222;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#0D47A1,#1976D2);padding:24px 28px;color:#fff;">
      <div style="font-size:20px;font-weight:700;">${escapeHtml(restaurantName)}</div>
      <div style="margin-top:4px;opacity:0.9;">Betaal je bestelling online — ${escapeHtml(args.order.locationName)}</div>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;">Je bezorger vroeg je om online te betalen voor bestelling #${args.order.id}. Tik hieronder om te betalen (Bancontact, Apple Pay, Google Pay).</p>
      <a href="${args.checkoutUrl}" style="display:inline-block;background:#1976D2;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Betaal nu →</a>
    </div>
  </div></body></html>`;

  await transporter.sendMail({
    from: `"${restaurantName}" <${fromEmail}>`,
    replyTo: fromEmail,
    to: args.to,
    subject: `Betaal je bestelling #${args.order.id} — ${args.order.locationName}`,
    html,
  });
}

/** Returns true if the transport is healthy. */
export async function testEmailConnection(): Promise<boolean> {
  const transporter = await createTransporter();
  if (!transporter) return false;
  await transporter.verify();
  return true;
}
