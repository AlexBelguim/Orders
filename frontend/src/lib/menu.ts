// Menu filtering + merging helpers shared between order pages.

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
