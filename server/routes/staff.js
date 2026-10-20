const express = require('express');
const { run, get, all, tx } = require('../db');
const L = require('../lib');
const r = express.Router();
const staff = L.requireRole('admin', 'trainer');

// ================= ATTENDANCE / QR CHECK-IN =================
// The QR code encodes the member's unique code (e.g. IL-3F9A12CD). Staff scan it (or type it) here.
r.post('/attendance/checkin', staff, L.wrap((req, res) => {
  const code = L.str(req.body && req.body.member_code, 30).toUpperCase();
  if (!/^IL-[0-9A-F]{8}$/.test(code)) throw L.bad('That does not look like a valid member code.');
  const u = get("SELECT id,name,status FROM users WHERE member_code=? AND role='member'", [code]);
  if (!u) throw new L.HttpError(404, 'No member found for that code.');
  if (u.status !== 'active') throw new L.HttpError(403, `${u.name}'s account is suspended.`);
  const out = tx(() => {
    const today = L.ymd(new Date()); const now = new Date();
    const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const open = get('SELECT * FROM attendance WHERE user_id=? AND date=? AND check_out IS NULL ORDER BY id DESC LIMIT 1', [u.id, today]);
    if (open) {
      const mins = (now - new Date(`${today}T${open.check_in}:00`)) / 60000;
      if (mins < 10) throw new L.HttpError(409, `${u.name} already checked in at ${open.check_in}. Duplicate scan ignored.`);
      run('UPDATE attendance SET check_out=? WHERE id=?', [hm, open.id]);
      return { action: 'check_out', time: hm };
    }
    if (!L.activeMembership(u.id)) throw new L.HttpError(402, `${u.name} does not have an active membership.`);
    run('INSERT INTO attendance (user_id,date,check_in) VALUES (?,?,?)', [u.id, today, hm]);
    return { action: 'check_in', time: hm };
  });
  res.json({ ok: true, member: u.name, ...out, message: out.action === 'check_in' ? `${u.name} checked in at ${out.time}.` : `${u.name} checked out at ${out.time}.` });
}));

r.get('/attendance/today', staff, (_req, res) => res.json({ entries: all(`SELECT a.id,a.check_in,a.check_out,u.name,u.member_code FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date=? ORDER BY a.id DESC`, [L.ymd(new Date())]) }));

// ================= TRAINER DASHBOARD =================
const trainerOnly = L.requireRole('trainer');
const myTrainer = (req) => { const t = get('SELECT * FROM trainers WHERE user_id=?', [req.user.id]); if (!t) throw new L.HttpError(404, 'Trainer profile not found.'); return t; };

r.get('/trainer/dashboard', trainerOnly, L.wrap((req, res) => {
  const t = myTrainer(req); const today = L.ymd(new Date());
  const sess = `SELECT s.id,s.date,s.start_time,s.end_time,s.status,s.price,u.id member_id,u.name member_name FROM trainer_sessions s JOIN users u ON u.id=s.user_id WHERE s.trainer_id=?`;
  res.json({
    trainer: { ...t, name: req.user.name },
    today: all(sess + " AND s.date=? AND s.status!='cancelled' ORDER BY s.start_time", [t.id, today]),
    upcoming: all(sess + " AND s.date>? AND s.status='booked' ORDER BY s.date,s.start_time LIMIT 30", [t.id, today]),
    classes: all("SELECT id,name,type,day_of_week,start_time,end_time,capacity FROM classes WHERE trainer_id=? AND status='active' ORDER BY day_of_week,start_time", [t.id]),
    members: all(`SELECT u.id,u.name,u.email,COUNT(*) sessions,MAX(s.date) last_session FROM trainer_sessions s JOIN users u ON u.id=s.user_id WHERE s.trainer_id=? AND s.status!='cancelled' GROUP BY u.id ORDER BY last_session DESC`, [t.id]),
    availability: all('SELECT weekday,start_time,end_time FROM trainer_availability WHERE trainer_id=? ORDER BY weekday', [t.id]),
    attendance: all(`SELECT a.date,a.check_in,u.name FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.user_id IN (SELECT user_id FROM trainer_sessions WHERE trainer_id=?) ORDER BY a.id DESC LIMIT 15`, [t.id]),
    notifications: all('SELECT id,message,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 15', [req.user.id]),
  });
}));

const validAvail = (rows) => Array.isArray(rows) && rows.length <= 21 && rows.every((a) => Number.isInteger(a.weekday) && a.weekday >= 0 && a.weekday <= 6 && L.isTime(a.start_time) && L.isTime(a.end_time) && a.start_time < a.end_time);
r.put('/trainer/availability', trainerOnly, L.wrap((req, res) => {
  const t = myTrainer(req); const rows = req.body && req.body.availability;
  if (!validAvail(rows)) throw L.bad('Each availability window needs a weekday and a start time earlier than its end time.');
  tx(() => { run('DELETE FROM trainer_availability WHERE trainer_id=?', [t.id]); rows.forEach((a) => run('INSERT INTO trainer_availability (trainer_id,weekday,start_time,end_time) VALUES (?,?,?,?)', [t.id, a.weekday, a.start_time, a.end_time])); });
  res.json({ ok: true, message: 'Availability updated.' });
}));

r.patch('/trainer/sessions/:id', trainerOnly, L.wrap((req, res) => {
  const t = myTrainer(req); const status = req.body && req.body.status;
  if (!['completed', 'cancelled'].includes(status)) throw L.bad('Status must be completed or cancelled.');
  const s = get('SELECT * FROM trainer_sessions WHERE id=? AND trainer_id=?', [Number(req.params.id), t.id]);
  if (!s) throw new L.HttpError(404, 'Session not found.');
  run('UPDATE trainer_sessions SET status=? WHERE id=?', [status, s.id]);
  if (status === 'cancelled') L.notify(s.user_id, 'session_cancel', `Your trainer cancelled the ${s.date} ${s.start_time} session. Please rebook a new time.`, 'Training session cancelled');
  res.json({ ok: true });
}));

r.patch('/trainer/profile', trainerOnly, L.wrap((req, res) => {
  const t = myTrainer(req); const b = req.body || {};
  run('UPDATE trainers SET bio=COALESCE(?,bio), specialty=COALESCE(?,specialty), certifications=COALESCE(?,certifications) WHERE id=?', [b.bio ? L.str(b.bio, 600) : null, b.specialty ? L.str(b.specialty, 80) : null, b.certifications ? L.str(b.certifications, 200) : null, t.id]);
  res.json({ ok: true });
}));

// ---- private progress: admin, or a trainer who has trained that member ----
r.get('/staff/members/:id/progress', staff, L.wrap((req, res) => {
  const uid = Number(req.params.id);
  if (req.user.role === 'trainer') {
    const t = myTrainer(req);
    if (!get("SELECT 1 x FROM trainer_sessions WHERE trainer_id=? AND user_id=? AND status!='cancelled' LIMIT 1", [t.id, uid])) throw new L.HttpError(403, 'You can only view progress for members you train.');
  }
  res.json({ entries: all('SELECT id,date,weight,body_fat,notes FROM fitness_progress WHERE user_id=? ORDER BY date,id', [uid]) });
}));

module.exports = r;
