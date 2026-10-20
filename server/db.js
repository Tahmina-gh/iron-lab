// server/db.js
// Real relational database using Node's built-in SQLite (node:sqlite, Node >=22.5).
// File-based, ACID, with foreign keys, indexes and transactions. To move to Postgres/MySQL for a
// multi-instance deployment, replace this module (run/get/all/tx) — routes only use those helpers.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'iron-lab.db');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('member','trainer','admin')) DEFAULT 'member',
  name TEXT NOT NULL,
  phone TEXT,
  photo_url TEXT,
  member_code TEXT UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  reset_token TEXT,
  reset_token_expires INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','suspended')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  specialty TEXT,
  bio TEXT,
  experience_years INTEGER DEFAULT 0,
  certifications TEXT,
  session_price REAL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('active','disabled')) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS trainer_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS membership_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  monthly_price REAL NOT NULL,
  yearly_price REAL,
  classes_included TEXT,
  pt_sessions_included INTEGER DEFAULT 0,
  guest_passes INTEGER DEFAULT 0,
  recovery_access TEXT,
  benefits TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','retired')) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES membership_plans(id),
  billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('monthly','yearly')) DEFAULT 'monthly',
  start_date TEXT NOT NULL,
  expiration_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','expired','cancelled')) DEFAULT 'active',
  renewal_date TEXT,
  payment_status TEXT NOT NULL CHECK(payment_status IN ('paid','pending','failed')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id INTEGER REFERENCES memberships(id) ON DELETE SET NULL,
  trainer_session_id INTEGER,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_txn_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed','refunded')) DEFAULT 'succeeded',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 20,
  difficulty TEXT DEFAULT 'All levels',
  description TEXT,
  location TEXT DEFAULT 'Main Floor',
  image_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','cancelled')) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS class_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('booked','waitlisted','cancelled','completed')) DEFAULT 'booked',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(class_id, user_id, class_date)
);

CREATE TABLE IF NOT EXISTS trainer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  price REAL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('booked','cancelled','completed')) DEFAULT 'booked',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(trainer_id, date, start_time)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT
);

CREATE TABLE IF NOT EXISTS trial_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  age INTEGER,
  goal TEXT,
  preferred_date TEXT,
  preferred_time TEXT,
  experience_level TEXT,
  status TEXT NOT NULL CHECK(status IN ('new','contacted','trial_booked','trial_completed','converted','not_interested')) DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tour_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rescheduled','cancelled','completed')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new','read','responded','closed')) DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fitness_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT (date('now')),
  weight REAL,
  body_fat REAL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS fitness_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT, experience_level TEXT, days_per_week TEXT, preferred_training TEXT, available_time TEXT,
  recommended_plan_id INTEGER REFERENCES membership_plans(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_name TEXT NOT NULL, goal TEXT, duration TEXT, result TEXT,
  rating INTEGER DEFAULT 5, photo_url TEXT, published INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT, image_url TEXT, sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL, answer TEXT NOT NULL, sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_class_bookings_class ON class_bookings(class_id, class_date);
CREATE INDEX IF NOT EXISTS idx_class_bookings_user ON class_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_trainer_sessions_trainer ON trainer_sessions(trainer_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(name, created_at);
`);

// ---- tiny query helpers (parameterized everywhere — no string-built SQL with user input) ----
const run = (sql, params = []) => db.prepare(sql).run(...params);
const get = (sql, params = []) => db.prepare(sql).get(...params);
const all = (sql, params = []) => db.prepare(sql).all(...params);
// BEGIN IMMEDIATE takes the write lock up front, so capacity checks + inserts can't interleave across processes
const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

function nextDate(dow) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- DEMO seed data: only runs on an empty database. Set SEED_DEMO=false to start clean (admin only). ----
function seed() {
  if (get('SELECT COUNT(*) c FROM users').c > 0) return;
  const genCode = () => 'IL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const mkUser = (email, pw, role, name, phone) =>
    run(`INSERT INTO users (email,password_hash,role,name,phone,member_code,email_verified) VALUES (?,?,?,?,?,?,1)`,
      [email, hash(pw), role, name, phone, genCode()]).lastInsertRowid;

  if (process.env.SEED_DEMO === 'false') {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + '1A';
    mkUser(process.env.ADMIN_EMAIL || 'admin@ironlab.gym', pw, 'admin', 'Administrator', null);
    console.log(`[seed] clean install. Admin: ${process.env.ADMIN_EMAIL || 'admin@ironlab.gym'} / ${pw}  (change it after first login)`);
    return;
  }
  console.log('[seed] empty database — seeding DEMO data (do not use in production)...');
  mkUser('admin@ironlab.gym', 'Admin123!', 'admin', 'Dana Cole', '555-0100');

  const trainerSeed = [
    ['marcus@ironlab.gym', 'Marcus Reyes', 'Strength & Powerlifting', 'Former competitive powerlifter, now focused on building strength safely for everyday athletes.', 9, 'CSCS, USAPL', 70],
    ['elena@ironlab.gym', 'Elena Voss', 'HIIT & Conditioning', 'Programs high-output conditioning that scales to any fitness level without burning members out.', 7, 'NASM-CPT', 65],
    ['jordan@ironlab.gym', 'Jordan Blake', 'Boxing & Mobility', 'Amateur boxing background; blends pad work with mobility so members move as well as they hit.', 11, 'USA Boxing L1', 75],
    ['aisha@ironlab.gym', 'Aisha Kone', 'Yoga & Recovery', 'Certified yoga and mobility coach helping members recover faster and train more consistently.', 6, 'RYT-500', 60],
    ['sam@ironlab.gym', 'Sam Ortiz', 'Functional & CrossFit', 'Coaches functional conditioning and CrossFit-style programming for general population athletes.', 5, 'CF-L2', 60],
  ];
  const trainerIds = trainerSeed.map(([email, name, specialty, bio, exp, certs, price]) => {
    const uid = mkUser(email, 'Trainer123!', 'trainer', name, '555-0101');
    const tid = run(`INSERT INTO trainers (user_id,specialty,bio,experience_years,certifications,session_price) VALUES (?,?,?,?,?,?)`, [uid, specialty, bio, exp, certs, price]).lastInsertRowid;
    for (let wd = 1; wd <= 5; wd++) run(`INSERT INTO trainer_availability (trainer_id,weekday,start_time,end_time) VALUES (?,?,?,?)`, [tid, wd, '06:00', '18:00']);
    return tid;
  });

  const plans = [
    ['Essential', 'Core access for building a consistent habit.', 59, 590, '4 / month', 0, 0, 'Stretch area', 'Core facility access,4 classes/mo,Standard locker'],
    ['Essential Annual', 'Essential, billed yearly (2 months free).', 59, 590, '4 / month', 0, 0, 'Stretch area', 'Core facility access,4 classes/mo,Standard locker'],
    ['Performance', 'Full access with monthly coaching.', 99, 990, 'Unlimited', 1, 2, 'Stretch + mobility', 'All training zones,Unlimited classes,1 PT session/mo,Premium locker'],
    ['Performance Annual', 'Performance, billed yearly (2 months free).', 99, 990, 'Unlimited', 1, 2, 'Stretch + mobility', 'All training zones,Unlimited classes,1 PT session/mo,Premium locker'],
    ['Elite', 'All access plus the full recovery suite.', 169, 1690, 'Unlimited', 4, 999, 'Full recovery suite', 'All zones + private suite,Unlimited classes,4 PT sessions/mo,Unlimited guests'],
  ];
  const planIds = plans.map((p) => run(`INSERT INTO membership_plans (name,description,monthly_price,yearly_price,classes_included,pt_sessions_included,guest_passes,recovery_access,benefits) VALUES (?,?,?,?,?,?,?,?,?)`, p).lastInsertRowid);

  const memberNames = [['david@example.com', 'David M.'], ['priya@example.com', 'Priya S.'], ['tom@example.com', 'Tom H.'], ['aaliyah@example.com', 'Aaliyah R.'], ['chen@example.com', 'Chen W.'], ['maria@example.com', 'Maria G.'], ['liam@example.com', 'Liam O.'], ['noor@example.com', 'Noor A.'], ['jake@example.com', 'Jake P.'], ['sofia@example.com', 'Sofia R.'], ['ben@example.com', 'Ben K.']];
  const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
  const memberIds = memberNames.map(([email, name], i) => {
    const uid = mkUser(email, 'Member123!', 'member', name, '555-02' + String(10 + i));
    const plan = planIds[i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 4];
    const start = new Date(today); start.setMonth(start.getMonth() - 1);
    const exp = new Date(today); exp.setMonth(exp.getMonth() + (i === 2 ? 0 : 1)); exp.setDate(exp.getDate() + (i === 2 ? 5 : 0));
    const mid = run(`INSERT INTO memberships (user_id,plan_id,billing_cycle,start_date,expiration_date,status,renewal_date,payment_status) VALUES (?,?,?,?,?,?,?,?)`, [uid, plan, 'monthly', iso(start), iso(exp), 'active', iso(exp), 'paid']).lastInsertRowid;
    run(`INSERT INTO payments (user_id,membership_id,amount,provider,provider_txn_id,status) VALUES (?,?,?,?,?,?)`, [uid, mid, 59, 'mock', 'mock_' + crypto.randomBytes(5).toString('hex'), 'succeeded']);
    for (let d = 0; d < 6; d++) { const day = new Date(today); day.setDate(day.getDate() - d * 2); run(`INSERT INTO attendance (user_id,date,check_in) VALUES (?,?,?)`, [uid, iso(day), '07:15']); }
    return uid;
  });

  const classSeed = [
    ['Foundations Strength', 'Strength', 0, '06:00', '07:00', 20, trainerIds[0]], ['Iron Circuit HIIT', 'HIIT', 0, '18:00', '19:00', 18, trainerIds[1]],
    ['Power Hour', 'Strength', 1, '07:00', '08:00', 16, trainerIds[0]], ['Ring Craft Boxing', 'Boxing', 1, '18:30', '19:30', 10, trainerIds[2]],
    ['Slow Flow Yoga', 'Yoga', 2, '08:00', '09:00', 20, trainerIds[3]], ['Metabolic Cardio', 'Cardio', 2, '17:30', '18:15', 20, trainerIds[1]],
    ['CrossFit WOD', 'CrossFit', 3, '06:00', '07:00', 15, trainerIds[4]], ['Heavy Bag Boxing', 'Boxing', 3, '19:00', '20:00', 14, trainerIds[2]],
    ['Restorative Yoga', 'Yoga', 4, '08:00', '09:00', 20, trainerIds[3]], ['Sprint Cardio', 'Cardio', 4, '18:00', '18:45', 20, trainerIds[1]],
    ['Functional Flow', 'Functional Training', 4, '12:00', '13:00', 16, trainerIds[4]], ['CrossFit Strength', 'CrossFit', 5, '09:00', '10:00', 15, trainerIds[4]],
    ['Full Body HIIT', 'HIIT', 5, '10:30', '11:30', 18, trainerIds[1]],
  ]; // day index here: 0=Mon … 5=Sat → stored as JS weekday (Mon=1 … Sat=6)
  const classIds = classSeed.map((c) => run(`INSERT INTO classes (name,type,day_of_week,start_time,end_time,capacity,trainer_id) VALUES (?,?,?,?,?,?,?)`, [c[0], c[1], c[2] + 1, c[3], c[4], c[5], c[6]]).lastInsertRowid);
  classIds.slice(0, 5).forEach((cid, i) => {
    const dow = get('SELECT day_of_week d FROM classes WHERE id=?', [cid]).d;
    memberIds.slice(0, 4 + i).forEach((uid) => { try { run(`INSERT INTO class_bookings (class_id,user_id,class_date) VALUES (?,?,?)`, [cid, uid, nextDate(dow)]); } catch (_) {} });
  });

  [['David M.', 'Lose 30 lbs', '6 months', 'Down 32 lbs and pulling 2x bodyweight off the floor.', 5, 1], ['Priya S.', 'Build strength', '9 months', 'Squat up 65 lbs, and landed her first strict pull-up.', 5, 1], ['Tom H.', 'Return after injury', '12 months', 'Rebuilt mobility and finished his first marathon.', 5, 1], ['Aaliyah R.', 'General fitness', '5 months', 'Built a consistent 3x/week habit through group classes.', 4, 0]]
    .forEach((t) => run(`INSERT INTO testimonials (member_name,goal,duration,result,rating,published) VALUES (?,?,?,?,?,?)`, t));
  [['Weight Area', 'Free weights, power racks, and platforms for every lift.'], ['Cardio Area', 'Bright, window-lit cardio floor with class-integrated screens.'], ['Functional Training', 'Turf lanes, sleds, and rigs for athletic conditioning.'], ['Boxing Area', 'Heavy bags, pad work, and a full ring.'], ['Locker Room', 'Private suites with premium amenities.'], ['Recovery Area', 'Guided stretch, mobility work, and wind-down space.']]
    .forEach((f, i) => run(`INSERT INTO facilities (name,description,image_url,sort_order) VALUES (?,?,?,?)`, [f[0], f[1], '', i + 1]));
  [['Can I freeze my membership?', 'Yes. Performance and Elite members can freeze for up to 60 days per year at no charge.'], ['Do I need to book classes in advance?', 'Strength and CrossFit sessions need 2 hours notice. Open floor and cardio are drop-in.'], ['Is personal training included?', 'Elite includes 4 sessions monthly. Essential and Performance members can add sessions à la carte.'], ["What's the cancellation policy?", '30 days notice, no cancellation fee, and your final month is prorated.'], ['Do you offer passes for visitors?', 'Guest passes are included with Performance and Elite, and available to purchase otherwise.']]
    .forEach((f, i) => run(`INSERT INTO faqs (question,answer,sort_order) VALUES (?,?,?)`, [f[0], f[1], i]));
  run(`INSERT INTO settings (key,value) VALUES ('hero_headline','Where discipline takes shape.')`);
  run(`INSERT INTO settings (key,value) VALUES ('hero_subhead','No shortcuts, no gimmicks — just honest training and a team that pushes you toward real results.')`);
  console.log('[seed] done. Demo logins — admin@ironlab.gym / Admin123!, marcus@ironlab.gym / Trainer123!, david@example.com / Member123!');
}
seed();

module.exports = { db, run, get, all, tx, nextDate };
