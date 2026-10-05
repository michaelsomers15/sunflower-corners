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
  coming_soon_label: 'Coming Soon',
  amazon_tag: '',
  picks_intro: 'Bird houses, feeders, and garden supplies we like and recommend. Pair a feeder with a bag of sunflower seed from the stand.'
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

// Starter "Our Picks" so the page isn't empty on day one. These are Amazon
// search links (always valid, no specific product to go stale); swap any of
// them for a specific product link from SiteStripe in /admin/picks.
const STARTER_PICKS = [
  ['Bird Houses & Feeders', 'Cedar Bird House', 'A natural cedar house for wrens, chickadees, and other small songbirds.', 'cedar bird house'],
  ['Bird Houses & Feeders', 'Bluebird House', 'Sized for Eastern Bluebirds, which nest across Wisconsin from spring through summer.', 'bluebird house'],
  ['Bird Houses & Feeders', 'Sunflower Seed Tube Feeder', 'A tube feeder made for black oil sunflower seed. Fill it with seed from the stand.', 'sunflower seed tube bird feeder'],
  ['Bird Houses & Feeders', 'Squirrel Baffle', 'Mounts on a feeder pole to keep squirrels out of the seed.', 'squirrel baffle for pole'],
  ['Bird Houses & Feeders', 'Heated Bird Bath', 'Keeps water open for the birds through a Wisconsin winter.', 'heated bird bath'],
  ['Gardening', 'Seed Starting Trays', 'Trays with humidity domes for getting seedlings going indoors before the last frost.', 'seed starting trays with humidity dome'],
  ['Gardening', 'Raised Garden Bed', 'An easy-to-assemble raised bed for vegetables and flowers.', 'raised garden bed'],
  ['Gardening', 'Leather Garden Gloves', 'Sturdy gloves for weeding, pruning, and general garden work.', 'leather garden gloves'],
  ['Gardening', 'Garden Hand Tool Set', 'Trowel, transplanter, and cultivator for planting and weeding.', 'garden hand tool set'],
  ['Maple Sugaring', 'Maple Tree Tapping Kit', 'Spiles, buckets, and lids to tap your own maples come spring.', 'maple tree tapping kit']
];

// Runs once ever: inserts the starter picks, then records that it did, so
// picks deleted later in admin never come back.
async function seedStarterPicks() {
  const { amazonSearchUrl } = require('../lib/affiliate');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `INSERT INTO site_settings (key, value) VALUES ('picks_seeded', 'true') ON CONFLICT (key) DO NOTHING`
    );
    if (rowCount === 1) {
      for (let i = 0; i < STARTER_PICKS.length; i++) {
        const [section, title, description, keywords] = STARTER_PICKS[i];
        await client.query(
          'INSERT INTO affiliate_links (section, title, description, url, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [section, title, description, amazonSearchUrl(keywords), (i + 1) * 10]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, ensureSchema, seedStarterPicks, getSettings, setSetting, DEFAULT_SETTINGS };
