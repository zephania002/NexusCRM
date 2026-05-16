require('dotenv').config();
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'nexuscrm-v4-change-in-production-2025';

function authenticate(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(403).json({ error: 'Token invalid or expired.' }); }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  next();
}

function generateToken(user, tenant) {
  return jwt.sign(
    { id:user.id, name:user.name, email:user.email, role:user.role,
      tenantId:user.tenant_id, plan:tenant.plan, industry:tenant.industry||'general' },
    JWT_SECRET, { expiresIn: '24h' }
  );
}

module.exports = { authenticate, adminOnly, generateToken, JWT_SECRET };
