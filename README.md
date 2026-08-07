# Sunflower Corners Feed & Seed

Informational farmstand website for Sunflower Corners (Custer, Wisconsin). Public
pages show products, availability, hours, and contact info. A password-protected
admin dashboard lets your mom (and you) update inventory, stock status, site
copy, and hours — no code editing required after deployment.

**Stack:** Node.js / Express / PostgreSQL / Railway — same as RentalPro, CoinOp
Manager, and LawnRoute. Server-rendered EJS views, session auth (bcrypt +
`express-session` backed by Postgres via `connect-pg-simple`), product photos
stored directly in Postgres (no third-party file storage to manage).

---

## 1. What's included

- **Public site:** Home, Products (grouped by category, price, description,
  photo, In Stock / Sold Out status), Our Farm (about), Visit & Contact
  (address, hours, phone, map link).
- **Admin dashboard** at `/admin`:
  - One-tap In Stock / Sold Out toggle per product (no page reload)
  - Full product CRUD with photo upload (auto-resized/compressed)
  - Category management
  - Site settings (name, tagline, address, hours, phone, email, about text)
  - Multiple admin logins, each with their own password
  - "My Account" self-service password change
- Rate-limited login (10 attempts / 15 min) and hashed passwords (bcrypt, cost 12)

## 2. Local setup

```bash
git clone <your-new-repo-url> sunflower-corners
cd sunflower-corners
npm install
cp .env.example .env
```

Edit `.env` and point `DATABASE_URL` at a local or cloud Postgres instance,
and set `SESSION_SECRET` to a random string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then create the schema and starter data:

```bash
npm run seed
```

This prints two temporary admin passwords (`mom` and `michael`) **once** — copy
them down immediately, then log in and change them under "My Account."

Run it:

```bash
npm start
```

Visit `http://localhost:3000` for the public site and
`http://localhost:3000/admin/login` for the dashboard.

## 3. Deploying to Railway

You mentioned the domain is already through Railway, so this assumes a new
Railway service in that same project.

```bash
railway login
railway link
```

Add a PostgreSQL plugin from the Railway dashboard if you don't already have
one attached to this project (New -> Database -> PostgreSQL). Railway sets
`DATABASE_URL` automatically for services in the same project once linked.

Set the remaining variables in the Railway dashboard under your service's
**Variables** tab (Settings > Variables) — not in a committed `.env` file:

- `SESSION_SECRET` — a long random string (generate with the command above)
- `NODE_ENV` — `production`

Deploy:

```bash
railway up
```

Then run the one-time seed against the production database. Easiest way is
from the Railway dashboard's service shell, or locally with the production
`DATABASE_URL` exported:

```bash
railway run npm run seed
```

Again, copy the printed temporary passwords immediately — they are not shown
again. Log in at `https://sunflowercorners.pro/admin/login` and have your mom
change her password right away under "My Account."

Point `sunflowercorners.pro` at the Railway service the same way your other
`.pro` domains are configured (Railway dashboard > Settings > Domains).

## 4. Day-to-day use for your mom

Once logged in at `/admin`, the main screen is the product list. Each product
has an **In Stock / Sold Out** button — one tap flips it, no need to open the
item. "Add Product" creates a new listing with a name, category, description,
price, unit (e.g. "per 50 lb bag"), and an optional photo.

Site Settings covers hours, address, phone, and the "About" text — she can
update seasonal hours herself without asking you to touch code.

## 5. Notes on data & photos

- Product photos are stored directly in Postgres (resized to a 1200px-wide
  JPEG on upload) rather than a separate file-storage service, so there's
  nothing extra to configure or pay for. Fine for a farmstand-sized catalog;
  if the product list grows into the hundreds with many photos, moving photos
  to object storage (e.g. S3/R2) would be the next step — flag it and I can
  build that migration.
- All admin-visible timestamps (last updated, last login) are shown in
  Central Time with the UTC offset explicitly labeled, e.g. `Aug 7, 2026,
  2:14 PM (UTC-5)`, so they're unambiguous regardless of daylight saving.

## 6. Project structure

```
sunflower-corners/
  server.js              Entry point
  db/
    schema.sql            Table definitions (auto-applied on boot)
    pool.js                Postgres pool + settings helper
    seed.js                 One-time seed script (categories, placeholder products, admin logins)
  middleware/
    auth.js                Session-based admin route guard
    localTime.js            UTC -> Central Time formatting helper
  routes/
    public.js              Public site routes
    admin.js                Admin dashboard + auth routes
  views/                  EJS templates (public + admin/)
  public/
    css/style.css          Design system (single stylesheet)
    images/logo.png        Your uploaded logo
```
