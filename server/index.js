require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const L = require('./lib');
const publicRoutes = require('./routes/public');
const memberRoutes = require('./routes/member');
const staffRoutes = require('./routes/staff');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY ? 1 : 0);
// CSP is relaxed because the marketing pages load Google Fonts and stock media; tighten it for your own asset hosts.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cookieParser());
app.use(express.json({ limit: '6mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } })); // raw body kept for webhook signatures
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads'), { setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', L.loadUser, L.csrfGuard);
app.use('/api', publicRoutes);
app.use('/api', memberRoutes);
app.use('/api', staffRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// central error handler: expected errors are shown to the user; unexpected ones are logged and never leaked
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

// background jobs: membership expiry + reminders (hourly)
const sweep = () => { try { memberRoutes.expirySweep(); memberRoutes.reminderSweep(); } catch (e) { console.error('sweep failed', e); } };
sweep(); setInterval(sweep, 3600e3).unref();

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`Iron Lab running → http://localhost:${PORT}  (payments: ${L.PROVIDER})`));
module.exports = app;
