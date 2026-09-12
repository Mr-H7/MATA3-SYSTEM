# MATA3 Commerce OS

Database-first internal commerce operations for MATA3 — مَتاع across Egypt and Morocco.

## Requirements

- Node.js 20 or newer
- PostgreSQL 16 or newer
- npm

## Local setup

1. Create a PostgreSQL role and database:

   ```powershell
   psql -U postgres -c "CREATE USER mata3_user WITH PASSWORD 'choose-a-local-password';"
   psql -U postgres -c "CREATE DATABASE mata3 OWNER mata3_user;"
   ```

2. Copy `.env.example` to `.env` and set:

   - `DATABASE_URL` to the local PostgreSQL connection string.
   - `SESSION_SECRET` to a cryptographically random value of at least 32 bytes.
   - `SEED_OWNER_PASSWORD` and `SEED_SELLER_PASSWORD` to temporary strong initial passwords.

   Never commit `.env` or paste its values into issues, logs, or chat.

3. Install and initialize:

   ```powershell
   npm install
   npx prisma generate
   npx prisma migrate deploy
   npm run db:seed
   ```

4. Start the application:

   ```powershell
   npm run dev
   ```

   Open `http://localhost:3000`. The seed creates the owner username `Haytham` and Morocco seller username `poha` using the passwords supplied only through `.env`. Change initial passwords through Owner → Users after first sign-in.

## Verification

```powershell
npx prisma format
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm run build
```

## Operational guarantees

- PostgreSQL is the source of truth; Prisma migrations are committed under `prisma/migrations`.
- Egypt and Morocco prices, currency, inventory, suppliers, and sales remain independent.
- Sales and virtual-bundle component deductions are committed in one serializable transaction.
- Sale items preserve product, variant, market, currency, price, and cost snapshots.
- Stock adjustments always create inventory movements and cannot produce negative physical stock.
- Role and market permissions are enforced at server/API boundaries. Seller payloads exclude cost, margin, inventory valuation, private supplier data, and owner reporting.
- Full CSV/XLSX exports are owner-only and query current PostgreSQL state.

## Production deployment

The local `localhost` database cannot serve a cloud deployment. Configure a network-accessible PostgreSQL database before launch, then set `DATABASE_URL` and a unique production `SESSION_SECRET` in the deployment provider’s encrypted environment settings.

Apply production migrations with:

```powershell
npx prisma migrate deploy
```

Do not run `prisma migrate reset` or the development seed against production business data. If initial production accounts are needed, provide strong one-time seed passwords through protected environment variables, run the idempotent seed once, rotate those passwords immediately, and remove the seed variables.

## Public website integration

The internal database is intended to become the single commerce source of truth. Future public catalogue endpoints must use explicit read-only projections and must never expose costs, margins, private supplier data, inventory history, users, audit logs, or internal notes.
