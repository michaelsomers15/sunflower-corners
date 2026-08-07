const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const { pool, getSettings, setSetting } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { formatLocal } = require('../middleware/localTime');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed.'));
    }
    cb(null, true);
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
  standardHeaders: true,
  legacyHeaders: false
});

// ---------- Login / Logout ----------

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { error: null, page: 'login' });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    const user = rows[0];
    const ok = user ? await bcrypt.compare(password || '', user.password_hash) : false;
    if (!ok) {
      return res.render('admin/login', { error: 'Incorrect username or password.', page: 'login' });
    }
    req.session.regenerate(async (err) => {
      if (err) return next(err);
      req.session.adminId = user.id;
      req.session.adminName = user.display_name;
      await pool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);
      const dest = req.session.returnTo || '/admin';
      delete req.session.returnTo;
      res.redirect(dest);
    });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Everything below requires login.
router.use(requireAuth);

// ---------- Dashboard ----------

router.get('/', async (req, res, next) => {
  try {
    const { rows: products } = await pool.query(
      `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order ASC NULLS LAST, p.sort_order ASC, p.name ASC`
    );
    res.render('admin/dashboard', {
      products, formatLocal, page: 'admin-dashboard', adminName: req.session.adminName
    });
  } catch (err) { next(err); }
});

// Quick AJAX toggle of in-stock status from the dashboard.
router.post('/products/:id/toggle-stock', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE products SET in_stock = NOT in_stock, updated_at = now() WHERE id = $1 RETURNING in_stock',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ in_stock: rows[0].in_stock });
  } catch (err) { next(err); }
});

// ---------- Product CRUD ----------

router.get('/products/new', async (req, res, next) => {
  try {
    const { rows: categories } = await pool.query('SELECT * FROM categories ORDER BY sort_order, name');
    res.render('admin/product-form', { product: null, categories, error: null, page: 'admin-products' });
  } catch (err) { next(err); }
});

router.post('/products', upload.single('photo'), async (req, res, next) => {
  try {
    const { name, category_id, description, price, unit, sort_order } = req.body;
    const in_stock = req.body.in_stock === 'on';
    let photo = null, photo_mime = null;
    if (req.file) {
      photo = await sharp(req.file.buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      photo_mime = 'image/jpeg';
    }
    await pool.query(
      `INSERT INTO products (category_id, name, description, price, unit, in_stock, photo, photo_mime, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [category_id || null, name, description, price || 0, unit || 'each', in_stock, photo, photo_mime, sort_order || 0]
    );
    res.redirect('/admin');
  } catch (err) { next(err); }
});

router.get('/products/:id/edit', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).send('Product not found');
    const { rows: categories } = await pool.query('SELECT * FROM categories ORDER BY sort_order, name');
    res.render('admin/product-form', { product: rows[0], categories, error: null, page: 'admin-products' });
  } catch (err) { next(err); }
});

router.post('/products/:id', upload.single('photo'), async (req, res, next) => {
  try {
    const { name, category_id, description, price, unit, sort_order, remove_photo } = req.body;
    const in_stock = req.body.in_stock === 'on';

    const fields = [category_id || null, name, description, price || 0, unit || 'each', in_stock, sort_order || 0];
    let query = `UPDATE products SET category_id=$1, name=$2, description=$3, price=$4, unit=$5, in_stock=$6, sort_order=$7, updated_at=now()`;

    if (req.file) {
      const photo = await sharp(req.file.buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      query += `, photo=$8, photo_mime=$9 WHERE id=$10`;
      fields.push(photo, 'image/jpeg', req.params.id);
    } else if (remove_photo === 'on') {
      query += `, photo=NULL, photo_mime=NULL WHERE id=$8`;
      fields.push(req.params.id);
    } else {
      query += ` WHERE id=$8`;
      fields.push(req.params.id);
    }

    await pool.query(query, fields);
    res.redirect('/admin');
  } catch (err) { next(err); }
});

router.post('/products/:id/delete', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.redirect('/admin');
  } catch (err) { next(err); }
});

// ---------- Categories ----------

router.get('/categories', async (req, res, next) => {
  try {
    const { rows: categories } = await pool.query(
      `SELECT c.*, COUNT(p.id) AS product_count FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.sort_order, c.name`
    );
    res.render('admin/categories', { categories, error: null, page: 'admin-categories' });
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { name, sort_order } = req.body;
    await pool.query('INSERT INTO categories (name, sort_order) VALUES ($1, $2)', [name, sort_order || 0]);
    res.redirect('/admin/categories');
  } catch (err) { next(err); }
});

router.post('/categories/:id', async (req, res, next) => {
  try {
    const { name, sort_order } = req.body;
    await pool.query('UPDATE categories SET name = $1, sort_order = $2 WHERE id = $3', [name, sort_order || 0, req.params.id]);
    res.redirect('/admin/categories');
  } catch (err) { next(err); }
});

router.post('/categories/:id/delete', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.redirect('/admin/categories');
  } catch (err) { next(err); }
});

// ---------- Site settings ----------

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('admin/settings', { settings, saved: req.query.saved === '1', page: 'admin-settings' });
  } catch (err) { next(err); }
});

router.post('/settings', async (req, res, next) => {
  try {
    const fields = ['farm_name', 'tagline', 'address_line1', 'address_line2', 'phone', 'email', 'hours', 'about_text', 'facebook_url', 'home_lede', 'products_intro', 'visit_note'];
    for (const f of fields) {
      if (typeof req.body[f] !== 'undefined') await setSetting(f, req.body[f]);
    }
    res.redirect('/admin/settings?saved=1');
  } catch (err) { next(err); }
});

// ---------- Admin user management ----------

router.get('/users', async (req, res, next) => {
  try {
    const { rows: users } = await pool.query('SELECT id, username, display_name, created_at, last_login_at FROM admin_users ORDER BY id');
    res.render('admin/users', { users, formatLocal, error: null, currentId: req.session.adminId, page: 'admin-users' });
  } catch (err) { next(err); }
});

router.post('/users', async (req, res, next) => {
  try {
    const { username, display_name, password } = req.body;
    if (!password || password.length < 8) {
      const { rows: users } = await pool.query('SELECT id, username, display_name, created_at, last_login_at FROM admin_users ORDER BY id');
      return res.render('admin/users', { users, formatLocal, error: 'Password must be at least 8 characters.', currentId: req.session.adminId, page: 'admin-users' });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query('INSERT INTO admin_users (username, password_hash, display_name) VALUES ($1,$2,$3)', [username, hash, display_name]);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

router.post('/users/:id/delete', async (req, res, next) => {
  try {
    if (parseInt(req.params.id, 10) === req.session.adminId) {
      return res.redirect('/admin/users');
    }
    const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(countRows[0].count, 10) <= 1) return res.redirect('/admin/users');
    await pool.query('DELETE FROM admin_users WHERE id = $1', [req.params.id]);
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});

// ---------- My account / change password ----------

router.get('/account', (req, res) => {
  res.render('admin/account', { error: null, saved: req.query.saved === '1', page: 'admin-account' });
});

router.post('/account/password', async (req, res, next) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const { rows } = await pool.query('SELECT * FROM admin_users WHERE id = $1', [req.session.adminId]);
    const user = rows[0];
    const ok = await bcrypt.compare(current_password || '', user.password_hash);
    if (!ok) return res.render('admin/account', { error: 'Current password is incorrect.', saved: false, page: 'admin-account' });
    if (!new_password || new_password.length < 8) {
      return res.render('admin/account', { error: 'New password must be at least 8 characters.', saved: false, page: 'admin-account' });
    }
    if (new_password !== confirm_password) {
      return res.render('admin/account', { error: 'New password and confirmation do not match.', saved: false, page: 'admin-account' });
    }
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, req.session.adminId]);
    res.redirect('/admin/account?saved=1');
  } catch (err) { next(err); }
});

module.exports = router;
