const express = require('express');
const { run, get, all, tx } = require('../db');
const L = require('../lib');
const r = express.Router();

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// next occurrence of a weekly class (today only if it hasn't started yet)
function nextOccurrence(dow, startTime) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d); c.setDate(d.getDate() + i);
    if (c.getDay() !== dow) continue;
    if (i === 0 && startTime <= nowHM()) continue;
    return L.ymd(c);
  }
}

// ================= CLASSES (availability is live from the DB) =================
function classRows(userId) {
  const rows = all(`SELECT c.*, u.name trainer_name FROM classes c
                    LEFT JOIN trainers t ON t.id=c.trainer_id LEFT JOIN users u ON u.id=t.user_id
                    WHERE c.status='active' ORDER BY c.day_of_week, c.start_time`);
  return rows.map((c) => {
    const date = nextOccurrence(c.day_of_week, c.start_time);
    const booked = get("SELECT COUNT(*) n FROM class_bookings WHERE class_id=? AND class_date=? AND status='booked'", [c.id, date]).n;
    const waitlist = get("SELECT COUNT(*) n FROM class_bookings WHERE class_id=? AND class_date=? AND status='waitlisted'", [c.id, date]).n;
    const mine = userId ? get("SELECT status FROM class_bookings WHERE class_id=? AND user_id=? AND class_date=? AND status IN ('booked','waitlisted')", [c.id, userId, date]) : null;
    return { ...c, day_name: DAYS[c.day_of_week], class_date: date, booked, remaining: Math.max(0, c.capacity - booked), full: booked >= c.capacity, waitlist, my_status: mine ? mine.status : null };
  });
}
r.get('/classes', (req, res) => res.json({ classes: classRows(req.user && req.user.id) }));

r.post('/classes/:id/book', L.requireAuth, L.wrap((req, res) => {
  const id = Number(req.params.id);
  const wantWaitlist = !!(req.body && req.body.waitlist);
  const out = tx(() => {
    const c = get("SELECT * FROM classes WHERE id=? AND status='active'", [id]);
    if (!c) throw new L.HttpError(404, 'That class could not be found.');
    if (!L.activeMembership(req.user.id)) throw new L.HttpError(402, 'An active membership is required to book classes.');
    const date = nextOccurrence(c.day_of_week, c.start_time);
    const existing = get('SELECT * FROM class_bookings WHERE class_id=? AND user_id=? AND class_date=?', [id, req.user.id, date]);
    if (existing && ['booked', 'waitlisted'].includes(existing.status)) throw new L.HttpError(409, existing.status === 'booked' ? 'You are already booked into this class.' : 'You are already on the waitlist for this class.');
    const booked = get("SELECT COUNT(*) n FROM class_bookings WHERE class_id=? AND class_date=? AND status='booked'", [id, date]).n;
    let status = 'booked';
    if (booked >= c.capacity) {
      if (!wantWaitlist) throw Object.assign(new L.HttpError(409, 'This class is fully booked.'), { extra: { can_waitlist: true } });
      status = 'waitlisted';
    }
    if (existing) run("UPDATE class_bookings SET status=?, created_at=datetime('now') WHERE id=?", [status, existing.id]);
    else run('INSERT INTO class_bookings (class_id,user_id,class_date,status) VALUES (?,?,?,?)', [id, req.user.id, date, status]);
    return { status, class: c, date, remaining: Math.max(0, c.capacity - booked - (status === 'booked' ? 1 : 0)) };
  });
  if (out.status === 'booked') {
    L.notify(req.user.id, 'class_booking', `You're booked into ${out.class.name} on ${out.date} at ${out.class.start_time}.`, 'Class booking confirmed');
    run("INSERT INTO analytics_events (name) VALUES ('class_book')");
  } else L.notify(req.user.id, 'waitlist', `You're on the waitlist for ${out.class.name} on ${out.date}. We'll book you in automatically if a spot opens.`);
  res.status(201).json({ ok: true, status: out.status, remaining: out.remaining, message: out.status === 'booked' ? 'Your class has been booked successfully.' : 'You are on the waitlist.' });
}));

function promoteWaitlist(classId, date) {
  for (;;) {
    const next = get("SELECT * FROM class_bookings WHERE class_id=? AND class_date=? AND status='waitlisted' ORDER BY created_at, id LIMIT 1", [classId, date]);
    if (!next) return;
    if (!L.activeMembership(next.user_id)) { run("UPDATE class_bookings SET status='cancelled' WHERE id=?", [next.id]); continue; }
    run("UPDATE class_bookings SET status='booked' WHERE id=?", [next.id]);
    const c = get('SELECT name,start_time FROM classes WHERE id=?', [classId]);
    L.notify(next.user_id, 'waitlist_promoted', `A spot opened up — you're now booked into ${c.name} on ${date} at ${c.start_time}.`, 'A spot opened up in your class');
    return;
  }
}
r.post('/classes/:id/cancel', L.requireAuth, L.wrap((req, res) => {
  const id = Number(req.params.id);
  tx(() => {
    const b = get("SELECT * FROM class_bookings WHERE class_id=? AND user_id=? AND status IN ('booked','waitlisted') ORDER BY class_date DESC LIMIT 1", [id, req.user.id]);
    if (!b) throw new L.HttpError(404, 'You do not have an active booking for this class.');
    run("UPDATE class_bookings SET status='cancelled' WHERE id=?", [b.id]);
    if (b.status === 'booked') promoteWaitlist(id, b.class_date);
  });
  L.notify(req.user.id, 'class_cancel', 'Your class booking was cancelled.', 'Class booking cancelled');
  res.json({ ok: true, message: 'Your booking has been cancelled.' });
}));

// ================= TRAINERS + SESSIONS =================
r.get('/trainers', (_req, res) => res.json({ trainers: all(`SELECT t.id,u.name,u.photo_url,t.specialty,t.bio,t.experience_years,t.certifications,t.session_price
  FROM trainers t JOIN users u ON u.id=t.user_id WHERE t.status='active' AND u.status='active'`) }));

r.get('/trainers/:id/slots', L.wrap((req, res) => {
  const id = Number(req.params.id); const date = req.query.date;
  if (!L.isDate(date)) throw L.bad('Please choose a valid date.');
  if (!get("SELECT id FROM trainers WHERE id=? AND status='active'", [id])) throw new L.HttpError(404, 'Trainer not found.');
  const dow = new Date(date + 'T00:00:00').getDay();
  const taken = new Set(all("SELECT start_time FROM trainer_sessions WHERE trainer_id=? AND date=? AND status!='cancelled'", [id, date]).map((s) => s.start_time));
  const isToday = date === L.ymd(new Date());
  const slots = [];
  for (const a of all('SELECT * FROM trainer_availability WHERE trainer_id=? AND weekday=?', [id, dow])) {
    for (let h = Number(a.start_time.slice(0, 2)); h + 1 <= Number(a.end_time.slice(0, 2)); h++) {
      const st = String(h).padStart(2, '0') + ':00';
      if (date < L.ymd(new Date()) || (isToday && st <= nowHM())) continue;
      slots.push({ start_time: st, end_time: String(h + 1).padStart(2, '0') + ':00', available: !taken.has(st) });
    }
  }
  res.json({ slots });
}));

r.post('/trainers/:id/book', L.requireAuth, L.wrap(async (req, res) => {
  const id = Number(req.params.id); const { date, start_time } = req.body || {};
  if (!L.isDate(date) || !L.isTime(start_time)) throw L.bad('Please choose a date and time.');
  const t = get(`SELECT t.*, u.name FROM trainers t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.status='active'`, [id]);
  if (!t) throw new L.HttpError(404, 'Trainer not found.');
  const dow = new Date(date + 'T00:00:00').getDay();
  const end_time = String(Number(start_time.slice(0, 2)) + 1).padStart(2, '0') + ':00';
  const avail = get('SELECT id FROM trainer_availability WHERE trainer_id=? AND weekday=? AND start_time<=? AND end_time>=?', [id, dow, start_time, end_time]);
  if (!avail || date < L.ymd(new Date()) || (date === L.ymd(new Date()) && start_time <= nowHM())) throw new L.HttpError(409, 'That time slot is no longer available.');
  // PT sessions included in the active plan (per month) are free; otherwise the trainer's price applies
  const m = L.activeMembership(req.user.id);
  let price = t.session_price;
  if (m && m.pt_sessions_included > 0) {
    const used = get(`SELECT COUNT(*) n FROM trainer_sessions WHERE user_id=? AND status!='cancelled' AND price=0 AND substr(date,1,7)=?`, [req.user.id, date.slice(0, 7)]).n;
    if (used < m.pt_sessions_included) price = 0;
  }
  let sessionId;
  try {
    sessionId = run('INSERT INTO trainer_sessions (trainer_id,user_id,date,start_time,end_time,price) VALUES (?,?,?,?,?,?)', [id, req.user.id, date, start_time, end_time, price]).lastInsertRowid;
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) { // the UNIQUE(trainer,date,start) constraint is what makes double-booking impossible
      const row = get('SELECT id,status FROM trainer_sessions WHERE trainer_id=? AND date=? AND start_time=?', [id, date, start_time]);
      if (row && row.status === 'cancelled') { run("UPDATE trainer_sessions SET user_id=?, status='booked', price=?, created_at=datetime('now') WHERE id=? AND status='cancelled'", [req.user.id, price, row.id]); sessionId = row.id; }
      else throw new L.HttpError(409, 'That time slot is no longer available.');
    } else throw e;
  }
  let redirectUrl = null;
  if (price > 0) {
    try {
      const base = baseUrl(req);
      const pay = await L.startPayment({ amount: price, description: `Training session with ${t.name}`, userEmail: req.user.email, successUrl: base + '/dashboard/member.html?paid=1', cancelUrl: base + '/dashboard/member.html?cancelled=1', metadata: { kind: 'session', session_id: sessionId } });
      run('INSERT INTO payments (user_id,trainer_session_id,amount,provider,provider_txn_id,status) VALUES (?,?,?,?,?,?)', [req.user.id, sessionId, price, pay.provider, pay.txnId, pay.status]);
      redirectUrl = pay.redirectUrl || null;
    } catch (e) { run("UPDATE trainer_sessions SET status='cancelled' WHERE id=?", [sessionId]); throw e; }
  }
  L.notify(req.user.id, 'trainer_booking', `Session booked with ${t.name} on ${date} at ${start_time}.`, 'Trainer session confirmed');
  L.notify(t.user_id, 'trainer_booking', `${req.user.name} booked a session on ${date} at ${start_time}.`);
  run("INSERT INTO analytics_events (name) VALUES ('trainer_book')");
  res.status(201).json({ ok: true, redirect_url: redirectUrl, price, message: 'Your session has been booked.' });
}));

r.post('/sessions/:id/cancel', L.requireAuth, L.wrap((req, res) => {
  const s = get("SELECT * FROM trainer_sessions WHERE id=? AND user_id=? AND status='booked'", [Number(req.params.id), req.user.id]);
  if (!s) throw new L.HttpError(404, 'Session not found.');
  if (s.date < L.ymd(new Date()) || (s.date === L.ymd(new Date()) && s.start_time <= nowHM())) throw L.bad('Past sessions cannot be cancelled.');
  run("UPDATE trainer_sessions SET status='cancelled' WHERE id=?", [s.id]);
  const tr = get('SELECT user_id FROM trainers WHERE id=?', [s.trainer_id]);
  L.notify(req.user.id, 'session_cancel', 'Your training session was cancelled.', 'Training session cancelled');
  if (tr) L.notify(tr.user_id, 'session_cancel', `${req.user.name} cancelled their ${s.date} ${s.start_time} session.`);
  res.json({ ok: true });
}));

// ================= MEMBERSHIPS + PAYMENTS =================
r.get('/plans', (_req, res) => res.json({ plans: all("SELECT * FROM membership_plans WHERE status='active' ORDER BY monthly_price, id") }));

r.post('/memberships/purchase', L.requireAuth, L.wrap(async (req, res) => {
  const { plan_id } = req.body || {};
  const cycle = (req.body && req.body.billing_cycle) === 'yearly' ? 'yearly' : 'monthly';
  const plan = get("SELECT * FROM membership_plans WHERE id=? AND status='active'", [Number(plan_id)]);
  if (!plan) throw new L.HttpError(404, 'That plan is not available.');
  const amount = cycle === 'yearly' ? plan.yearly_price : plan.monthly_price;
  if (!amount) throw L.bad('That billing option is not available for this plan.');
  const current = L.activeMembership(req.user.id);
  const renewing = current && current.plan_id === plan.id;
  const start = renewing ? new Date(current.expiration_date + 'T00:00:00') : new Date();
  const exp = L.addMonths(start, cycle === 'yearly' ? 12 : 1);
  const base = baseUrl(req);
  const pay = await L.startPayment({ amount, description: `${plan.name} membership (${cycle})`, userEmail: req.user.email, successUrl: base + '/dashboard/member.html?paid=1', cancelUrl: base + '/dashboard/member.html?cancelled=1', metadata: { kind: 'membership' } });
  const paid = pay.status === 'succeeded';
  const out = tx(() => {
    if (current && !renewing && paid) run("UPDATE memberships SET status='cancelled' WHERE id=?", [current.id]); // upgrade/downgrade replaces the old plan
    const mid = run(`INSERT INTO memberships (user_id,plan_id,billing_cycle,start_date,expiration_date,status,renewal_date,payment_status) VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, plan.id, cycle, L.ymd(renewing ? start : new Date()), L.ymd(exp), 'active', L.ymd(exp), paid ? 'paid' : 'pending']).lastInsertRowid;
    if (renewing && paid) run("UPDATE memberships SET status='expired' WHERE id=?", [current.id]);
    const pid = run('INSERT INTO payments (user_id,membership_id,amount,provider,provider_txn_id,status) VALUES (?,?,?,?,?,?)', [req.user.id, mid, amount, pay.provider, pay.txnId, pay.status]).lastInsertRowid;
    return { mid, pid };
  });
  if (paid) {
    L.notify(req.user.id, 'membership', `Your ${plan.name} membership is active until ${L.ymd(exp)}.`, 'Membership confirmed');
    L.notify(req.user.id, 'payment', `Payment of $${amount.toFixed(2)} received (receipt IL-R-${String(out.pid).padStart(6, '0')}).`, 'Payment receipt');
    run("INSERT INTO analytics_events (name) VALUES ('membership_purchase')");
  }
  res.status(201).json({ ok: true, redirect_url: pay.redirectUrl || null, message: paid ? `Welcome to ${plan.name}! Your membership is active.` : 'Redirecting you to secure checkout…' });
}));

r.post('/memberships/cancel', L.requireAuth, L.wrap((req, res) => {
  const m = L.activeMembership(req.user.id);
  if (!m) throw new L.HttpError(404, 'You do not have an active membership.');
  run('UPDATE memberships SET renewal_date=NULL WHERE id=?', [m.id]); // stops renewal; benefits continue until the paid period ends
  L.notify(req.user.id, 'membership', `Your membership will not renew. You keep full access until ${m.expiration_date}.`, 'Membership cancellation confirmed');
  res.json({ ok: true, message: `Your membership will end on ${m.expiration_date}. You keep full access until then.` });
}));

// Stripe webhook (raw body is attached in index.js). Marks payments paid/failed.
r.post('/payments/webhook', L.wrap((req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured.' });
  if (!L.verifyStripeSignature(req.rawBody, req.get('stripe-signature'), secret)) return res.status(400).json({ error: 'Bad signature.' });
  const ev = JSON.parse(req.rawBody); const s = ev.data && ev.data.object;
  const pay = s && get('SELECT * FROM payments WHERE provider_txn_id=?', [s.id]);
  if (pay && ev.type === 'checkout.session.completed') {
    run("UPDATE payments SET status='succeeded' WHERE id=?", [pay.id]);
    if (pay.membership_id) {
      run("UPDATE memberships SET payment_status='paid' WHERE id=?", [pay.membership_id]);
      run("UPDATE memberships SET status='cancelled' WHERE user_id=? AND id!=? AND status='active' AND plan_id!=(SELECT plan_id FROM memberships WHERE id=?)", [pay.user_id, pay.membership_id, pay.membership_id]);
    }
    L.notify(pay.user_id, 'payment', `Payment of $${pay.amount.toFixed(2)} received.`, 'Payment receipt');
  } else if (pay && ev.type === 'checkout.session.expired') {
    run("UPDATE payments SET status='failed' WHERE id=?", [pay.id]);
    if (pay.membership_id) run("UPDATE memberships SET payment_status='failed' WHERE id=?", [pay.membership_id]);
    if (pay.trainer_session_id) run("UPDATE trainer_sessions SET status='cancelled' WHERE id=?", [pay.trainer_session_id]);
    L.notify(pay.user_id, 'payment', 'Your payment could not be completed.', 'Payment failed');
  }
  res.json({ received: true });
}));

// ================= MEMBER DASHBOARD DATA =================
function streak(userId) {
  const days = new Set(all('SELECT DISTINCT date FROM attendance WHERE user_id=?', [userId]).map((a) => a.date));
  let n = 0; const d = new Date();
  if (!days.has(L.ymd(d))) d.setDate(d.getDate() - 1);
  while (days.has(L.ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
r.get('/me/dashboard', L.requireAuth, L.wrap((req, res) => {
  const uid = req.user.id; const today = L.ymd(new Date());
  const m = get(`SELECT m.*, p.name plan_name, p.pt_sessions_included, p.guest_passes FROM memberships m JOIN membership_plans p ON p.id=m.plan_id
                 WHERE m.user_id=? ORDER BY (m.status='active') DESC, m.expiration_date DESC LIMIT 1`, [uid]);
  if (m) { m.days_left = Math.ceil((new Date(m.expiration_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400e3); m.is_active = m.status === 'active' && m.payment_status === 'paid' && m.days_left >= 0; m.will_renew = !!m.renewal_date; }
  res.json({
    user: { id: uid, name: req.user.name, email: req.user.email, phone: req.user.phone, member_code: req.user.member_code, photo_url: req.user.photo_url, email_verified: !!req.user.email_verified },
    membership: m || null,
    upcoming_classes: all(`SELECT b.class_id, b.class_date, b.status, c.name, c.type, c.start_time, c.end_time, c.location FROM class_bookings b JOIN classes c ON c.id=b.class_id
                           WHERE b.user_id=? AND b.status IN ('booked','waitlisted') AND b.class_date>=? ORDER BY b.class_date, c.start_time`, [uid, today]),
    upcoming_sessions: all(`SELECT s.id,s.date,s.start_time,s.end_time,s.price,u.name trainer_name FROM trainer_sessions s JOIN trainers t ON t.id=s.trainer_id JOIN users u ON u.id=t.user_id
                            WHERE s.user_id=? AND s.status='booked' AND s.date>=? ORDER BY s.date,s.start_time`, [uid, today]),
    history: all(`SELECT b.class_date date, c.name, c.type FROM class_bookings b JOIN classes c ON c.id=b.class_id WHERE b.user_id=? AND b.status='booked' AND b.class_date<? ORDER BY b.class_date DESC LIMIT 20`, [uid, today]),
    payments: all(`SELECT id,amount,currency,provider,provider_txn_id,status,created_at FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 20`, [uid]).map((p) => ({ ...p, receipt: 'IL-R-' + String(p.id).padStart(6, '0') })),
    attendance: all('SELECT date,check_in,check_out FROM attendance WHERE user_id=? ORDER BY id DESC LIMIT 30', [uid]),
    attendance_30d: get("SELECT COUNT(DISTINCT date) n FROM attendance WHERE user_id=? AND date>=date('now','-30 days')", [uid]).n,
    streak: streak(uid),
    notifications: all('SELECT id,type,message,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 20', [uid]),
    unread: get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', [uid]).n,
  });
}));

r.post('/me/notifications/read', L.requireAuth, (req, res) => { run('UPDATE notifications SET read=1 WHERE user_id=?', [req.user.id]); res.json({ ok: true }); });

// ---- fitness progress (private to the member; trainers/admin access is gated in staff/admin routes) ----
r.get('/me/progress', L.requireAuth, (req, res) => res.json({ entries: all('SELECT id,date,weight,body_fat,notes FROM fitness_progress WHERE user_id=? ORDER BY date,id', [req.user.id]) }));
r.post('/me/progress', L.requireAuth, L.wrap((req, res) => {
  const b = req.body || {};
  const w = b.weight === '' || b.weight == null ? null : Number(b.weight);
  const bf = b.body_fat === '' || b.body_fat == null ? null : Number(b.body_fat);
  if (w === null && bf === null && !L.str(b.notes)) throw L.bad('Enter at least a weight, body-fat %, or a note.');
  if (w !== null && !(w >= 20 && w <= 400)) throw L.bad('Weight must be between 20 and 400.');
  if (bf !== null && !(bf >= 2 && bf <= 70)) throw L.bad('Body fat must be between 2% and 70%.');
  const date = b.date && L.isDate(b.date) ? b.date : L.ymd(new Date());
  run('INSERT INTO fitness_progress (user_id,date,weight,body_fat,notes) VALUES (?,?,?,?,?)', [req.user.id, date, w, bf, L.str(b.notes, 300) || null]);
  res.status(201).json({ ok: true, message: 'Progress saved.' });
}));

// Membership expiry sweep: marks expired + sends 30/7/1-day reminders (idempotent).
function expirySweep() {
  run("UPDATE memberships SET status='expired' WHERE status='active' AND expiration_date < date('now')");
  for (const m of all(`SELECT m.id,m.user_id,m.expiration_date, CAST(julianday(m.expiration_date)-julianday(date('now')) AS INTEGER) d, p.name
                       FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.status='active' AND m.renewal_date IS NOT NULL`)) {
    for (const n of [30, 7, 1]) {
      if (m.d !== n) continue;
      const key = `expiry_${m.id}_${n}`;
      if (get('SELECT id FROM notifications WHERE user_id=? AND type=?', [m.user_id, key])) continue;
      L.notify(m.user_id, key, `Your ${m.name} membership expires in ${n} day${n > 1 ? 's' : ''} (${m.expiration_date}). Renew to keep your benefits.`, `Membership expires in ${n} day${n > 1 ? 's' : ''}`);
    }
  }
}
// Class + session reminders for tomorrow (idempotent)
function reminderSweep() {
  const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); const d = L.ymd(tmr);
  for (const b of all(`SELECT b.user_id,b.class_id,c.name,c.start_time FROM class_bookings b JOIN classes c ON c.id=b.class_id WHERE b.status='booked' AND b.class_date=?`, [d])) {
    const key = `remind_class_${b.class_id}_${d}`;
    if (!get('SELECT id FROM notifications WHERE user_id=? AND type=?', [b.user_id, key])) L.notify(b.user_id, key, `Reminder: ${b.name} tomorrow at ${b.start_time}.`, 'Class reminder');
  }
  for (const s of all(`SELECT id,user_id,start_time FROM trainer_sessions WHERE status='booked' AND date=?`, [d])) {
    const key = `remind_session_${s.id}`;
    if (!get('SELECT id FROM notifications WHERE user_id=? AND type=?', [s.user_id, key])) L.notify(s.user_id, key, `Reminder: training session tomorrow at ${s.start_time}.`, 'Training session reminder');
  }
}
r.expirySweep = expirySweep; r.reminderSweep = reminderSweep;

module.exports = r;
