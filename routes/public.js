const express = require('express');
const router = express.Router();
const { pool, getSettings } = require('../db/pool');
const { withAffiliateTag, isAmazonUrl } = require('../lib/affiliate');

// Groups visible picks into sections, ordered by each section's lowest
// sort_order (then name), and resolves each link with the Associate tag.
function groupPicks(rows, tag) {
  const sections = new Map();
  for (const r of rows) {
    if (!sections.has(r.section)) sections.set(r.section, { name: r.section, minSort: r.sort_order, picks: [] });
    const sec = sections.get(r.section);
    sec.minSort = Math.min(sec.minSort, r.sort_order);
    sec.picks.push({ ...r, href: withAffiliateTag(r.url, tag), isAmazon: isAmazonUrl(r.url) });
  }
  return [...sections.values()].sort((a, b) => a.minSort - b.minSort || a.name.localeCompare(b.name));
}

// Shared SELECT fragment: attaches each product's sizes/variants as a JSON
// array (id, label, price, status), ordered the way they were entered in
// admin. stock_rank sorts listings: 0 = at least one size in stock,
// 1 = nothing in stock but at least one size coming soon, 2 = fully sold out.
const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name,
    COALESCE((
      SELECT json_agg(json_build_object('id', v.id, 'label', v.label, 'price', v.price, 'status', v.status) ORDER BY v.sort_order, v.id)
      FROM product_variants v WHERE v.product_id = p.id
    ), '[]') AS variants,
    CASE
      WHEN EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.status = 'in_stock') THEN 0
      WHEN EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.status = 'coming_soon') THEN 1
      ELSE 2
    END AS stock_rank
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`;

router.get('/', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { rows: featured } = await pool.query(
      `${PRODUCT_SELECT}
       WHERE p.visible = true
       ORDER BY stock_rank ASC, p.sort_order ASC, p.name ASC
       LIMIT 4`
    );
    const { rows: pickRows } = await pool.query('SELECT COUNT(*)::int AS n FROM affiliate_links WHERE visible = true');
    res.render('index', { settings, featured, pickCount: pickRows[0].n, page: 'home' });
  } catch (err) { next(err); }
});

router.get('/products', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { rows: categories } = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
    const { rows: products } = await pool.query(
      `${PRODUCT_SELECT}
       WHERE p.visible = true
       ORDER BY stock_rank ASC, p.sort_order ASC, p.name ASC`
    );
    const byCategory = categories.map((cat) => ({
      ...cat,
      products: products.filter((p) => p.category_id === cat.id)
    })).filter((cat) => cat.products.length > 0);
    const uncategorized = products.filter((p) => !p.category_id);

    res.render('products', { settings, byCategory, uncategorized, page: 'products' });
  } catch (err) { next(err); }
});

router.get('/picks', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { rows } = await pool.query(
      `SELECT id, section, title, description, url, (photo IS NOT NULL) AS has_photo, sort_order
       FROM affiliate_links WHERE visible = true
       ORDER BY sort_order ASC, title ASC`
    );
    res.render('picks', { settings, sections: groupPicks(rows, settings.amazon_tag), page: 'picks' });
  } catch (err) { next(err); }
});

router.get('/about', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('about', { settings, page: 'about' });
  } catch (err) { next(err); }
});

router.get('/visit', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('visit', { settings, page: 'visit' });
  } catch (err) { next(err); }
});

// Serves product photos stored in Postgres as bytea. Not gated on visible —
// an admin editing a hidden product's listing still needs its photo to load.
router.get('/image/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT photo, photo_mime FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].photo) return res.status(404).end();
    res.set('Content-Type', rows[0].photo_mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(rows[0].photo);
  } catch (err) { next(err); }
});

router.get('/pick-image/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT photo, photo_mime FROM affiliate_links WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].photo) return res.status(404).end();
    res.set('Content-Type', rows[0].photo_mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(rows[0].photo);
  } catch (err) { next(err); }
});

module.exports = router;
