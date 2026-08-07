require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const methodOverride = require('method-override');
const path = require('path');

const { pool, ensureSchema, getSettings } = require('./db/pool');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Railway sits behind a proxy

app.use(helmet({
  contentSecurityPolicy: false // keep simple for server-rendered EJS + inline critical CSS
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'change-me-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12 // 12 hours
  }
}));

// Make current settings/admin session available to every view without repeating queries everywhere.
app.use(async (req, res, next) => {
  res.locals.isLoggedIn = !!req.session.adminId;
  res.locals.adminName = req.session.adminName || null;
  res.locals.currentPath = req.path;
  next();
});

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.use((req, res) => {
  res.status(404).render('404', { page: '404' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { page: '500', message: isProd ? null : err.message });
});

ensureSchema()
  .then(async () => {
    await getSettings(); // warms up / confirms DB connectivity on boot
    app.listen(PORT, () => console.log(`Sunflower Corners running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
