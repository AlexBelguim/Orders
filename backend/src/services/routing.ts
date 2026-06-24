import prisma from '../db.js';

export type OrderItemInput = {
  variantId: number;
  qty: number;
  note?: string;
  choices?: { menuName: string; optionName?: string | null; priceCents?: number; appendToEnd?: boolean }[];
};

/**
 * Resolve the prep screen for an order item.
 * Precedence: product override → category default → location default.
 * If tableId given and a RouteOverride matches the resolved screen, follow it.
 */
export async function resolvePrepScreen(args: {
  variantId: number;
  locationId: number;
  tableId?: number | null;
}): Promise<number | null> {
  const variant = await prisma.variant.findUnique({
    where: { id: args.variantId },
    include: { product: { include: { category: true } } },
  });
  if (!variant) return null;

  const productScreenId = variant.product.prepScreenId ?? null;
  const categoryScreenId = variant.product.category?.prepScreenId ?? null;

  const location = await prisma.location.findUnique({ where: { id: args.locationId } });
  const locationScreenId = location?.prepScreenId ?? null;

  let screenId = productScreenId ?? categoryScreenId ?? locationScreenId ?? null;

  // Per-table redirect (eat-in only)
  if (screenId && args.tableId) {
    const override = await prisma.routeOverride.findUnique({
      where: { tableId_fromScreenId: { tableId: args.tableId, fromScreenId: screenId } } as any,
    });
    if (override) screenId = override.toScreenId;
  }

  return screenId;
}

/**
 * Resolve the commission (fixed cents) for a variant at a location.
 * Precedence: product override → category override → location default (0).
 */
export async function resolveCommissionCents(args: {
  variantId: number;
  locationId: number;
}): Promise<number> {
  const variant = await prisma.variant.findUnique({
    where: { id: args.variantId },
    include: { product: { include: { category: true } } },
  });
  if (!variant) return 0;

  // product override
  const prod = await prisma.commissionOverride.findUnique({
    where: { locationId_scope_targetId: { locationId: args.locationId, scope: 'PRODUCT', targetId: variant.productId } } as any,
  });
  if (prod) return prod.fixedCents;

  // category override
  if (variant.product.category) {
    const cat = await prisma.commissionOverride.findUnique({
      where: { locationId_scope_targetId: { locationId: args.locationId, scope: 'CATEGORY', targetId: variant.product.category.id } } as any,
    });
    if (cat) return cat.fixedCents;
  }

  return 0;
}
