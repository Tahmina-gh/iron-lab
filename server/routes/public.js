const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { run, get, all } = require('../db');
const L = require('../lib');
const r = express.Router();

const authLimit = L.rateLimit('auth', 10, 60e3);
const formLimit = L.rateLimit('form', 5, 10 * 60e3);
const newCode = () => 'IL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const publicUser = (u) => u && ({ id: u.id, email: u.email, role: u.role, name: u.name, phone: u.phone, photo_url: u.photo_url, member_code: u.member_code, email_verified: !!u.email_verified });
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// ================= AUTH =================
r.post('/auth/signup', authLimit, L.wrap((req, res) => {
  const { email, password, name, phone } = req.body || {};
  if (!L.str(name, 80)) throw L.bad('Please enter your name.');
  if (!L.isEmail(email)) throw L.bad('Please enter a valid email address.');
  if (!L.isStrongPassword(password)) throw L.bad('Password must be at least 8 characters and include a letter and a number.');
  if (phone && !L.isPhone(phone)) throw L.bad('Please enter a valid phone number.');
  if (get('SELECT id FROM users WHERE email=?', [email.toLowerCase()])) throw new L.HttpError(409, 'An account with that email already exists.');
  const verify = crypto.randomBytes(24).toString('hex');
  const id = run('INSERT INTO users (email,password_hash,role,name,phone,member_code,verify_token) VALUES (?,?,?,?,?,?,?)',
    [email.toLowerCase(), bcrypt.hashSync(password, 10), 'member', L.str(name, 80), phone ? L.str(phone, 20) : null, newCode(), verify]).lastInsertRowid;
  L.sendEmail(email, 'Welcome to Iron Lab — verify your email', `Welcome, ${L.str(name, 80)}!\n\nVerify your email: ${baseUrl(req)}/verify.html?token=${verify}`);
  L.notify(id, 'welcome', 'Welcome to Iron Lab! Pick a membership to start booking classes.');
  const user = get('SELECT * FROM users WHERE id=?', [id]);
  L.issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

r.post('/auth/login', authLimit, L.wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = L.isEmail(email) ? get('SELECT * FROM users WHERE email=?', [email.toLowerCase()]) : null;
  const ok = bcrypt.compareSync(String(password || ''), u ? u.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin'); // always compare (timing)
  if (!u || !ok) throw new L.HttpError(401, 'Incorrect email or password.');
  if (u.status !== 'active') throw new L.HttpError(403, 'This account has been suspended. Please contact the gym.');
  L.issueSession(res, u);
  res.json({ user: publicUser(u) });
}));

r.post('/auth/logout', (_req, res) => { res.clearCookie(L.COOKIE, { path: '/' }); res.json({ ok: true }); });
r.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) || null }));

r.post('/auth/verify-email', L.wrap((req, res) => {
  const t = L.str(req.body && req.body.token, 100);
  const u = t && get('SELECT id FROM users WHERE verify_token=?', [t]);
  if (!u) throw L.bad('That verification link is invalid or has already been used.');
  run('UPDATE users SET email_verified=1, verify_token=NULL WHERE id=?', [u.id]);
  res.json({ ok: true });
}));

r.post('/auth/forgot-password', authLimit, L.wrap((req, res) => {
  const { email } = req.body || {};
  if (!L.isEmail(email)) throw L.bad('Please enter a valid email address.');
  const u = get('SELECT id,name FROM users WHERE email=?', [email.toLowerCase()]);
  if (u) {
    const token = crypto.randomBytes(24).toString('hex');
    run('UPDATE users SET reset_token=?, reset_token_expires=? WHERE id=?', [crypto.createHash('sha256').update(token).digest('hex'), Date.now() + 3600e3, u.id]);
    L.sendEmail(email, 'Reset your Iron Lab password', `Hi ${u.name},\n\nReset your password (valid for 1 hour): ${baseUrl(req)}/reset.html?token=${token}\n\nIf you didn't ask for this, ignore this email.`);
  }
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' }); // identical either way (no account enumeration)
}));

r.post('/auth/reset-password', authLimit, L.wrap((req, res) => {
  const { token, password } = req.body || {};
  if (!L.isStrongPassword(password)) throw L.bad('Password must be at least 8 characters and include a letter and a number.');
  const hashed = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const u = get('SELECT id FROM users WHERE reset_token=? AND reset_token_expires > ?', [hashed, Date.now()]);
  if (!u) throw L.bad('That reset link is invalid or has expired.');
  run('UPDATE users SET password_hash=?, reset_token=NULL, reset_token_expires=NULL WHERE id=?', [bcrypt.hashSync(password, 10), u.id]);
  res.json({ ok: true });
}));

r.post('/auth/change-password', L.requireAuth, authLimit, L.wrap((req, res) => {
  const { current, password } = req.body || {};
  const u = get('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) throw L.bad('Your current password is incorrect.');
  if (!L.isStrongPassword(password)) throw L.bad('New password must be at least 8 characters and include a letter and a number.');
  run('UPDATE users SET password_hash=? WHERE id=?', [bcrypt.hashSync(password, 10), req.user.id]);
  res.json({ ok: true });
}));

r.patch('/auth/profile', L.requireAuth, L.wrap((req, res) => {
  const { name, phone } = req.body || {};
  if (name !== undefined && !L.str(name, 80)) throw L.bad('Name cannot be empty.');
  if (phone && !L.isPhone(phone)) throw L.bad('Please enter a valid phone number.');
  run('UPDATE users SET name=COALESCE(?,name), phone=? WHERE id=?', [name ? L.str(name, 80) : null, phone ? L.str(phone, 20) : null, req.user.id]);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id=?', [req.user.id])) });
}));

// Secure image upload: base64 JSON, allow-listed types verified by magic bytes, random filenames, size cap.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function saveImage(dataUrl, maxBytes = 3 * 1024 * 1024) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw L.bad('Please upload a JPG, PNG or WebP image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw L.bad('Image is too large (max 3 MB).');
  if (!MAGIC[m[1]].every((b, i) => buf[i] === b)) throw L.bad('That file does not look like a valid image.');
  const name = crypto.randomBytes(12).toString('hex') + '.' + EXT[m[1]];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}
r.post('/auth/photo', L.requireAuth, L.wrap((req, res) => {
  const url = saveImage(req.body && req.body.image);
  run('UPDATE users SET photo_url=? WHERE id=?', [url, req.user.id]);
  res.json({ photo_url: url });
}));
r.saveImage = saveImage;

// ================= PUBLIC CONTENT (CMS-driven marketing site) =================
r.get('/public/content', (_req, res) => {
  res.json({
    settings: Object.fromEntries(all('SELECT key,value FROM settings WHERE key!=\'quiz_rules\'').map((s) => [s.key, s.value])),
    plans: all("SELECT * FROM membership_plans WHERE status='active' AND name NOT LIKE '% Annual' ORDER BY monthly_price"),
    trainers: all(`SELECT t.id,u.name,u.photo_url,t.specialty,t.bio,t.experience_years,t.certifications,t.session_price
                   FROM trainers t JOIN users u ON u.id=t.user_id WHERE t.status='active' AND u.status='active'`),
    testimonials: all('SELECT id,member_name,goal,duration,result,rating,photo_url FROM testimonials WHERE published=1'),
    facilities: all('SELECT * FROM facilities ORDER BY sort_order'),
    faqs: all('SELECT * FROM faqs ORDER BY sort_order'),
  });
});

// privacy-friendly analytics: event name only, no personal data
const EVENTS = new Set(['page_view', 'trial_submit', 'tour_book', 'membership_purchase', 'class_book', 'trainer_book']);
r.post('/track', L.rateLimit('track', 60, 60e3), (req, res) => {
  const n = req.body && req.body.event;
  if (EVENTS.has(n)) run('INSERT INTO analytics_events (name) VALUES (?)', [n]);
  res.json({ ok: true });
});

// ================= LEADS: trial / tour / contact =================
const honeypot = (req) => { if (req.body && req.body.website) throw L.bad('Submission rejected.'); };

r.post('/trials', formLimit, L.wrap((req, res) => {
  honeypot(req);
  const b = req.body || {};
  if (!L.str(b.name, 80)) throw L.bad('Please enter your name.');
  if (!L.isEmail(b.email)) throw L.bad('Please enter a valid email address.');
  if (!L.isPhone(b.phone)) throw L.bad('Please enter a valid phone number.');
  if (b.age !== undefined && b.age !== '' && !(Number(b.age) >= 14 && Number(b.age) <= 100)) throw L.bad('Age must be between 14 and 100.');
  if (!L.isDate(b.preferred_date) || b.preferred_date < L.ymd(new Date())) throw L.bad('Please choose a preferred date that is today or later.');
  if (b.preferred_time && !L.isTime(b.preferred_time)) throw L.bad('Please choose a valid time.');
  if (get("SELECT id FROM trial_leads WHERE email=? AND created_at > datetime('now','-1 day')", [b.email.toLowerCase()])) throw new L.HttpError(409, 'We already have a trial request from this email — we will be in touch shortly.');
  const id = run(`INSERT INTO trial_leads (name,email,phone,age,goal,preferred_date,preferred_time,experience_level) VALUES (?,?,?,?,?,?,?,?)`,
    [L.str(b.name, 80), b.email.toLowerCase(), L.str(b.phone, 20), b.age ? Number(b.age) : null, L.str(b.goal, 100), b.preferred_date, b.preferred_time || null, L.str(b.experience_level, 40)]).lastInsertRowid;
  L.notifyAdmins('lead', `New free-trial lead: ${L.str(b.name, 80)} (${b.email})`);
  L.sendEmail(b.email, 'Your Iron Lab free trial request', `Hi ${L.str(b.name, 80)},\n\nThanks for requesting a free trial on ${b.preferred_date}. Our team will confirm your session shortly.\n\n— Iron Lab`);
  run("INSERT INTO analytics_events (name) VALUES ('trial_submit')");
  res.status(201).json({ ok: true, id, message: 'Your free trial request has been received. We will confirm shortly.' });
}));

r.post('/tours', formLimit, L.wrap((req, res) => {
  honeypot(req);
  const b = req.body || {};
  if (!L.str(b.name, 80)) throw L.bad('Please enter your name.');
  if (!L.isEmail(b.email)) throw L.bad('Please enter a valid email address.');
  if (!L.isPhone(b.phone)) throw L.bad('Please enter a valid phone number.');
  if (!L.isDate(b.date) || b.date < L.ymd(new Date())) throw L.bad('Please choose a date that is today or later.');
  if (!L.isTime(b.time)) throw L.bad('Please choose a valid time.');
  if (get("SELECT id FROM tour_bookings WHERE date=? AND time=? AND status IN ('pending','approved','rescheduled')", [b.date, b.time])) throw new L.HttpError(409, 'That tour time is no longer available. Please pick another.');
  const id = run('INSERT INTO tour_bookings (name,email,phone,date,time) VALUES (?,?,?,?,?)', [L.str(b.name, 80), b.email.toLowerCase(), L.str(b.phone, 20), b.date, b.time]).lastInsertRowid;
  L.notifyAdmins('tour', `New tour request: ${L.str(b.name, 80)} on ${b.date} at ${b.time}`);
  L.sendEmail(b.email, 'Your Iron Lab tour request', `Hi ${L.str(b.name, 80)},\n\nWe received your tour request for ${b.date} at ${b.time}. We'll confirm shortly.\n\n— Iron Lab`);
  run("INSERT INTO analytics_events (name) VALUES ('tour_book')");
  res.status(201).json({ ok: true, id, message: 'Tour requested — we will confirm by email.' });
}));

r.post('/contact', formLimit, L.wrap((req, res) => {
  honeypot(req);
  const b = req.body || {};
  if (!L.str(b.name, 80)) throw L.bad('Please enter your name.');
  if (!L.isEmail(b.email)) throw L.bad('Please enter a valid email address.');
  if (b.phone && !L.isPhone(b.phone)) throw L.bad('Please enter a valid phone number.');
  if (L.str(b.message, 2000).length < 5) throw L.bad('Please write a short message.');
  run('INSERT INTO contact_messages (name,email,phone,message) VALUES (?,?,?,?)', [L.str(b.name, 80), b.email.toLowerCase(), b.phone ? L.str(b.phone, 20) : null, L.str(b.message, 2000)]);
  L.notifyAdmins('contact', `New message from ${L.str(b.name, 80)}`);
  res.status(201).json({ ok: true, message: 'Message sent — we will reply within one business day.' });
}));

// ================= QUIZ / PROGRAM MATCHING (rules editable by admin via settings.quiz_rules) =================
const DEFAULT_RULES = { elite_if: { style: ['Coached'], freq_and_exp: { freq: ['5+'], exp: ['Advanced'] } }, performance_if: { style: ['Group'], freq: ['3-4'], goal: ['Athletic Performance', 'Improve strength'] } };
r.post('/quiz', L.wrap((req, res) => {
  const b = req.body || {};
  const row = get("SELECT value FROM settings WHERE key='quiz_rules'");
  let rules = DEFAULT_RULES; try { if (row) rules = JSON.parse(row.value); } catch (_) {}
  const has = (arr, v) => Array.isArray(arr) && arr.includes(v);
  const e = rules.elite_if || {}, p = rules.performance_if || {};
  let tier = 'Essential', why = 'A flexible base membership while you build a consistent habit.';
  if (has(e.style, b.style) || (e.freq_and_exp && has(e.freq_and_exp.freq, b.freq) && has(e.freq_and_exp.exp, b.exp))) { tier = 'Elite'; why = 'Frequent training plus coached programming calls for full access and dedicated PT sessions.'; }
  else if (has(p.style, b.style) || has(p.freq, b.freq) || has(p.goal, b.goal)) { tier = 'Performance'; why = 'Regular training and class variety fit best with unlimited classes and monthly coaching.'; }
  const plan = get('SELECT * FROM membership_plans WHERE name=?', [tier]);
  const classTypeByGoal = { 'lose weight': 'HIIT', 'build muscle': 'Strength', 'improve strength': 'Strength', 'improve endurance': 'Cardio', 'improve mobility': 'Yoga', 'athletic performance': 'CrossFit' };
  const type = classTypeByGoal[String(b.goal || '').toLowerCase()] || 'Functional Training';
  const classes = all("SELECT id,name,type,day_of_week,start_time FROM classes WHERE type=? AND status='active' LIMIT 3", [type]);
  const trainer = get(`SELECT t.id,u.name,t.specialty FROM trainers t JOIN users u ON u.id=t.user_id WHERE t.status='active' AND t.specialty LIKE ? LIMIT 1`, ['%' + type.split(' ')[0] + '%']);
  run('INSERT INTO fitness_goals (user_id,goal,experience_level,days_per_week,preferred_training,available_time,recommended_plan_id) VALUES (?,?,?,?,?,?,?)',
    [req.user ? req.user.id : null, L.str(b.goal, 60), L.str(b.exp, 40), L.str(b.freq, 20), L.str(b.style, 40), L.str(b.time, 40), plan ? plan.id : null]);
  res.json({ plan, why, classes, trainer: trainer || null });
}));

module.exports = r;
