// Menu filtering + merging helpers shared between order pages.

// ---------------------------------------------------------------------------
// Prep-screen rush pause. Mirrors backend/src/util.ts — keep in sync.
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

// Is this prep screen paused right now, and until when ("HH:MM" label)?
// A live manual override (pauseOverrideUntil in the future) wins over the daily
// pauseFrom–pauseUntil window; a window with until <= from crosses midnight.
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

// "13:30" → the next Date that time occurs (today, or tomorrow if already past).
// Used to end a scheduled pause early: force-open until the window would close.
export function nextAt(hm?: string | null): Date | null {
  const mins = parseHM(hm);
  if (mins == null) return null;
  const d = new Date();
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

export function filterTreeByExclusions(tree: any, excludedCatIds: Set<number>, excludedProdIds: Set<number>): any {
  if (!tree) return { categories: [] };
  const cats = (tree.categories || [])
    .filter((c: any) => !excludedCatIds.has(c.id))
    .map((c: any) => ({
      ...c,
      products: (c.products || []).filter((p: any) => !excludedProdIds.has(p.id)),
    }))
    .filter((c: any) => c.products.length > 0);
  return { ...tree, categories: cats };
}

// Aggregate order items into display lines for tickets/summaries.
export type AggLine = {
  key: string;
  label: string;
  qty: number;
  choices: { menuName: string; optionName?: string | null; appendToEnd?: boolean }[];
  note?: string;
  unitCents: number;
};

export function aggregateOrderItems(items: any[]): AggLine[] {
  const map = new Map<string, AggLine>();
  for (const it of items || []) {
    const label = it.variant?.product?.name + (it.variant?.name ? ` ${it.variant.name}` : '');
    const nonAppend = (it.choices || []).filter((c: any) => !c.appendToEnd);
    const key = `${it.variantId}|${nonAppend.map((c: any) => `${c.menuName}:${c.optionName || ''}`).join('|')}|${it.lineNote || ''}`;
    const unit = (it.variant?.priceCents || 0) + (it.choices || []).reduce((s: number, c: any) => s + (c.priceCents || 0), 0);
    const existing = map.get(key);
    if (existing) {
      existing.qty += it.qty;
    } else {
      map.set(key, { key, label, qty: it.qty, choices: nonAppend, note: it.lineNote || undefined, unitCents: unit });
    }
  }
  return Array.from(map.values());
}

// Extras aggregated to show at the end of a ticket.
export function aggregateAppendToEnd(items: any[]): { label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const it of items || []) {
    for (const c of (it.choices || [])) {
      if (!c.appendToEnd || !c.optionName) continue;
      const k = c.optionName;
      const e = map.get(k) || { label: c.optionName, count: 0 };
      e.count += it.qty;
      map.set(k, e);
    }
  }
  return Array.from(map.values());
}
