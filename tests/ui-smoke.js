// Loads the real pages in jsdom against a RUNNING server and checks they render + have no runtime errors.
//   BASE=http://localhost:3111 node tests/ui-smoke.js     (needs: npm install  — jsdom is a devDependency)
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0; const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? '  PASS ' : '  FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return r.headers.get('set-cookie').split(';')[0];
}
async function open(path, cookie) {
  const errors = []; const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not load|not implemented|Not implemented/i.test(e.message)) errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = await JSDOM.fromURL(BASE + path, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o = {}) => fetch(new URL(u, BASE).href, { ...o, headers: { ...(o.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.HTMLMediaElement.prototype.play = () => Promise.resolve(); w.HTMLMediaElement.prototype.pause = () => {}; w.HTMLMediaElement.prototype.load = () => {};
      w.scrollTo = () => {}; w.confirm = () => true; w.alert = () => {};
    } });
  return { dom, w: dom.window, d: dom.window.document, errors };
}
const go = async (p, hash) => { p.w.location.hash = hash; await sleep(700); };

(async () => {
  console.log('Marketing site (anonymous)');
  let p = await open('/'); await sleep(2500); let d = p.d;
  ok(d.querySelectorAll('#plansGrid .plan-card').length === 3, '3 membership plans rendered from the API');
  ok(d.querySelectorAll('#classGrid .class-card').length >= 10, 'class schedule rendered with live availability');
  ok(/\d+ \/ \d+/.test(d.querySelector('#classGrid').textContent) && /spots? remaining|FULLY BOOKED/.test(d.querySelector('#classGrid').textContent), 'shows "n / capacity booked" + remaining spots');
  ok(d.querySelectorAll('#trainerGrid .t-card').length === 5, '5 trainers rendered');
  ok(d.querySelectorAll('#faqList .faq-item').length === 5, 'FAQs rendered from the CMS');
  ok(d.querySelectorAll('#storyGrid .res-card').length >= 3 && !d.querySelector('#storyGrid').textContent.includes('Aaliyah R.'), 'published testimonials rendered; the unpublished one is hidden');
  ok(d.querySelector('.hero h1').textContent.includes('discipline'), 'hero headline comes from the CMS');
  ok(d.querySelectorAll('#cmpTable tbody tr').length >= 5, 'compare-plans table built from plans');
  d.querySelector('[data-cbook]').click(); await sleep(600);
  ok(d.querySelector('#modalBg.open #authForm'), 'booking a class while logged out opens the login modal');
  p.w.closeModal(); p.w.openTrial(); await sleep(200);
  const tf = d.querySelector('#trialForm'); const set = (n, v) => { tf.querySelector(`[name=${n}]`).value = v; };
  set('name', 'UI Tester'); set('email', `ui${Date.now()}@example.com`); set('phone', '555-222-3333'); set('preferred_date', new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10));
  tf.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true })); await sleep(900);
  ok(/on the list/i.test(d.querySelector('#modalBox').textContent), 'free-trial form submits to the API and shows confirmation');
  p.w.closeModal(); p.w.openTrial(); await sleep(200);
  d.querySelector('#trialForm [name=name]').value = 'x'; d.querySelector('#trialForm').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true })); await sleep(700);
  ok(/valid email/i.test(d.querySelector('#trialForm .form-err').textContent), 'invalid trial form shows a friendly server-side error');
  const cf = d.querySelector('#contact form'); cf.querySelector('[name=name]').value = 'Ann'; cf.querySelector('[name=email]').value = 'ann@example.com'; cf.querySelector('[name=message]').value = 'Do you have parking available?';
  cf.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true })); await sleep(900);
  ok(/Message sent/.test(d.querySelector('#contactOk').textContent), 'contact form saves via the API');
  d.querySelectorAll('.f-opt').forEach(() => {}); // plan finder end-to-end
  for (const q of ['goal', 'exp', 'freq', 'style', 'time']) { d.querySelector(`.f-opts[data-q=${q}] .f-opt`).click(); p.w.finderNext(); await sleep(60); }
  await sleep(900); ok(/ESSENTIAL|PERFORMANCE|ELITE/.test(d.querySelector('#fTier').textContent), 'plan finder (5 questions) returns a recommendation from the API');
  ok(p.errors.length === 0, 'no JavaScript errors on the marketing site' + (p.errors.length ? ' → ' + p.errors[0] : '')); p.w.close();

  console.log('Member dashboard');
  const mc = await login('david@example.com', 'Member123!'); p = await open('/dashboard/member.html', mc); await sleep(1500); d = p.d;
  ok(/Hey David/.test(d.querySelector('#view').textContent), 'home loads for the logged-in member');
  ok(/Day streak/.test(d.querySelector('#view').textContent) && d.querySelectorAll('.quick a').length === 5, 'streak + 5 quick actions present');
  ok(d.querySelectorAll('#mbar a').length === 5, 'mobile bottom nav has Home/Classes/Bookings/Membership/Profile');
  for (const [h, t] of [['#classes', /spots booked/], ['#bookings', /Upcoming classes/], ['#trainers', /Book session/], ['#membership', /Payment history/], ['#progress', /Log today/], ['#profile', /check-in code/]]) { await go(p, h); ok(t.test(d.querySelector('#view').textContent) && !d.querySelector('#view .form-err:not(:empty)'), `view ${h} renders`); }
  ok(d.querySelector('.qrbox svg path'), 'profile shows a generated QR code');
  ok(p.errors.length === 0, 'no JavaScript errors in the member dashboard' + (p.errors.length ? ' → ' + p.errors[0] : '')); p.w.close();

  console.log('Trainer dashboard');
  const tc = await login('marcus@ironlab.gym', 'Trainer123!'); p = await open('/dashboard/trainer.html', tc); await sleep(1500); d = p.d;
  ok(/Sessions today/.test(d.querySelector('#view').textContent), 'trainer home loads');
  for (const h of ['#upcoming', '#members', '#schedule', '#checkin', '#alerts']) { await go(p, h); ok(d.querySelector('#view').textContent.length > 20 && !d.querySelector('#view > .form-err'), `view ${h} renders`); }
  await go(p, '#checkin'); ok(d.querySelector('#ciForm') && d.querySelector('#camBtn'), 'check-in desk has manual code entry + camera scan button');
  ok(p.errors.length === 0, 'no JavaScript errors in the trainer dashboard' + (p.errors.length ? ' → ' + p.errors[0] : '')); p.w.close();

  console.log('Admin dashboard');
  const ac = await login('admin@ironlab.gym', 'Admin123!'); p = await open('/dashboard/admin.html', ac); await sleep(1800); d = p.d;
  ok(/Total members/.test(d.querySelector('#view').textContent) && d.querySelectorAll('svg.chart').length >= 5, 'overview shows KPIs + 5 charts');
  for (const h of ['#members', '#bookings', '#messages', '#attendance', '#plans', '#classes', '#trainers', '#site', '#testimonials', '#facilities', '#faqs']) { await go(p, h); ok(d.querySelector('#view').textContent.length > 20 && !d.querySelector('#view > .form-err'), `tab ${h} renders`); }
  await go(p, '#members'); d.querySelector('[data-view]').click(); await sleep(900); ok(/Memberships/.test(d.querySelector('#modalBox').textContent), 'member detail modal opens');
  p.w.closeModal(); await go(p, '#plans'); d.querySelector('#add').click(); await sleep(200); ok(d.querySelector('#cf'), 'CMS "Add new" form opens');
  ok(p.errors.length === 0, 'no JavaScript errors in the admin dashboard' + (p.errors.length ? ' → ' + p.errors[0] : '')); p.w.close();

  console.log('Access control in the UI');
  p = await open('/dashboard/admin.html', mc); await sleep(1200); ok(!/Total members/.test(p.d.querySelector('#view').textContent), 'a member cannot see admin data in the admin page (redirected away)'); p.w.close();

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
