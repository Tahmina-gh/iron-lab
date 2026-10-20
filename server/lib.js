// server/lib.js — validation, security middleware, and provider adapters.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { run, get, all } = require('./db');

const IS_PROD = process.env.NODE_ENV === 'production';
const AUTH_SECRET = process.env.AUTH_SECRET || (() => {
  if (IS_PROD) { console.error('FATAL: AUTH_SECRET must be set in production'); process.exit(1); }
  console.warn('[warn] AUTH_SECRET not set — using an ephemeral dev secret (sessions reset on restart).');
  return crypto.randomBytes(32).toString('hex');
})();

// ---------- validation ----------
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const isPhone = (v) => typeof v === 'string' && /^[+()\d][\d\s().-]{6,19}$/.test(v);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isStrongPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 128 && /[a-z]/i.test(v) && /\d/.test(v);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

// ---------- rate limiting (in-memory; use a Redis-backed limiter for multi-instance production) ----------
const buckets = new Map();
const RATE_MULT = Number(process.env.RATE_LIMIT_MULTIPLIER) || 1; // tests raise this; leave at 1 in production
const rateLimit = (name, max, windowMs) => (req, res, next) => {
  const key = name + ':' + req.ip;
  const now = Date.now();
  const b = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (b.length >= max * RATE_MULT) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  b.push(now); buckets.set(key, b); next();
};
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();

// ---------- auth ----------
const COOKIE = 'il_token';
function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, AUTH_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 7 * 24 * 3600e3, path: '/' });
}
function loadUser(req, _res, next) {
  const t = req.cookies && req.cookies[COOKIE];
  if (t) {
    try {
      const p = jwt.verify(t, AUTH_SECRET);
      const u = get('SELECT id,email,role,name,phone,photo_url,member_code,email_verified,status,created_at FROM users WHERE id=?', [p.sub]);
      if (u && u.status === 'active') req.user = u;
    } catch (_) { /* invalid/expired token => anonymous */ }
  }
  next();
}
const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue.')));
const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do that.'));
  next();
};
// CSRF defence for cookie auth: state-changing requests must be JSON (can't be forged cross-site without a CORS
// preflight, which we never allow) and, if an Origin header is present, it must match our host.
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/payments/webhook')) return next();
  const origin = req.get('origin');
  if (origin) { let host; try { host = new URL(origin).host; } catch (_) { host = ''; } if (host !== req.get('host')) return next(new HttpError(403, 'Cross-origin request blocked.')); }
  if (!req.is('application/json')) return next(new HttpError(415, 'Requests must be JSON.'));
  next();
}

// ---------- notifications + email ----------
async function sendEmail(to, subject, text) {
  const line = `[email → ${to}] ${subject}`;
  if (process.env.RESEND_API_KEY) {
    // Production transport (Resend REST API). UNTESTED here — needs your own API key + a verified sending domain.
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Iron Lab <no-reply@example.com>', to, subject, text }),
      });
      if (!r.ok) console.error(line, 'FAILED', r.status);
    } catch (e) { console.error(line, 'FAILED', e.message); }
    return;
  }
  console.log(line + '\n' + text.split('\n').map((l) => '    ' + l).join('\n')); // dev transport: logged, NOT sent
}
async function sendSms(_to, _body) { return false; } // hook for Twilio/WhatsApp; intentionally unimplemented without credentials

function notify(userId, type, message, emailSubject) {
  run('INSERT INTO notifications (user_id,type,message) VALUES (?,?,?)', [userId, type, message]);
  const u = get('SELECT email,name FROM users WHERE id=?', [userId]);
  if (u && emailSubject) sendEmail(u.email, emailSubject, `Hi ${u.name},\n\n${message}\n\n— Iron Lab`).catch(() => {});
}
function notifyAdmins(type, message) {
  all("SELECT id FROM users WHERE role='admin' AND status='active'").forEach((a) => run('INSERT INTO notifications (user_id,type,message) VALUES (?,?,?)', [a.id, type, message]));
}

// ---------- payments (adapter) ----------
// PAYMENT_PROVIDER=mock (default): instantly "succeeds" — NO real money moves. For local development only.
// PAYMENT_PROVIDER=stripe: creates a hosted Stripe Checkout Session (card data never touches this server); the
//   webhook route marks the payment succeeded. UNTESTED here — needs STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET.
const PROVIDER = process.env.PAYMENT_PROVIDER || 'mock';
async function startPayment({ amount, description, userEmail, successUrl, cancelUrl, metadata }) {
  if (PROVIDER === 'stripe') {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new HttpError(503, 'Payments are not configured (missing STRIPE_SECRET_KEY).');
    const form = new URLSearchParams({ mode: 'payment', success_url: successUrl, cancel_url: cancelUrl, customer_email: userEmail,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)), 'line_items[0][price_data][product_data][name]': description });
    Object.entries(metadata || {}).forEach(([k, v]) => form.append(`metadata[${k}]`, String(v)));
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const j = await r.json();
    if (!r.ok) throw new HttpError(502, 'Payment provider error: ' + (j.error && j.error.message || r.status));
    return { provider: 'stripe', status: 'pending', txnId: j.id, redirectUrl: j.url };
  }
  return { provider: 'mock', status: 'succeeded', txnId: 'mock_' + crypto.randomBytes(6).toString('hex') };
}
function verifyStripeSignature(rawBody, header, secret) {
  const parts = Object.fromEntries((header || '').split(',').map((kv) => kv.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

// ---------- misc ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function activeMembership(userId) {
  return get(`SELECT m.*, p.name plan_name, p.pt_sessions_included, p.guest_passes, p.classes_included
              FROM memberships m JOIN membership_plans p ON p.id=m.plan_id
              WHERE m.user_id=? AND m.status='active' AND m.payment_status='paid' AND m.expiration_date >= date('now')
              ORDER BY m.expiration_date DESC LIMIT 1`, [userId]);
}

module.exports = { HttpError, bad, isEmail, isPhone, isDate, isTime, str, isStrongPassword, rateLimit, issueSession, loadUser,
  requireAuth, requireRole, csrfGuard, COOKIE, notify, notifyAdmins, sendEmail, sendSms, startPayment, verifyStripeSignature,
  PROVIDER, ymd, addMonths, wrap, activeMembership, AUTH_SECRET, IS_PROD };
