// Small shared helpers used across routes.
import { customAlphabet } from 'nanoid';

// Human-friendly code alphabet (no ambiguous chars like 0/O, 1/I)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeNano = customAlphabet(CODE_ALPHABET, 4);

export function genCode(): string {
  return codeNano();
}

export function euroToCents(input: string | number): number {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(',', '.'));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToEuro(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Make a slug unique within a given model's existing slugs.
export function uniqueSlug(base: string, existing: string[]): string {
  let slug = base || 'screen';
  let i = 2;
  const set = new Set(existing);
  while (set.has(slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

export function nowMinusMs(ms: number): Date {
  return new Date(Date.now() - ms);
}

// ---------------------------------------------------------------------------
// Prep-screen rush pause. Mirrored in frontend/src/lib/menu.ts — keep in sync.
// ---------------------------------------------------------------------------

export type PauseInfo = { paused: boolean; until: string | null };

function parseHM(v?: string | null): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is this prep screen paused right now, and until when ("HH:MM" label)?
 * A live manual override (pauseOverrideUntil in the future) wins over the
 * daily pauseFrom–pauseUntil window in whichever direction it says; a window
 * with until <= from crosses midnight.
 */
export function screenPauseState(s: any, now: Date = new Date()): PauseInfo {
  if (!s) return { paused: false, until: null };
  const fmt = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const ovUntil = s.pauseOverrideUntil ? new Date(s.pauseOverrideUntil) : null;
  if (ovUntil && !Number.isNaN(ovUntil.getTime()) && ovUntil.getTime() > now.getTime()) {
    return s.pauseOverridePaused ? { paused: true, until: fmt(ovUntil) } : { paused: false, until: null };
  }
  const from = parseHM(s.pauseFrom);
  const until = parseHM(s.pauseUntil);
  if (from == null || until == null) return { paused: false, until: null };
  const cur = now.getHours() * 60 + now.getMinutes();
  const inWindow = from <= until ? cur >= from && cur < until : cur >= from || cur < until;
  return inWindow ? { paused: true, until: s.pauseUntil } : { paused: false, until: null };
}
