import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Default settings. SMTP/Mollie left empty → features no-op gracefully until configured.
const SETTINGS: Record<string, string> = {
  PUBLIC_URL: 'http://localhost:4000',
  ACCESS_CODE: 'thisdudestinky', // admin gate; change in /admin → Settings
  // SMTP (Gmail: smtp.gmail.com:587 + app password)
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  restaurant_name: 'Up t Gemak',
  restaurant_email: '',
  // Mollie
  mollie_api_key: '',
  mollie_redirect_base: '', // e.g. https://your-tunnel.example.com
};

async function main() {
  // Prep screens (seeds) — Kitchen + Bar by default, takeaway example off by default.
  const screens = [
    { name: 'Keuken', slug: 'keuken', sort: 10, isTakeaway: false },
    { name: 'Bar', slug: 'bar', sort: 20, isTakeaway: false },
    { name: 'Afhalen', slug: 'afhalen', sort: 30, isTakeaway: true },
  ];
  for (const s of screens) {
    await prisma.prepScreen.upsert({
      where: { slug: s.slug },
      update: {},
      create: s,
    });
  }

  // Default profile
  const profileCount = await prisma.profile.count();
  if (profileCount === 0) {
    await prisma.profile.create({ data: { name: 'Standaard menu' } });
  }

  // Sample delivery agent (so the dispatch flow is testable immediately)
  await prisma.deliveryAgent.upsert({
    where: { code: 'demo' },
    update: {},
    create: { name: 'Demo bezorger', phone: '+32470000000', code: 'demo' },
  });

  // Settings (upsert each)
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  console.log('Seed complete: prep screens (Keuken, Bar, Afhalen), default profile, sample delivery agent, default settings.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
