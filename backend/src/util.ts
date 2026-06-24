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
