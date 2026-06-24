// Where uploaded product images live. Resolved off the process CWD so it works
// the same in dev (backend/uploads) and in the packaged Pi build (cwd/uploads).
// Set UPLOADS_DIR to move it elsewhere (e.g. a mounted volume in Docker).
// Served read-only at /uploads by index.ts; written by the products route.
import path from 'path';
import fs from 'fs';

export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), 'uploads');

export function ensureUploadsDir() {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch { /* already exists */ }
}
