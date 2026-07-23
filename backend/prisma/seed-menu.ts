// Replaces the placeholder menu with the real card, and clears historical orders.
//
//   npm run menu:reset -- --yes
//
// DESTRUCTIVE. Deletes every order (+ items, choices, payments, GPS pings,
// delivery assignments) and the entire product catalogue, then recreates the
// menu below. Requires --yes so it can never fire by accident on the Pi.
//
// Kept: profiles, locations, tables, prep screens, delivery agents, settings and
// the choice-menu definitions (their product links are dropped with the products).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Item = { name: string; description?: string; priceCents: number };
type Cat = { name: string; screenSlug: string; products: Item[] };

const MENU: Cat[] = [
  {
    name: 'Apero koud',
    screenSlug: 'keuken',
    products: [
      { name: 'Potje rilette + toastjes', priceCents: 800 },
      { name: 'Potje kip & peper + toastjes', priceCents: 600 },
      { name: 'Portie kaas & salami', priceCents: 1100 },
    ],
  },
  {
    name: 'Apero warm',
    screenSlug: 'keuken',
    products: [
      { name: 'Sweet chili chicken popcorn', priceCents: 1000 },
      { name: 'Witte pens + mosterdmayo', priceCents: 1000 },
      { name: '½ rib + dip', description: "in portie's gesneden", priceCents: 1100 },
      { name: 'Portie mix warm', description: '22 gefrituurde hapjes', priceCents: 1800 },
    ],
  },
  {
    name: 'Aperitiefschotels',
    screenSlug: 'keuken',
    products: [
      { name: 'Costa Brava', description: "nacho's, kaasdip en tomatensalsa + chorizo", priceCents: 1300 },
      { name: 'Venetie', description: 'Italiaanse ham, salami Milano, zuiderse kaasdip + toastjes', priceCents: 1400 },
      { name: 'Meat up @ the platse', description: 'buikspek, salami, Italiaanse ham, kip & peper dip + toastjes', priceCents: 1500 },
    ],
  },
  {
    name: 'Honger?',
    screenSlug: 'keuken',
    products: [
      { name: 'Croque monsieur', priceCents: 700 },
      { name: 'Salade "Saint Tropez"', description: 'slaatje met gerookte ham, meloen, mozzarella + brood', priceCents: 1800 },
      { name: 'Salade "Oostende"', description: 'salade, tomaat, grijze garnalen, cocktailsaus + brood', priceCents: 2600 },
      { name: 'Mosselen natuur ½ kg + brood', priceCents: 1600 },
      { name: 'Tortilla', description: 'met pulled pork', priceCents: 1700 },
      { name: 'Paëlla Royal', description: 'met zeevruchten en kipboutje', priceCents: 2100 },
      { name: 'Pasta bolognaise', priceCents: 1000 },
      { name: 'Pasta curry met kip', priceCents: 1200 },
      { name: 'Pasta maison veggie', description: 'saus op basis van mascarpone en Italiaanse kruiden + zongedroogde tomaat', priceCents: 1200 },
      { name: 'Pasta maison + kip en scampi (3)', priceCents: 1500 },
      { name: 'Spaanse pasta', description: 'saus met chorizo + extra kip', priceCents: 1400 },
    ],
  },
];

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('Refusing to run without --yes.\n\n  npm run menu:reset -- --yes\n');
    console.error('This deletes ALL orders and the ENTIRE product catalogue.');
    process.exit(1);
  }

  const profile = await prisma.profile.findFirst({ orderBy: { id: 'asc' } });
  if (!profile) throw new Error('No profile found — create one first.');

  const screens = await prisma.prepScreen.findMany();
  const screenBySlug = new Map(screens.map((s) => [s.slug, s.id]));

  // ---- 1. historical orders (children first) ----
  const removed = await prisma.$transaction(async (tx) => {
    const orderItemChoices = (await tx.orderItemChoice.deleteMany()).count;
    const orderItems = (await tx.orderItem.deleteMany()).count;
    const payments = (await tx.payment.deleteMany()).count;
    const positionPings = (await tx.positionPing.deleteMany()).count;
    const assignments = (await tx.deliveryAssignment.deleteMany()).count;
    const orders = (await tx.order.deleteMany()).count;

    // ---- 2. old catalogue (and everything pointing at it) ----
    await tx.locationCategoryExclusion.deleteMany();
    await tx.locationProductExclusion.deleteMany();
    await tx.productChoiceMenu.deleteMany();
    // scope+targetId referenced the products we're about to delete
    await tx.commissionOverride.deleteMany();
    const variants = (await tx.variant.deleteMany()).count;
    const products = (await tx.product.deleteMany()).count;
    const categories = (await tx.category.deleteMany()).count;

    return { orderItemChoices, orderItems, payments, positionPings, assignments, orders, variants, products, categories };
  });

  // Restart order numbering at #1 — the customer sees this id on the confirmation.
  for (const t of ['Order', 'OrderItem', 'OrderItemChoice', 'Category', 'Product', 'Variant']) {
    await prisma.$executeRawUnsafe(`DELETE FROM sqlite_sequence WHERE name = '${t}'`);
  }

  console.log('Deleted:', removed);

  // ---- 3. new menu ----
  let catSort = 0;
  for (const cat of MENU) {
    const created = await prisma.category.create({
      data: {
        name: cat.name,
        profileId: profile.id,
        sort: catSort++,
        prepScreenId: screenBySlug.get(cat.screenSlug) ?? null,
        products: {
          create: cat.products.map((p, i) => ({
            name: p.name,
            description: p.description ?? null,
            sort: i,
            // single-price product: exactly one unnamed variant
            variants: { create: [{ name: '', priceCents: p.priceCents }] },
          })),
        },
      },
      include: { products: true },
    });
    console.log(`+ ${created.name} (${created.products.length} items → ${cat.screenSlug})`);
  }

  const total = MENU.reduce((n, c) => n + c.products.length, 0);
  console.log(`\nDone — ${MENU.length} categories, ${total} products.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
