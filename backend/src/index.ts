import 'express-async-errors';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';

import prisma from './db.js';
import profilesRouter from './routes/profiles.js';
import productsRouter from './routes/products.js';
import choicesRouter from './routes/choices.js';
import prepScreensRouter from './routes/prepscreens.js';
import locationsRouter from './routes/locations.js';
import tablesRouter from './routes/tables.js';
import ordersRouter from './routes/orders.js';
import statsRouter from './routes/stats.js';
import qrRouter from './routes/qr.js';
import settingsRouter from './routes/settings.js';
import agentsRouter from './routes/agents.js';
import dispatchRouter from './routes/dispatch.js';
import paymentsRouter from './routes/payments.js';
import { UPLOADS_DIR, ensureUploadsDir } from './uploads.js';

const app = express();
app.use(cors());
// Raised from the default 100kb so base64 product-image uploads fit (a 5MB
// image is ~6.7MB base64).
app.use(express.json({ limit: '8mb' }));

// Uploaded product images, served read-only.
ensureUploadsDir();
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/profiles', profilesRouter());
app.use('/api/products', productsRouter());
app.use('/api/choices', choicesRouter());
app.use('/api/prep-screens', prepScreensRouter());
app.use('/api/locations', locationsRouter());
app.use('/api/tables', tablesRouter());
app.use('/api/orders', ordersRouter());
app.use('/api/stats', statsRouter());
app.use('/api/qr', qrRouter());
app.use('/api/settings', settingsRouter());
app.use('/api/agents', agentsRouter());
app.use('/api/dispatch', dispatchRouter());
app.use('/api/payments', paymentsRouter());

app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

const cwd = process.cwd();
let frontendDist: string | undefined;
// Look in every plausible layout: env override, sibling frontend/dist
// (dev + Pi package), frontend/dist inside the app dir (Docker image), and
// finally the backend's own dist (for some packaged builds).
const candidates = [
  process.env.FRONTEND_DIST,
  path.join(cwd, '..', 'frontend', 'dist'),
  path.join(cwd, 'frontend', 'dist'),
  path.join(cwd, 'dist'),
];
for (const c of candidates) { if (c && fs.existsSync(path.join(c, 'index.html'))) { frontendDist = c; break; } }
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    try { res.sendFile(path.join(frontendDist!, 'index.html')); } catch { next(); }
  });
} else { console.warn('Warning: frontend build not found. API-only mode.'); }

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Niet gevonden' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Conflict' });
  if (err?.code === 'P2003') return res.status(409).json({ error: 'Nog in gebruik' });
  console.error('[unhandled error]', err?.message || err);
  res.status(500).json({ error: 'Serverfout', detail: err?.message?.slice(0, 200) });
});

const httpServer = createServer(app);
export const io = new Server(httpServer, { cors: { origin: '*' } });
io.on('connection', (socket) => { socket.on('ping', () => socket.emit('pong', {})); });

const PORT = Number(process.env.PORT) || 4000;
httpServer.listen(PORT, () => { console.log('Wervik API listening on ' + PORT); console.log('Frontend dist: ' + (frontendDist || '(not found)')); });

process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); });
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err?.message || err); });
process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
