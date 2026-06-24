export function euro(cents: number): string {
  return `€${(Number(cents || 0) / 100).toFixed(2)}`;
}

export function euroToCents(input: string): number {
  const n = parseFloat(String(input).replace(',', '.'));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

// Format a Date as local YYYY-MM-DD for <input type=date> defaults.
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
