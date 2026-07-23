# Wervik — Up t Gemak bestel-app

Eén app die zowel **festival-leveringen** (kermis/terras) als het **eigen restaurant** (eat-in) afhandelt.

Vervangt de oude `kermis/` (statische HTML + Formspree) en `qr-orders/` (React/Prisma) mappen.

## Routes

| URL | Doel | Toegang |
|-----|------|---------|
| `/admin` | Beheer (producten, locaties, tafels, schermen, commissie, instellingen) | Code |
| `/screen/:slug` | Bereidingsscherm (keuken, bar, afhalen, …) | Code |
| `/stats` | Statistieken + commissie per locatie/dag | Code |
| `/l/:code` | Klant bestelpagina — **levering** (terras QR) | Publiek |
| `/t/:code` | Klant bestelpagina — **restaurant** (tafel QR) | Publiek |
| `/o/:token` | Klant volgt bestelling (e-mail link) | Publiek |

Standaard toegangscode: `thisdudestinky` (wijzig in Admin → Instellingen).

## Lokaal draaien

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run seed      # maakt Keuken/Bar/Afhalen schermen + standaard profiel + instellingen
npm run dev       # http://localhost:4000

# Frontend (aparte terminal voor hot-reload tijdens ontwikkelen)
cd frontend
npm install
npm run dev       # http://localhost:5173 (proxyt /api naar :4000)

# Productie-build (backend serveert dan de frontend)
cd frontend && npm run build
```

## Twee locatie-soorten

- **DELIVERY** (festival terras): één QR per locatie; klant typt tafelnummer. Commissie, e-mailbevestiging, online betaling actief.
- **EAT_IN** (restaurant): één QR per tafel (3D print); anoniem bestellen, betalen aan de balie.

## Bereidingsschermen (manual refresh)

Schermen laden tickets bij openen. Nieuwe bestellingen tonen enkel een banner
"🔔 N nieuwe bestellingen — klik om te laden". De layout wordt **nooit**
automatisch herschikt; pas als medewerker klikt worden nieuwe tickets toegevoegd.

- Per product/categorie: naar welk scherm? (override mogelijk)
- Per tafel: doorsturen (bv. Bar → Bar 2) via RouteOverride
- Afhaal-scherm: Bezig → Onderweg → Geleverd (persistent, zichtbaar voor klant)

## Commissie

Vast € per item, per locatie. Precedentie: product → categorie → 0.
Wordt vastgelegd (`snapshot`) bij bestellen, dus historische rapporten
veranderen nooit als je regels later aanpast.

## E-mail

Bevestigingsmail bij leverings-bestellingen met een **Volg**-link.
SMTP via Gmail app-wachtwoord (Admin → Instellingen → E-mail).

Configureer in Admin → Instellingen:
- SMTP host: `smtp.gmail.com`, poort `587`
- App-wachtwoord: https://myaccount.google.com/apppasswords

## Betalingen (fase 7 — nog uit te bouwen)

Mollie (Bancontact + Apple/Google Pay). Klant kiest online of bij levering.
Vereist publieke HTTPS-URL (Cloudflare Tunnel).

## Productie via Docker (bv. TrueNAS)

Eén image bouwt zowel frontend als backend; de backend serveert de frontend.
De SQLite-database en geüploade productfoto's leven in een volume (`/data`),
dus die blijven bewaard bij een rebuild.

```bash
docker compose up -d --build
# → http://<host>:9009   (admin-code: thisdudestinky)
```

`docker-compose.yml` mapt **host 9009 → container 4000**. Bij de eerste start
voert de entrypoint automatisch `prisma migrate deploy` uit en seedt de
standaard schermen/profiel/instellingen. Wijzig daarna in Admin → Instellingen.

- `PORT` in de container is `4000`; pas de mapping aan in `docker-compose.yml`.
- `PUBLIC_URL` overschrijven in de compose `environment` als je via een tunnel/domein werkt.
- Data: volume `wervik-data` → `/data/wervik.db` + `/data/uploads`.

## Productie op Raspberry Pi

```bash
# op de Pi (ARM64):
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
node dist/index.js

# of als package:
npm run pkg:arm64   # → ../pi-build/wervik
```

Zie `WERVER_PI_SETUP.md` (fase 8) voor Cloudflare Tunnel + PM2.

## Configuratie-sleutels (Setting tabel)

| Sleutel | Betekenis |
|---------|-----------|
| `PUBLIC_URL` | Publieke HTTPS-URL voor QR-codes + e-mail links |
| `ACCESS_CODE` | Toegangscode admin/schermen/stats |
| `smtp_host/port/user/pass` | SMTP (Gmail) |
| `restaurant_name/email` | Naam + antwoord-adres |
| `mollie_api_key` | Mollie sleutel (fase 7) |
| `SOLD_OUT_VARIANT_IDS` | Uitverkochte varianten (JSON array) |
