// One-time (idempotent) seed script.
// Usage: npm run seed
// Creates starter categories, placeholder products (edit these in /admin),
// and two admin logins with randomly generated temporary passwords, which
// are printed to the console ONCE. Log in and change them immediately via
// /admin/account.

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, ensureSchema } = require('./pool');

function tempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

async function upsertCategory(name, sortOrder) {
  const { rows } = await pool.query(
    `INSERT INTO categories (name, sort_order) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order
     RETURNING id`,
    [name, sortOrder]
  );
  return rows[0].id;
}

async function insertProductIfMissing(product) {
  const { rows } = await pool.query('SELECT id FROM products WHERE name = $1', [product.name]);
  if (rows.length) return;
  await pool.query(
    `INSERT INTO products (category_id, name, description, price, unit, in_stock, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [product.category_id, product.name, product.description, product.price, product.unit, product.in_stock, product.sort_order]
  );
}

async function createAdminIfMissing(username, displayName) {
  const { rows } = await pool.query('SELECT id FROM admin_users WHERE username = $1', [username]);
  if (rows.length) {
    console.log(`  - admin "${username}" already exists, skipping`);
    return null;
  }
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, 12);
  await pool.query(
    `INSERT INTO admin_users (username, password_hash, display_name) VALUES ($1, $2, $3)`,
    [username, hash, displayName]
  );
  return pw;
}

async function main() {
  console.log('Ensuring schema...');
  await ensureSchema();

  console.log('Seeding categories...');
  const grains = await upsertCategory('Grains', 1);
  const seeds = await upsertCategory('Seeds', 2);
  const syrup = await upsertCategory('Maple Syrup', 3);
  const other = await upsertCategory('Other Farmstand Goods', 4);

  console.log('Seeding placeholder products (edit real prices/descriptions in /admin)...');
  await insertProductIfMissing({
    category_id: grains, name: 'Rye', unit: 'per 50 lb bag', price: 0,
    description: 'Placeholder listing — update description and price in the admin dashboard.',
    in_stock: true, sort_order: 1
  });
  await insertProductIfMissing({
    category_id: grains, name: 'Corn', unit: 'per 50 lb bag', price: 0,
    description: 'Placeholder listing — update description and price in the admin dashboard.',
    in_stock: true, sort_order: 2
  });
  await insertProductIfMissing({
    category_id: grains, name: 'Oats', unit: 'per 50 lb bag', price: 0,
    description: 'Placeholder listing — update description and price in the admin dashboard.',
    in_stock: true, sort_order: 3
  });
  await insertProductIfMissing({
    category_id: seeds, name: 'Sunflower Seeds', unit: 'per 50 lb bag', price: 0,
    description: 'Placeholder listing — update description and price in the admin dashboard.',
    in_stock: true, sort_order: 1
  });
  await insertProductIfMissing({
    category_id: syrup, name: 'Maple Syrup', unit: 'per quart', price: 0,
    description: 'Placeholder listing — update description and price in the admin dashboard.',
    in_stock: true, sort_order: 1
  });

  console.log('Creating admin logins...');
  const creds = [];
  const p1 = await createAdminIfMissing('mom', "Mom");
  if (p1) creds.push(['mom', p1]);
  const p2 = await createAdminIfMissing('michael', 'Michael');
  if (p2) creds.push(['michael', p2]);

  console.log('\n=================================================');
  console.log(' SEED COMPLETE');
  console.log('=================================================');
  if (creds.length) {
    console.log('Temporary admin passwords (shown ONCE — save these now):\n');
    for (const [u, p] of creds) {
      console.log(`  username: ${u}`);
      console.log(`  password: ${p}\n`);
    }
    console.log('Log in at /admin/login, then go to "My Account" to set a');
    console.log('permanent password immediately.');
  } else {
    console.log('Admin accounts already existed — no new passwords generated.');
  }
  console.log('=================================================\n');

  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
