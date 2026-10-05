const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const { pool, getSettings, setSetting } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { formatLocal } = require('../middleware/localTime');
const { isSafeUrl, isAmazonUrl, withAffiliateTag, TAG_FORMAT } = require('../lib/affiliate');

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

// The three stock states a size/variant can be in. 'coming_soon' covers
// items that are out right now but expected back (next harvest, next boil,
// next batch) — its public wording is editable via the coming_soon_label
// site setting.
const STOCK_STATUSES = ['in_stock', 'sold_out', 'coming_soon'];

function normalizeStatus(v) {
  if (STOCK_STATUSES.includes(v.status)) return v.status;
  // Older clients only sent the boolean in_stock flag.
  if (v.in_stock === false || v.in_stock === 'false') return 'sold_out';
  return 'in_stock';
}

// Parses the JSON-encoded list of {label, price, status} sent by the
// product form's hidden "variants_json" field (built client-side from the
// dynamic size rows). Falls back to a single default-priced variant if
// nothing usable was submitted, so a product can never end up with zero
// sizes.
function parseVariants(raw) {
  let list = [];
  try {
    list = JSON.parse(raw || '[]');
  } catch (e) {
    list = [];
  }
  const cleaned = list
    .filter((v) => v && String(v.label || '').trim().length > 0)
    .map((v) => ({
      label: String(v.label).trim().slice(0, 80),
      price: Number.parseFloat(v.price) || 0,
      status: normalizeStatus(v)
    }));
  if (cleaned.length === 0) {
    cleaned.push({ label: 'each', price: 0, status: 'in_stock' });
  }
  return cleaned;
}

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
      `SELECT p.*, c.name AS category_name,
         COALESCE((
           SELECT json_agg(json_build_object('id', v.id, 'label', v.label, 'price', v.price, 'status', v.status) ORDER BY v.sort_order, v.id)
           FROM product_variants v WHERE v.product_id = p.id
         ), '[]') AS variants
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order ASC NULLS LAST, p.sort_order ASC, p.name ASC`
    );
    const settings = await getSettings();
    res.render('admin/dashboard', {
      products, settings, formatLocal, page: 'admin-dashboard', adminName: req.session.adminName
    });
  } catch (err) { next(err); }
});

// Quick AJAX update of stock status (In Stock / Sold Out / Coming Soon) for
// one size/variant from the dashboard dropdown.
router.post('/variants/:id/status', async (req, res, next) => {
  try {
    const status = req.body && req.body.status;
    if (!STOCK_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows } = await pool.query(
      `UPDATE product_variants SET status = $1, in_stock = $2, updated_at = now()
       WHERE id = $3 RETURNING status`,
      [status, status === 'in_stock', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ status: rows[0].status });
  } catch (err) { next(err); }
});

// Quick AJAX toggle of public visibility from the dashboard — hides an item
// (out of season, discontinued, on hold indefinitely) from the public site
// without deleting it, so it's easy to bring back later.
router.post('/products/:id/toggle-visible', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE products SET visible = NOT visible, updated_at = now() WHERE id = $1 RETURNING visible',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ visible: rows[0].visible });
  } catch (err) { next(err); }
});

// ---------- Product CRUD ----------

router.get('/products/new', async (req, res, next) => {
  try {
    const { rows: categories } = await pool.query('SELECT * FROM categories ORDER BY sort_order, name');
    const settings = await getSettings();
    res.render('admin/product-form', { product: null, variants: [], categories, settings, error: null, page: 'admin-products' });
  } catch (err) { next(err); }
});

router.post('/products', upload.single('photo'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, category_id, description, sort_order } = req.body;
    const visible = req.body.visible === 'on';
    const variants = parseVariants(req.body.variants_json);
    let photo = null, photo_mime = null;
    if (req.file) {
      photo = await sharp(req.file.buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      photo_mime = 'image/jpeg';
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO products (category_id, name, description, visible, photo, photo_mime, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [category_id || null, name, description, visible, photo, photo_mime, sort_order || 0]
    );
    const productId = rows[0].id;
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      await client.query(
        `INSERT INTO product_variants (product_id, label, price, in_stock, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [productId, v.label, v.price, v.status === 'in_stock', v.status, i]
      );
    }
    await client.query('COMMIT');
    res.redirect('/admin');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

router.get('/products/:id/edit', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).send('Product not found');
    const { rows: variants } = await pool.query(
      'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order, id',
      [req.params.id]
    );
    const { rows: categories } = await pool.query('SELECT * FROM categories ORDER BY sort_order, name');
    const settings = await getSettings();
    res.render('admin/product-form', { product: rows[0], variants, categories, settings, error: null, page: 'admin-products' });
  } catch (err) { next(err); }
});

router.post('/products/:id', upload.single('photo'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, category_id, description, sort_order, remove_photo } = req.body;
    const visible = req.body.visible === 'on';
    const variants = parseVariants(req.body.variants_json);

    const fields = [category_id || null, name, description, visible, sort_order || 0];
    let query = `UPDATE products SET category_id=$1, name=$2, description=$3, visible=$4, sort_order=$5, updated_at=now()`;

    if (req.file) {
      const photo = await sharp(req.file.buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      query += `, photo=$6, photo_mime=$7 WHERE id=$8`;
      fields.push(photo, 'image/jpeg', req.params.id);
    } else if (remove_photo === 'on') {
      query += `, photo=NULL, photo_mime=NULL WHERE id=$6`;
      fields.push(req.params.id);
    } else {
      query += ` WHERE id=$6`;
      fields.push(req.params.id);
    }

    await client.query('BEGIN');
    await client.query(query, fields);
    // Replace the full variant set on every save — simplest way to handle
    // added/removed/reordered sizes from one form submission.
    await client.query('DELETE FROM product_variants WHERE product_id = $1', [req.params.id]);
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      await client.query(
        `INSERT INTO product_variants (product_id, label, price, in_stock, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, v.label, v.price, v.status === 'in_stock', v.status, i]
      );
    }
    await client.query('COMMIT');
    res.redirect('/admin');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
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

// ---------- Amazon affiliate "Our Picks" ----------

async function processPhoto(file) {
  if (!file) return null;
  return sharp(file.buffer).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

function pickFromBody(body) {
  return {
    section: String(body.section || '').trim().slice(0, 100) || 'Recommended',
    title: String(body.title || '').trim().slice(0, 150),
    description: String(body.description || '').trim(),
    url: String(body.url || '').trim(),
    visible: body.visible === 'on',
    sort_order: Number.parseInt(body.sort_order, 10) || 0
  };
}

function validatePick(pick) {
  if (!pick.title) return 'Please enter a name for the item.';
  if (!isSafeUrl(pick.url)) return 'Please paste a full link starting with https:// (copy it from the Amazon page or the SiteStripe bar).';
  return null;
}

async function renderPickForm(res, pick, error) {
  const settings = await getSettings();
  const { rows: sections } = await pool.query('SELECT DISTINCT section FROM affiliate_links ORDER BY section');
  res.render('admin/pick-form', {
    pick, error, settings, sectionNames: sections.map((r) => r.section), page: 'admin-picks'
  });
}

router.get('/picks', async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { rows } = await pool.query(
      `SELECT id, section, title, url, visible, sort_order, updated_at, (photo IS NOT NULL) AS has_photo
       FROM affiliate_links ORDER BY section ASC, sort_order ASC, title ASC`
    );
    const picks = rows.map((r) => ({ ...r, href: withAffiliateTag(r.url, settings.amazon_tag), isAmazon: isAmazonUrl(r.url) }));
    res.render('admin/picks', { picks, settings, formatLocal, page: 'admin-picks' });
  } catch (err) { next(err); }
});

router.get('/picks/new', async (req, res, next) => {
  try {
    await renderPickForm(res, null, null);
  } catch (err) { next(err); }
});

router.post('/picks', upload.single('photo'), async (req, res, next) => {
  try {
    const pick = pickFromBody(req.body);
    const error = validatePick(pick);
    if (error) return renderPickForm(res, { ...pick, id: null }, error);
    const photo = await processPhoto(req.file);
    await pool.query(
      `INSERT INTO affiliate_links (section, title, description, url, visible, sort_order, photo, photo_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [pick.section, pick.title, pick.description, pick.url, pick.visible, pick.sort_order, photo, photo ? 'image/jpeg' : null]
    );
    res.redirect('/admin/picks');
  } catch (err) { next(err); }
});

router.get('/picks/:id/edit', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, section, title, description, url, visible, sort_order, (photo IS NOT NULL) AS has_photo FROM affiliate_links WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Pick not found');
    await renderPickForm(res, rows[0], null);
  } catch (err) { next(err); }
});

router.post('/picks/:id', upload.single('photo'), async (req, res, next) => {
  try {
    const pick = pickFromBody(req.body);
    const error = validatePick(pick);
    if (error) {
      const { rows } = await pool.query('SELECT (photo IS NOT NULL) AS has_photo FROM affiliate_links WHERE id = $1', [req.params.id]);
      return renderPickForm(res, { ...pick, id: req.params.id, has_photo: rows.length && rows[0].has_photo }, error);
    }
    const fields = [pick.section, pick.title, pick.description, pick.url, pick.visible, pick.sort_order];
    let query = `UPDATE affiliate_links SET section=$1, title=$2, description=$3, url=$4, visible=$5, sort_order=$6, updated_at=now()`;
    const photo = await processPhoto(req.file);
    if (photo) {
      query += `, photo=$7, photo_mime='image/jpeg' WHERE id=$8`;
      fields.push(photo, req.params.id);
    } else if (req.body.remove_photo === 'on') {
      query += `, photo=NULL, photo_mime=NULL WHERE id=$7`;
      fields.push(req.params.id);
    } else {
      query += ` WHERE id=$7`;
      fields.push(req.params.id);
    }
    await pool.query(query, fields);
    res.redirect('/admin/picks');
  } catch (err) { next(err); }
});

router.post('/picks/:id/toggle-visible', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE affiliate_links SET visible = NOT visible, updated_at = now() WHERE id = $1 RETURNING visible',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ visible: rows[0].visible });
  } catch (err) { next(err); }
});

router.post('/picks/:id/delete', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM affiliate_links WHERE id = $1', [req.params.id]);
    res.redirect('/admin/picks');
  } catch (err) { next(err); }
});

// ---------- Site settings ----------

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('admin/settings', { settings, saved: req.query.saved === '1', error: null, page: 'admin-settings' });
  } catch (err) { next(err); }
});

router.post('/settings', async (req, res, next) => {
  try {
    const fields = ['farm_name', 'tagline', 'address_line1', 'address_line2', 'phone', 'email', 'hours', 'about_text', 'facebook_url', 'home_lede', 'products_intro', 'visit_note', 'coming_soon_label', 'picks_intro'];
    for (const f of fields) {
      if (typeof req.body[f] !== 'undefined') await setSetting(f, req.body[f]);
    }
    // Associate tag: trimmed and only saved if it looks like a real tag
    // (letters, numbers, dashes — e.g. "sunflowercorn-20"), so a stray
    // space or pasted URL can't break every Amazon link on the site.
    if (typeof req.body.amazon_tag !== 'undefined') {
      const tag = String(req.body.amazon_tag).trim();
      if (tag === '' || TAG_FORMAT.test(tag)) {
        await setSetting('amazon_tag', tag);
      } else {
        const settings = await getSettings();
        return res.render('admin/settings', {
          settings: { ...settings, amazon_tag: tag }, saved: false, page: 'admin-settings',
          error: 'Amazon Associate tag should look like "yourname-20" (letters, numbers, and dashes only). Other settings were saved; the tag was not.'
        });
      }
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
