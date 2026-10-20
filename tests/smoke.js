// End-to-end smoke test against a RUNNING server (fresh demo-seeded database):
//   RATE_LIMIT_MULTIPLIER=100 PORT=3111 node server/index.js   (terminal 1)
//   BASE=http://localhost:3111 node tests/smoke.js              (terminal 2)
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (c, msg) => { (c ? pass++ : fail++); console.log((c ? '  PASS ' : '  FAIL ') + msg); };
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let j = {}; try { j = await r.json(); } catch (_) {}
    return { s: r.status, j };
  };
}
const ymdPlus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  const anon = client(), me = client(), admin = client(), trainer = client();
  const email = `t${Date.now()}@example.com`;

  console.log('Auth');
  let r = await me('POST', '/auth/signup', { name: 'Test User', email, password: 'short' }); ok(r.s === 400, 'weak password rejected');
  r = await me('POST', '/auth/signup', { name: 'Test User', email, password: 'Passw0rd!x' }); ok(r.s === 201 && r.j.user.role === 'member', 'signup creates a member + session');
  r = await me('POST', '/auth/signup', { name: 'Dup', email, password: 'Passw0rd!x' }); ok(r.s === 409, 'duplicate email rejected');
  r = await anon('POST', '/auth/login', { email, password: 'wrongpass1' }); ok(r.s === 401, 'wrong password rejected');
  r = await me('GET', '/auth/me'); ok(r.j.user && r.j.user.email === email, 'session persists via cookie');
  r = await anon('POST', '/auth/forgot-password', { email: 'nobody@example.com' }); ok(r.s === 200, 'forgot-password does not reveal unknown emails');
  r = await anon('POST', '/auth/reset-password', { token: 'bogus', password: 'Passw0rd!x' }); ok(r.s === 400, 'bad reset token rejected');

  console.log('Security');
  r = await anon('GET', '/me/dashboard'); ok(r.s === 401, 'dashboard requires login');
  r = await me('GET', '/admin/stats'); ok(r.s === 403, 'member blocked from admin API');
  r = await me('POST', '/attendance/checkin', { member_code: 'IL-AAAAAAAA' }); ok(r.s === 403, 'member blocked from staff check-in');
  const raw = await fetch(BASE + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }); ok(raw.status === 415, 'non-JSON writes rejected (CSRF guard)');
  const xo = await fetch(BASE + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' }); ok(xo.status === 403, 'cross-origin writes rejected');
  r = await anon('POST', '/auth/login', { email: "admin@ironlab.gym' OR '1'='1", password: 'x' }); ok(r.s === 401, 'SQL-injection style login fails safely');

  console.log('Public forms');
  r = await anon('POST', '/trials', { name: 'Lead One', email: 'lead1@example.com', phone: 'abc', preferred_date: ymdPlus(2) }); ok(r.s === 400 && /phone/i.test(r.j.error), 'trial: invalid phone message');
  r = await anon('POST', '/trials', { name: 'Lead One', email: 'lead1@example.com', phone: '555-123-4567', age: 30, goal: 'Build muscle', preferred_date: ymdPlus(-3) }); ok(r.s === 400, 'trial: past date rejected');
  const leadEmail = `lead${Date.now()}@example.com`;
  r = await anon('POST', '/trials', { name: 'Lead One', email: leadEmail, phone: '555-123-4567', age: 30, goal: 'Build muscle', preferred_date: ymdPlus(2), preferred_time: '10:00', experience_level: 'Beginner' }); ok(r.s === 201, 'trial saved');
  r = await anon('POST', '/trials', { name: 'Lead One', email: leadEmail, phone: '555-123-4567', preferred_date: ymdPlus(2) }); ok(r.s === 409, 'trial: duplicate request blocked');
  r = await anon('POST', '/trials', { name: 'Bot', email: 'bot@example.com', phone: '555-123-4567', preferred_date: ymdPlus(2), website: 'http://spam' }); ok(r.s === 400, 'honeypot spam rejected');
  r = await anon('POST', '/tours', { name: 'Tour Guy', email: 'tour@example.com', phone: '555-123-4567', date: ymdPlus(3), time: '11:00' }); ok(r.s === 201, 'tour saved');
  r = await anon('POST', '/tours', { name: 'Tour Two', email: 'tour2@example.com', phone: '555-123-4567', date: ymdPlus(3), time: '11:00' }); ok(r.s === 409 && /no longer available/i.test(r.j.error), 'tour: same slot cannot be double-booked');
  r = await anon('POST', '/contact', { name: 'Ann', email: 'ann@example.com', message: 'Hello there, do you have parking?' }); ok(r.s === 201, 'contact saved');
  r = await anon('POST', '/quiz', { goal: 'Build muscle', exp: 'Advanced', freq: '5+', style: 'Solo' }); ok(r.s === 200 && r.j.plan.name === 'Elite', 'quiz recommends Elite for advanced 5+/wk');

  console.log('Memberships + classes');
  r = await anon('GET', '/public/content'); ok(r.j.plans.length === 3 && r.j.testimonials.length === 3, 'public content: 3 plans, only published testimonials');
  const classes = (await me('GET', '/classes')).j.classes; const target = classes.find((c) => c.name === 'Ring Craft Boxing');
  r = await me('POST', `/classes/${classes[0].id}/book`, {}); ok(r.s === 402, 'booking needs an active membership');
  const plans = (await anon('GET', '/plans')).j.plans; const perf = plans.find((p) => p.name === 'Performance');
  r = await me('POST', '/memberships/purchase', { plan_id: perf.id, billing_cycle: 'monthly' }); ok(r.s === 201, 'membership purchased (mock payment)');
  let dash = (await me('GET', '/me/dashboard')).j; ok(dash.membership && dash.membership.is_active && dash.payments[0].receipt.startsWith('IL-R-'), 'dashboard shows active membership + receipt');
  r = await me('POST', `/classes/${target.id}/book`, {}); ok(r.s === 201 && r.j.status === 'booked', 'class booked');
  r = await me('POST', `/classes/${target.id}/book`, {}); ok(r.s === 409, 'duplicate booking prevented');
  const free = (await me('GET', '/classes')).j.classes.find((c) => c.id === target.id);
  const fillers = [];
  for (let i = 0; i < free.remaining; i++) {
    const c = client(); await c('POST', '/auth/signup', { name: 'Filler ' + i, email: `fill${Date.now()}${i}@example.com`, password: 'Passw0rd!x' });
    await c('POST', '/memberships/purchase', { plan_id: perf.id });
    const b = await c('POST', `/classes/${target.id}/book`, {}); if (b.s !== 201) ok(false, 'filler booking ' + i + ' ' + b.j.error);
    fillers.push(c);
  }
  const full = (await me('GET', '/classes')).j.classes.find((c) => c.id === target.id); ok(full.full && full.remaining === 0 && full.booked === full.capacity, `capacity reached → "${full.booked} / ${full.capacity}" FULLY BOOKED`);
  const late = client(); await late('POST', '/auth/signup', { name: 'Late Comer', email: `late${Date.now()}@example.com`, password: 'Passw0rd!x' }); await late('POST', '/memberships/purchase', { plan_id: perf.id });
  r = await late('POST', `/classes/${target.id}/book`, {}); ok(r.s === 409 && r.j.can_waitlist === true, 'full class refuses booking but offers waitlist');
  r = await late('POST', `/classes/${target.id}/book`, { waitlist: true }); ok(r.s === 201 && r.j.status === 'waitlisted', 'joined waitlist');
  r = await fillers[0]('POST', `/classes/${target.id}/cancel`, {}); ok(r.s === 200, 'a booked member cancels');
  const promoted = (await late('GET', '/me/dashboard')).j; ok(promoted.upcoming_classes.some((c) => c.class_id === target.id && c.status === 'booked') && promoted.notifications.some((n) => n.type === 'waitlist_promoted'), 'waitlisted member auto-promoted + notified');

  console.log('Concurrency (race on the same class)');
  const c2 = (await me('GET', '/classes')).j.classes.find((c) => c.name === 'Iron Circuit HIIT');
  const racers = await Promise.all(Array.from({ length: 6 }, async (_, i) => { const c = client(); await c('POST', '/auth/signup', { name: 'Racer ' + i, email: `race${Date.now()}${i}@example.com`, password: 'Passw0rd!x' }); await c('POST', '/memberships/purchase', { plan_id: perf.id }); return c; }));
  const before = (await me('GET', '/classes')).j.classes.find((c) => c.id === c2.id);
  const results = await Promise.all(racers.map((c) => c('POST', `/classes/${c2.id}/book`, {})));
  const after = (await me('GET', '/classes')).j.classes.find((c) => c.id === c2.id);
  ok(after.booked <= after.capacity && after.booked - before.booked === results.filter((x) => x.s === 201).length, `no overbooking (${after.booked}/${after.capacity})`);

  console.log('Trainer booking');
  const tr = (await anon('GET', '/trainers')).j.trainers[0];
  let d = ymdPlus(1); let slots = (await me('GET', `/trainers/${tr.id}/slots?date=${d}`)).j.slots;
  for (let i = 2; !slots.length && i < 9; i++) { d = ymdPlus(i); slots = (await me('GET', `/trainers/${tr.id}/slots?date=${d}`)).j.slots; }
  ok(slots.length > 0, 'trainer has open slots');
  r = await me('POST', `/trainers/${tr.id}/book`, { date: d, start_time: slots[0].start_time }); ok(r.s === 201 && r.j.price === 0, 'session booked (included PT session is free on Performance)');
  r = await late('POST', `/trainers/${tr.id}/book`, { date: d, start_time: slots[0].start_time }); ok(r.s === 409 && /no longer available/i.test(r.j.error), 'double booking prevented');
  slots = (await me('GET', `/trainers/${tr.id}/slots?date=${d}`)).j.slots; ok(slots[0].available === false, 'slot immediately shows as unavailable');

  console.log('Staff, QR attendance, admin');
  await trainer('POST', '/auth/login', { email: 'marcus@ironlab.gym', password: 'Trainer123!' });
  await admin('POST', '/auth/login', { email: 'admin@ironlab.gym', password: 'Admin123!' });
  const code = (await me('GET', '/auth/me')).j.user.member_code;
  r = await trainer('POST', '/attendance/checkin', { member_code: code }); ok(r.s === 200 && r.j.action === 'check_in', 'staff scan checks the member in');
  r = await trainer('POST', '/attendance/checkin', { member_code: code }); ok(r.s === 409, 'duplicate scan within 10 min ignored');
  r = await trainer('POST', '/attendance/checkin', { member_code: 'IL-ZZZZZZZZ' }); ok(r.s === 400, 'malformed code rejected');
  r = await trainer('GET', '/trainer/dashboard'); ok(r.s === 200 && Array.isArray(r.j.today), 'trainer dashboard loads');
  r = await trainer('GET', '/admin/stats'); ok(r.s === 403, 'trainer blocked from admin API');
  r = await trainer('GET', '/staff/members/1/progress'); ok(r.s === 403, "trainer can't read progress of members they don't train");
  r = await me('POST', '/me/progress', { weight: 82.5, body_fat: 18 }); ok(r.s === 201, 'member logs progress');
  r = await me('POST', '/me/progress', { weight: 5 }); ok(r.s === 400, 'implausible weight rejected');
  const s = (await admin('GET', '/admin/stats')).j; ok(s.kpis.total_members >= 12 && s.kpis.monthly_revenue > 0 && s.charts.revenue.length === 6 && s.kpis.todays_attendance >= 1, 'admin KPIs + charts computed from real data');
  const ml = (await admin('GET', '/admin/members?q=Test&page=1')).j; ok(ml.members.length >= 1 && ml.pages >= 1, 'admin member search + pagination');
  const lead = (await admin('GET', '/admin/bookings?type=trial')).j.rows[0];
  r = await admin('PATCH', `/admin/bookings/trial/${lead.id}`, { status: 'contacted' }); ok(r.s === 200, 'admin updates lead status');
  r = await admin('PATCH', `/admin/bookings/trial/${lead.id}`, { status: 'bogus' }); ok(r.s === 400, 'invalid status rejected');
  const tour = (await admin('GET', '/admin/bookings?type=tour')).j.rows[0];
  r = await admin('PATCH', `/admin/bookings/tour/${tour.id}`, { date: ymdPlus(5), time: '15:00' }); ok(r.s === 200, 'admin reschedules a tour');
  r = await admin('GET', '/admin/trainers/1/availability'); ok(r.s === 200 && r.j.availability.length > 0, 'admin can read trainer availability');
  const t = (await admin('POST', '/admin/testimonials', { member_name: 'New Person', result: 'Great', rating: 5, published: 0 })).j;
  ok(!(await anon('GET', '/public/content')).j.testimonials.some((x) => x.member_name === 'New Person'), 'unpublished testimonial hidden from site');
  await admin('PUT', `/admin/testimonials/${t.id}`, { published: 1 });
  ok((await anon('GET', '/public/content')).j.testimonials.some((x) => x.member_name === 'New Person'), 'publishing makes it appear');
  r = await admin('PATCH', `/admin/members/${(await me('GET', '/auth/me')).j.user.id}`, { status: 'suspended' }); ok(r.s === 200, 'admin suspends a member');
  r = await me('GET', '/me/dashboard'); ok(r.s === 401, 'suspended member is locked out immediately');
  r = await anon('POST', '/auth/login', { email, password: 'Passw0rd!x' }); ok(r.s === 403, 'suspended member cannot log in');

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
