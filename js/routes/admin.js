const express = require('express');

const auth = require('../services/auth');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

// Freno simple de fuerza bruta en memoria: bloquea una IP tras varios intentos fallidos seguidos.
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutos
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

function getLoginAttemptState(ip) {
  return loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
}

function registerFailedLogin(ip) {
  const state = getLoginAttemptState(ip);
  state.count += 1;
  if (state.count >= MAX_LOGIN_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    state.count = 0;
  }
  loginAttempts.set(ip, state);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

router.post('/login', express.json(), async (req, res) => {
  if (!auth.isConfigured()) {
    console.error('❌ Panel admin: faltan ADMIN_USERNAME / ADMIN_PASSWORD_HASH / JWT_SECRET');
    return res.status(503).json({ success: false, error: 'Panel admin no configurado' });
  }

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const { lockedUntil } = getLoginAttemptState(ip);
  if (lockedUntil && Date.now() < lockedUntil) {
    const secondsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ success: false, error: `Demasiados intentos. Probá de nuevo en ${secondsLeft}s` });
  }

  const { username, password } = req.body || {};
  const valid = await auth.verifyCredentials(username, password);

  if (!valid) {
    registerFailedLogin(ip);
    return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos' });
  }

  clearLoginAttempts(ip);
  const token = auth.signAdminToken(username);
  res.cookie(auth.COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({ success: true, username });
});

router.post('/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME, COOKIE_OPTIONS);
  res.json({ success: true });
});

// GET /admin (navegación directa del navegador, no llamada AJAX): redirige a la
// página de login o al dashboard según haya sesión, en vez de devolver JSON.
router.get('/', (req, res) => {
  const token = req.cookies?.[auth.COOKIE_NAME];
  const payload = auth.verifyAdminToken(token);
  res.redirect(payload ? '/admin.html' : '/admin-login.html');
});

// A partir de acá, todas las rutas de /admin/* requieren sesión válida.
router.use((req, res, next) => {
  const token = req.cookies?.[auth.COOKIE_NAME];
  const payload = auth.verifyAdminToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'No autenticado' });
  }
  req.admin = { username: payload.sub };
  next();
});

router.get('/me', (req, res) => {
  res.json({ success: true, username: req.admin.username });
});

router.use('/articulos-web', require('./admin/articulos-web'));
router.use('/stock', require('./admin/stock'));
router.use('/ventas', require('./admin/ventas'));
router.use('/cashflow', require('./admin/cashflow'));

module.exports = router;
