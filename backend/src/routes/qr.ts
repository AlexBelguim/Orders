import { Router } from 'express';
import QRCode from 'qrcode';
import prisma from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export default function qrRouter() {
  const r = Router();

  // These PNG routes are opened via plain `<a href target="_blank">` links in
  // the admin UI (for printing), which can't attach a custom auth header, so
  // they stay public. They only encode a public order-page URL — no secrets.
  // Delivery QR: /l/:code
  r.get('/location/:code.png', async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const base = await getBaseUrl();
    const url = `${base}/l/${code}`;
    sendPng(res, url);
  });

  // Eat-in QR: /t/:code
  r.get('/table/:code.png', async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const base = await getBaseUrl();
    const url = `${base}/t/${code}`;
    sendPng(res, url);
  });

  r.get('/base-url', requireAdmin, async (_req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: 'PUBLIC_URL' } });
    res.json({ value: row?.value || '' });
  });

  r.put('/base-url', requireAdmin, async (req, res) => {
    const url = String((req.body as any)?.url ?? '').trim().replace(/\/+$/, '');
    if (!url) return res.status(400).json({ error: 'url required' });
    const saved = await prisma.setting.upsert({ where: { key: 'PUBLIC_URL' }, update: { value: url }, create: { key: 'PUBLIC_URL', value: url } });
    res.json(saved);
  });

  return r;
}

async function getBaseUrl(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'PUBLIC_URL' } });
  return (row?.value || 'http://localhost:4000').replace(/\/+$/, '');
}

async function sendPng(res: any, url: string) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const png = await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 512 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
}
