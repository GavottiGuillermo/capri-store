const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || null;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || null;
const JWT_SECRET = process.env.JWT_SECRET || null;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

const COOKIE_NAME = 'capri_admin_token';

function isConfigured() {
  return Boolean(ADMIN_USERNAME && ADMIN_PASSWORD_HASH && JWT_SECRET);
}

async function verifyCredentials(username, password) {
  if (!isConfigured()) {
    return false;
  }
  if (!username || !password) {
    return false;
  }
  const passwordMatches = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  return username === ADMIN_USERNAME && passwordMatches;
}

function signAdminToken(username) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET no configurado');
  }
  return jwt.sign({ sub: username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyAdminToken(token) {
  if (!JWT_SECRET || !token) {
    return null;
  }
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

module.exports = {
  isConfigured,
  verifyCredentials,
  signAdminToken,
  verifyAdminToken,
  COOKIE_NAME
};
