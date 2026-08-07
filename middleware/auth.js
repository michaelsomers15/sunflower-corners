function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/admin/login');
}

module.exports = { requireAuth };
