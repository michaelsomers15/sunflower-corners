const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

const DEFAULT_SETTINGS = {
  farm_name: 'Sunflower Corners Feed & Seed',
  tagline: 'Fresh grains, seed, and syrup — grown and packed right here in Custer.',
  address_line1: '',
  address_line2: 'Custer, Wisconsin',
  phone: '',
  email: '',
  hours: 'Mon-Fri: 9am - 5pm\nSat: 9am - 2pm\nSun: Closed',
  about_text: 'Sunflower Corners is a family-run farmstand growing and packing rye, corn, sunflower seed, oats, and maple syrup right here in Custer, Wisconsin. Stop by the stand to see what is fresh this week.',
  facebook_url: '',
  home_lede: "Rye, corn, oats, sunflower seed, and pure maple syrup — grown, cleaned, and bagged right here on the farm. Check what's in stock before you head out.",
  products_intro: "Stock status is updated by hand at the stand, so it's worth a quick check here before you make a trip for something specific.",
  visit_note: 'Hours may shift seasonally — this page is always the most current source.',
  coming_soon_label: 'Coming Soon'
};

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM site_settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO site_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

module.exports = { pool, ensureSchema, getSettings, setSetting, DEFAULT_SETTINGS };
