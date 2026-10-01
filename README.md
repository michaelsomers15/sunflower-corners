# Sunflower Corners Feed & Seed

Informational farmstand website for Sunflower Corners (Custer, Wisconsin). Public
pages show products, availability, hours, and contact info. A password-protected
admin dashboard lets your mom (and you) update inventory, stock status, visibility,
site copy, and hours — no code editing required after deployment.

**Stack:** Node.js / Express / PostgreSQL / Railway — same as RentalPro, CoinOp
Manager, and LawnRoute. Server-rendered EJS views, session auth (bcrypt +
`express-session` backed by Postgres via `connect-pg-simple`), product photos
stored directly in Postgres (no third-party file storage to manage).

---

## 1. What's included

- **Public site:** Home, Products (grouped by category, price, description,
  photo, In Stock / Sold Out / Coming Soon status), Our Farm (about), Visit & Contact
  (address, hours, phone, map link).
- **Multiple sizes per product** — a product like Oats can carry more than
  one size/bag (e.g. "23 lb bag" and "45 lb bag"), each with its own price
  and its own In Stock / Sold Out / Coming Soon status, under one listing. A product with
  one size still shows the classic single-price tag; two or more sizes show
  as a stacked list within the same card.
- **Admin dashboard** at `/admin`:
  - **In Stock / Sold Out / Coming Soon** status dropdown per size (saves
    instantly). The "Coming Soon" wording is editable under Site Settings —
    e.g. "Back Soon" or "Harvesting Soon".
  - One-tap **Visible / Hidden** toggle per product — hide an item from the
    public site (out of season, discontinued, on hold indefinitely) without
    deleting it; it stays in the dashboard so it's easy to bring back later
  - Full product CRUD with photo upload (auto-resized/compressed) and an
    "Add another size" button on the product form for multi-size items
  - Category management, including inline rename/reorder
  - Site settings (name, tagline, address, hours, phone, email, about text,
    and the homepage/products/visit page copy)
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

```bash
railway login
railway link
```

Add a PostgreSQL plugin from the Railway dashboard if you don't already have
one attached to this project (New -> Database -> PostgreSQL).

Set the remaining variables in the Railway dashboard under your service's
**Variables** tab:

- `DATABASE_URL` — reference your Postgres service's variable (click the
  `{}` icon next to the field and select Postgres > DATABASE_URL)
- `SESSION_SECRET` — a long random string (generate with the command above)
- `NODE_ENV` — `production`

Deploy by pushing to the connected GitHub repo, or with:

```bash
railway up
```

Then run the one-time seed against the production database from Railway's
built-in Console (open the service > Console tab):

```bash
npm run seed
```

Copy the printed temporary passwords immediately — they are not shown again.
Log in at `https://sunflowercorners.pro/admin/login` and change the password
right away under "My Account."

## 4. Day-to-day use for your mom

Once logged in at `/admin`, the main screen is the product list. Each
product's sizes get their own status dropdown with three choices:

- **In Stock** — on hand now.
- **Sold Out** — out, with no particular date to be back.
- **Coming Soon** — out right now but expected back (next harvest, next
  batch of syrup). Shows as a gold dashed stamp. The wording can be changed
  under **Site Settings → "Coming soon" status wording** (e.g. "Back Soon",
  "Harvesting Soon").

The item (and its other sizes, if any) stays listed on the public site
either way. On the Products page, items with something in stock show
first, then coming-soon items, then fully sold-out items.

Each product also has a **Visible / Hidden** pill — flip it to pull the
whole item off the public site entirely. Use this for anything out of
season, discontinued, or on hold for an unknown length of time. Hidden
items stay in this dashboard (dimmed, with a line through the name) so
nothing needs to be re-entered when it's time to bring them back.

"Add Product" creates a new listing with a name, category, description,
and an optional photo. Under **Sizes & Pricing**, add one row per size you
carry — e.g. "23 lb bag" at $9.50 and "45 lb bag" at $16.00 — each with its
own price and its own stock checkbox. One size is completely fine too;
just leave the single default row. Click "+ Add another size" to add more,
or "Remove" to drop one (a product always needs at least one size).

Site Settings covers hours, address, phone, and all of the page copy — she
can update seasonal hours or wording herself without touching code.

## 5. Notes on data & photos

- Product photos are stored directly in Postgres (resized to a 1200px-wide
  JPEG on upload) rather than a separate file-storage service, so there's
  nothing extra to configure or pay for. Fine for a farmstand-sized catalog.
- All admin-visible timestamps (last updated, last login) are shown in
  Central Time with the UTC offset explicitly labeled, e.g. `Aug 7, 2026,
  2:14 PM (UTC-5)`.

## 6. Project structure

```
sunflower-corners/
  server.js              Entry point
  db/
    schema.sql            Table definitions (auto-applied on boot)
    pool.js                Postgres pool + settings helper
    seed.js                 One-time seed script
  middleware/
    auth.js                Session-based admin route guard
    localTime.js            UTC -> Central Time formatting helper
  routes/
    public.js              Public site routes (filters out hidden products)
    admin.js                Admin dashboard + auth routes
  views/                  EJS templates (public + admin/)
  public/
    css/style.css          Design system (single stylesheet)
    images/logo.png        Your uploaded logo
```
