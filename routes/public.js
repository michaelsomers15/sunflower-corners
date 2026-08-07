const express = require('express');
const router = express.Router();
const { pool, getSettings } = require('../db/pool');

router.get('/', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { rows: featured } = await pool.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.in_stock DESC, p.sort_order ASC, p.name ASC
       LIMIT 4`
    );
    res.render('index', { settings, featured, page: 'home' });
  } catch (err) { next(err); }
});

router.get('/products', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { rows: categories } = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
    const { rows: products } = await pool.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.in_stock DESC, p.sort_order ASC, p.name ASC`
    );
    const byCategory = categories.map((cat) => ({
      ...cat,
      products: products.filter((p) => p.category_id === cat.id)
    })).filter((cat) => cat.products.length > 0);
    const uncategorized = products.filter((p) => !p.category_id);

    res.render('products', { settings, byCategory, uncategorized, page: 'products' });
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

// Serves product photos stored in Postgres as bytea.
router.get('/image/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT photo, photo_mime FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].photo) return res.status(404).end();
    res.set('Content-Type', rows[0].photo_mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(rows[0].photo);
  } catch (err) { next(err); }
});

module.exports = router;
