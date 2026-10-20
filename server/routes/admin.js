const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { run, get, all, tx } = require('../db');
const L = require('../lib');
const pub = require('./public');
const r = express.Router();
r.use(L.requireRole('admin'));

const monthStart = () => L.ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const lastMonths = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (n - 1 - i)); return d.toISOString().slice(0, 7); });
const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return L.ymd(d); });
const fill = (keys, rows) => { const m = Object.fromEntries(rows.map((x) => [x.k, x.v])); return keys.map((key) => ({ label: key, value: m[key] || 0 })); };

// ================= DASHBOARD =================
r.get('/stats', (_req, res) => {
  const today = L.ymd(new Date()); const ms = monthStart();
  const n = (sql, p = []) => get(sql, p).n || 0;
  const months = lastMonths(6); const days = lastDays(14);
  const ev = Object.fromEntries(all('SELECT name, COUNT(*) n FROM analytics_events GROUP BY name').map((e) => [e.name, e.n]));
  const views = ev.page_view || 0;
  res.json({
    kpis: {
      total_members: n("SELECT COUNT(*) n FROM users WHERE role='member'"),
      active_members: n("SELECT COUNT(DISTINCT user_id) n FROM memberships WHERE status='active' AND payment_status='paid' AND expiration_date>=date('now')"),
      new_members: n("SELECT COUNT(*) n FROM users WHERE role='member' AND date(created_at)>=?", [ms]),
      todays_attendance: n('SELECT COUNT(DISTINCT user_id) n FROM attendance WHERE date=?', [today]),
      todays_bookings: n("SELECT COUNT(*) n FROM class_bookings WHERE class_date=? AND status='booked'", [today]) + n("SELECT COUNT(*) n FROM trainer_sessions WHERE date=? AND status='booked'", [today]),
      monthly_revenue: get("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='succeeded' AND date(created_at)>=?", [ms]).n,
      pending_payments: n("SELECT COUNT(*) n FROM payments WHERE status='pending'"),
      free_trial_leads: n("SELECT COUNT(*) n FROM trial_leads WHERE status='new'"),
      tour_bookings: n("SELECT COUNT(*) n FROM tour_bookings WHERE status IN ('pending','approved','rescheduled') AND date>=?", [today]),
      unread_messages: n("SELECT COUNT(*) n FROM contact_messages WHERE status='new'"),
    },
    charts: {
      revenue: fill(months, all("SELECT substr(created_at,1,7) k, SUM(amount) v FROM payments WHERE status='succeeded' GROUP BY k")),
      member_growth: fill(months, all("SELECT substr(created_at,1,7) k, COUNT(*) v FROM users WHERE role='member' GROUP BY k")),
      attendance: fill(days, all('SELECT date k, COUNT(DISTINCT user_id) v FROM attendance GROUP BY date')),
      bookings: fill(days, all("SELECT class_date k, COUNT(*) v FROM class_bookings WHERE status='booked' GROUP BY class_date")),
      leads: fill(months, all('SELECT substr(created_at,1,7) k, COUNT(*) v FROM trial_leads GROUP BY k')),
    },
    analytics: { events: ev, page_views: views, conversion: { trial_rate: views ? +(100 * (ev.trial_submit || 0) / views).toFixed(1) : null, purchase_rate: views ? +(100 * (ev.membership_purchase || 0) / views).toFixed(1) : null } },
  });
});

// ================= MEMBERS =================
r.get('/members', (req, res) => {
  const q = '%' + L.str(req.query.q, 60) + '%'; const page = Math.max(1, Number(req.query.page) || 1); const size = 15;
  const status = ['active', 'suspended'].includes(req.query.status) ? req.query.status : null;
  const where = "u.role='member' AND (u.name LIKE ? OR u.email LIKE ? OR u.member_code LIKE ?)" + (status ? ' AND u.status=?' : '');
  const params = [q, q, q].concat(status ? [status] : []);
  const total = get(`SELECT COUNT(*) n FROM users u WHERE ${where}`, params).n;
  const rows = all(`SELECT u.id,u.name,u.email,u.phone,u.status,u.member_code,u.created_at,
      (SELECT p.name FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.user_id=u.id AND m.status='active' ORDER BY m.expiration_date DESC LIMIT 1) plan,
      (SELECT m.expiration_date FROM memberships m WHERE m.user_id=u.id AND m.status='active' ORDER BY m.expiration_date DESC LIMIT 1) expires
      FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, params.concat([size, (page - 1) * size]));
  res.json({ members: rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
});
r.get('/members/:id', L.wrap((req, res) => {
  const id = Number(req.params.id);
  const u = get("SELECT id,name,email,phone,status,member_code,photo_url,created_at,email_verified FROM users WHERE id=? AND role='member'", [id]);
  if (!u) throw new L.HttpError(404, 'Member not found.');
  res.json({ member: u,
    memberships: all('SELECT m.*,p.name plan_name FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.user_id=? ORDER BY m.id DESC', [id]),
    payments: all('SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 20', [id]),
    attendance: all('SELECT date,check_in,check_out FROM attendance WHERE user_id=? ORDER BY id DESC LIMIT 30', [id]),
    bookings: all('SELECT b.class_date,b.status,c.name FROM class_bookings b JOIN classes c ON c.id=b.class_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 20', [id]),
    sessions: all('SELECT s.date,s.start_time,s.status,u.name trainer FROM trainer_sessions s JOIN trainers t ON t.id=s.trainer_id JOIN users u ON u.id=t.user_id WHERE s.user_id=? ORDER BY s.date DESC LIMIT 20', [id]),
    progress: all('SELECT date,weight,body_fat,notes FROM fitness_progress WHERE user_id=? ORDER BY date,id', [id]) });
}));
r.patch('/members/:id', L.wrap((req, res) => {
  const id = Number(req.params.id); const b = req.body || {};
  if (!get("SELECT id FROM users WHERE id=? AND role='member'", [id])) throw new L.HttpError(404, 'Member not found.');
  if (b.status && !['active', 'suspended'].includes(b.status)) throw L.bad('Invalid status.');
  if (b.email && !L.isEmail(b.email)) throw L.bad('Invalid email.');
  if (b.phone && !L.isPhone(b.phone)) throw L.bad('Invalid phone.');
  try { run('UPDATE users SET name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone), status=COALESCE(?,status) WHERE id=?', [b.name ? L.str(b.name, 80) : null, b.email ? b.email.toLowerCase() : null, b.phone ? L.str(b.phone, 20) : null, b.status || null, id]); }
  catch (e) { if (/UNIQUE/i.test(e.message)) throw new L.HttpError(409, 'That email is already in use.'); throw e; }
  res.json({ ok: true });
}));

// ================= BOOKINGS (classes, trainer sessions, trials, tours) =================
r.get('/bookings', L.wrap((req, res) => {
  const type = req.query.type; const status = L.str(req.query.status, 20); const date = L.isDate(req.query.date) ? req.query.date : null; const q = '%' + L.str(req.query.q, 60) + '%';
  const ex = (col) => [status ? ` AND ${col.s}=?` : '', date ? ` AND ${col.d}=?` : ''].join('');
  const ep = () => (status ? [status] : []).concat(date ? [date] : []);
  if (type === 'class') return res.json({ rows: all(`SELECT b.id,b.class_date date,b.status,c.name title,c.start_time time,u.name member,u.email FROM class_bookings b JOIN classes c ON c.id=b.class_id JOIN users u ON u.id=b.user_id WHERE (u.name LIKE ? OR c.name LIKE ?)${ex({ s: 'b.status', d: 'b.class_date' })} ORDER BY b.class_date DESC,c.start_time LIMIT 200`, [q, q].concat(ep())) });
  if (type === 'trainer') return res.json({ rows: all(`SELECT s.id,s.date,s.status,s.start_time time,tu.name title,u.name member,u.email,s.price FROM trainer_sessions s JOIN users u ON u.id=s.user_id JOIN trainers t ON t.id=s.trainer_id JOIN users tu ON tu.id=t.user_id WHERE (u.name LIKE ? OR tu.name LIKE ?)${ex({ s: 's.status', d: 's.date' })} ORDER BY s.date DESC,s.start_time LIMIT 200`, [q, q].concat(ep())) });
  if (type === 'trial') return res.json({ rows: all(`SELECT id,preferred_date date,status,preferred_time time,goal title,name member,email,phone,experience_level,age FROM trial_leads WHERE name LIKE ?${ex({ s: 'status', d: 'preferred_date' })} ORDER BY id DESC LIMIT 200`, [q].concat(ep())) });
  if (type === 'tour') return res.json({ rows: all(`SELECT id,date,status,time,'Gym tour' title,name member,email,phone FROM tour_bookings WHERE name LIKE ?${ex({ s: 'status', d: 'date' })} ORDER BY date DESC LIMIT 200`, [q].concat(ep())) });
  throw L.bad('Unknown booking type.');
}));

const STATUS = { class: ['booked', 'cancelled', 'completed'], trainer: ['booked', 'cancelled', 'completed'],
  trial: ['new', 'contacted', 'trial_booked', 'trial_completed', 'converted', 'not_interested'], tour: ['pending', 'approved', 'rescheduled', 'cancelled', 'completed'] };
const TABLE = { class: 'class_bookings', trainer: 'trainer_sessions', trial: 'trial_leads', tour: 'tour_bookings' };
r.patch('/bookings/:type/:id', L.wrap((req, res) => {
  const { type } = req.params; const id = Number(req.params.id); const b = req.body || {};
  if (!TABLE[type]) throw L.bad('Unknown booking type.');
  const row = get(`SELECT * FROM ${TABLE[type]} WHERE id=?`, [id]);
  if (!row) throw new L.HttpError(404, 'Booking not found.');
  tx(() => {
    if (b.status) {
      if (!STATUS[type].includes(b.status)) throw L.bad('Invalid status for this booking type.');
      run(`UPDATE ${TABLE[type]} SET status=? WHERE id=?`, [b.status, id]);
      if (type === 'class' && b.status === 'cancelled' && row.status === 'booked') { // freed seat → promote the waitlist
        const next = get("SELECT * FROM class_bookings WHERE class_id=? AND class_date=? AND status='waitlisted' ORDER BY created_at,id LIMIT 1", [row.class_id, row.class_date]);
        if (next) { run("UPDATE class_bookings SET status='booked' WHERE id=?", [next.id]); L.notify(next.user_id, 'waitlist_promoted', `A spot opened up — you're now booked into your class on ${row.class_date}.`, 'A spot opened up in your class'); }
      }
    }
    if (type === 'tour' && (b.date || b.time)) {
      if (!L.isDate(b.date) || !L.isTime(b.time)) throw L.bad('Please provide a valid new date and time.');
      if (get("SELECT id FROM tour_bookings WHERE date=? AND time=? AND status IN ('pending','approved','rescheduled') AND id!=?", [b.date, b.time, id])) throw new L.HttpError(409, 'That tour slot is already taken.');
      run("UPDATE tour_bookings SET date=?, time=?, status='rescheduled' WHERE id=?", [b.date, b.time, id]);
    }
  });
  const who = row.user_id ? get('SELECT email FROM users WHERE id=?', [row.user_id]) : row;
  if (type === 'tour' && who && who.email) L.sendEmail(who.email, 'Update on your Iron Lab tour', `Your tour is now: ${b.status || 'rescheduled'}${b.date ? ` — ${b.date} at ${b.time}` : ''}.`);
  res.json({ ok: true });
}));

// ================= MESSAGES =================
const MSG_ST = ['new', 'read', 'responded', 'closed'];
r.get('/messages', (req, res) => res.json({ rows: all(`SELECT * FROM contact_messages${MSG_ST.includes(req.query.status) ? ' WHERE status=?' : ''} ORDER BY id DESC LIMIT 200`, MSG_ST.includes(req.query.status) ? [req.query.status] : []) }));
r.patch('/messages/:id', L.wrap((req, res) => {
  if (!MSG_ST.includes(req.body && req.body.status)) throw L.bad('Invalid status.');
  run('UPDATE contact_messages SET status=? WHERE id=?', [req.body.status, Number(req.params.id)]); res.json({ ok: true });
}));

// ================= ATTENDANCE REPORTS =================
r.get('/attendance', (req, res) => {
  const range = { day: 1, week: 7, month: 30 }[req.query.range] || 1;
  const since = L.ymd(new Date(Date.now() - (range - 1) * 86400e3));
  res.json({ range, entries: all('SELECT a.date,a.check_in,a.check_out,u.name,u.member_code FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date>=? ORDER BY a.date DESC,a.check_in DESC LIMIT 500', [since]), unique_members: get('SELECT COUNT(DISTINCT user_id) n FROM attendance WHERE date>=?', [since]).n });
});

// ================= CONTENT MANAGEMENT (plans, classes, testimonials, facilities, faqs) =================
function crud(path, table, fields, required) {
  const pick = (b) => { const o = {}; for (const [k, t] of Object.entries(fields)) if (b[k] !== undefined) o[k] = t === 'n' ? Number(b[k]) : t === 'b' ? (b[k] ? 1 : 0) : L.str(String(b[k]), t === 'long' ? 2000 : 300); return o; };
  r.get('/' + path, (_req, res) => res.json({ rows: all(`SELECT * FROM ${table} ORDER BY id`) }));
  r.post('/' + path, L.wrap((req, res) => {
    const o = pick(req.body || {});
    for (const k of required) if (o[k] === undefined || o[k] === '' || Number.isNaN(o[k])) throw L.bad(`"${k}" is required.`);
    const keys = Object.keys(o);
    const id = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => o[k])).lastInsertRowid;
    res.status(201).json({ ok: true, id });
  }));
  r.put('/' + path + '/:id', L.wrap((req, res) => {
    const o = pick(req.body || {}); const keys = Object.keys(o);
    if (!keys.length) throw L.bad('Nothing to update.');
    for (const k of required) if (k in o && (o[k] === '' || Number.isNaN(o[k]))) throw L.bad(`"${k}" cannot be empty.`);
    run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, keys.map((k) => o[k]).concat([Number(req.params.id)]));
    res.json({ ok: true });
  }));
  r.delete('/' + path + '/:id', L.wrap((req, res) => {
    try { run(`DELETE FROM ${table} WHERE id=?`, [Number(req.params.id)]); }
    catch (e) { if (/FOREIGN KEY/i.test(e.message)) throw new L.HttpError(409, 'This item is in use. Retire/disable it instead of deleting.'); throw e; }
    res.json({ ok: true });
  }));
}
// (column names come from these fixed allow-lists, never from user input)
crud('plans', 'membership_plans', { name: 's', description: 'long', monthly_price: 'n', yearly_price: 'n', classes_included: 's', pt_sessions_included: 'n', guest_passes: 'n', recovery_access: 's', benefits: 'long', status: 's' }, ['name', 'monthly_price']);
crud('classes', 'classes', { name: 's', type: 's', trainer_id: 'n', day_of_week: 'n', start_time: 's', end_time: 's', capacity: 'n', difficulty: 's', description: 'long', location: 's', image_url: 's', status: 's' }, ['name', 'type', 'day_of_week', 'start_time', 'end_time', 'capacity']);
crud('testimonials', 'testimonials', { member_name: 's', goal: 's', duration: 's', result: 'long', rating: 'n', photo_url: 's', published: 'b' }, ['member_name']);
crud('facilities', 'facilities', { name: 's', description: 'long', image_url: 's', sort_order: 'n' }, ['name']);
crud('faqs', 'faqs', { question: 's', answer: 'long', sort_order: 'n' }, ['question', 'answer']);

// ================= TRAINERS =================
const validAvail = (rows) => Array.isArray(rows) && rows.length <= 21 && rows.every((a) => Number.isInteger(a.weekday) && a.weekday >= 0 && a.weekday <= 6 && L.isTime(a.start_time) && L.isTime(a.end_time) && a.start_time < a.end_time);
r.get('/trainers', (_req, res) => res.json({ rows: all(`SELECT t.id,t.status,t.specialty,t.bio,t.experience_years,t.certifications,t.session_price,u.name,u.email,u.photo_url FROM trainers t JOIN users u ON u.id=t.user_id ORDER BY t.id`) }));
r.post('/trainers', L.wrap((req, res) => {
  const b = req.body || {};
  if (!L.str(b.name, 80) || !L.isEmail(b.email)) throw L.bad('Trainer name and a valid email are required.');
  if (get('SELECT id FROM users WHERE email=?', [b.email.toLowerCase()])) throw new L.HttpError(409, 'That email already has an account.');
  const temp = crypto.randomBytes(5).toString('hex') + 'A1';
  const out = tx(() => {
    const uid = run('INSERT INTO users (email,password_hash,role,name,member_code,email_verified) VALUES (?,?,?,?,?,1)', [b.email.toLowerCase(), bcrypt.hashSync(temp, 10), 'trainer', L.str(b.name, 80), 'IL-' + crypto.randomBytes(4).toString('hex').toUpperCase()]).lastInsertRowid;
    const tid = run('INSERT INTO trainers (user_id,specialty,bio,experience_years,certifications,session_price) VALUES (?,?,?,?,?,?)', [uid, L.str(b.specialty, 80), L.str(b.bio, 600), Number(b.experience_years) || 0, L.str(b.certifications, 200), Number(b.session_price) || 0]).lastInsertRowid;
    for (let wd = 1; wd <= 5; wd++) run('INSERT INTO trainer_availability (trainer_id,weekday,start_time,end_time) VALUES (?,?,?,?)', [tid, wd, '09:00', '17:00']);
    return { uid, tid };
  });
  L.sendEmail(b.email, 'Your Iron Lab trainer account', `Hi ${L.str(b.name, 80)},\n\nYour trainer account is ready. Temporary password: ${temp}\nPlease log in and change it right away.`);
  res.status(201).json({ ok: true, id: out.tid, temporary_password: temp }); // shown once to the admin; also emailed
}));
r.put('/trainers/:id', L.wrap((req, res) => {
  const b = req.body || {}; const id = Number(req.params.id);
  if (b.status && !['active', 'disabled'].includes(b.status)) throw L.bad('Invalid status.');
  run('UPDATE trainers SET specialty=COALESCE(?,specialty), bio=COALESCE(?,bio), experience_years=COALESCE(?,experience_years), certifications=COALESCE(?,certifications), session_price=COALESCE(?,session_price), status=COALESCE(?,status) WHERE id=?',
    [b.specialty != null ? L.str(b.specialty, 80) : null, b.bio != null ? L.str(b.bio, 600) : null, b.experience_years != null ? Number(b.experience_years) : null, b.certifications != null ? L.str(b.certifications, 200) : null, b.session_price != null ? Number(b.session_price) : null, b.status || null, id]);
  if (b.name) run('UPDATE users SET name=? WHERE id=(SELECT user_id FROM trainers WHERE id=?)', [L.str(b.name, 80), id]);
  if (b.photo_url !== undefined) run('UPDATE users SET photo_url=? WHERE id=(SELECT user_id FROM trainers WHERE id=?)', [L.str(b.photo_url, 300), id]);
  res.json({ ok: true });
}));
r.get('/trainers/:id/availability', (req, res) => res.json({ availability: all('SELECT weekday,start_time,end_time FROM trainer_availability WHERE trainer_id=? ORDER BY weekday', [Number(req.params.id)]) }));
r.put('/trainers/:id/availability', L.wrap((req, res) => {
  const id = Number(req.params.id); const rows = req.body && req.body.availability;
  if (!get('SELECT id FROM trainers WHERE id=?', [id])) throw new L.HttpError(404, 'Trainer not found.');
  if (!validAvail(rows)) throw L.bad('Each window needs a weekday and a start time earlier than its end time.');
  tx(() => { run('DELETE FROM trainer_availability WHERE trainer_id=?', [id]); rows.forEach((a) => run('INSERT INTO trainer_availability (trainer_id,weekday,start_time,end_time) VALUES (?,?,?,?)', [id, a.weekday, a.start_time, a.end_time])); });
  res.json({ ok: true });
}));
r.delete('/trainers/:id', L.wrap((req, res) => { // "remove" = disable, so booking history stays intact
  run("UPDATE trainers SET status='disabled' WHERE id=?", [Number(req.params.id)]); res.json({ ok: true, message: 'Trainer disabled.' });
}));

// ================= SETTINGS (hero text, announcement, whatsapp, quiz rules) + MEDIA UPLOAD =================
const SETTING_KEYS = new Set(['hero_headline', 'hero_subhead', 'hero_video_url', 'announcement', 'whatsapp_number', 'quiz_rules']);
r.get('/settings', (_req, res) => res.json({ settings: Object.fromEntries(all('SELECT key,value FROM settings').map((s) => [s.key, s.value])) }));
r.put('/settings', L.wrap((req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!SETTING_KEYS.has(k)) continue;
    if (k === 'quiz_rules') { try { JSON.parse(v); } catch (_) { throw L.bad('Quiz rules must be valid JSON.'); } }
    run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, L.str(String(v), 4000)]);
  }
  res.json({ ok: true });
}));
r.post('/upload', L.wrap((req, res) => res.json({ url: pub.saveImage(req.body && req.body.image) })));

module.exports = r;
