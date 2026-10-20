# Iron Lab — gym website + booking platform

A working full-stack app: cinematic marketing site, member / trainer / admin dashboards, a REST API and a real
relational database. **Node ≥ 22.5**, Express, SQLite (Node's built-in `node:sqlite`), no build step.

**Windows:** double-click `start.bat` (installs on first run, starts the server, opens the browser).

```bash
npm install
npm start            # http://localhost:3000   (demo data is seeded on first run)
npm test             # 57 API checks + 49 UI checks against a throw-away server
```

Fonts (Barlow Condensed + Poppins) and the QR libraries are bundled locally, so the app and dashboards work offline.
Internet is only needed for the stock photos/videos the marketing page hotlinks (Unsplash/Pexels) — replace them with your own.

## Demo accounts (development only — created when `SEED_DEMO` is not `false`)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@ironlab.gym` | `Admin123!` |
| Trainer | `marcus@ironlab.gym` (also `elena@`, `jordan@`, `aisha@`, `sam@`) | `Trainer123!` |
| Member | `david@example.com` (also `priya@`, `tom@`, … 11 members) | `Member123!` |

Pages: `/` site · `/login.html` · `/dashboard/member.html` · `/dashboard/trainer.html` · `/dashboard/admin.html`

## Going live checklist

1. Copy `.env.example` → `.env`; set `NODE_ENV=production`, a long random `AUTH_SECRET`, `PUBLIC_URL`, `SEED_DEMO=false`,
   `ADMIN_EMAIL`. The app **refuses to start** in production without `AUTH_SECRET`. Cookies are `Secure` in production → serve over **HTTPS**
   (nginx/Caddy in front, `TRUST_PROXY=1`).
2. **Payments:** set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; in Stripe point a webhook at
   `POST {PUBLIC_URL}/api/payments/webhook` for `checkout.session.completed` and `checkout.session.expired`.
3. **Email:** set `RESEND_API_KEY` + `EMAIL_FROM` (verified domain). Until then emails are printed to the server console.
4. Back up `data/` (the SQLite file and `data/uploads/`).
5. Replace the placeholder trainers/testimonials/photos in the admin dashboard; change the WhatsApp number in *Site content*.

## What is real and tested

* **Auth & accounts** — signup, login/logout, forgot/reset password (hashed one-hour token), email verification link, change password, profile, profile-photo upload (type allow-list + magic-byte check + random filenames). Roles `member | trainer | admin` enforced server-side on every route. bcrypt hashing, httpOnly SameSite cookies, suspended accounts are locked out immediately.
* **Memberships** — plans managed in the admin UI (price monthly/yearly, classes, PT sessions, guest passes, recovery, benefits, status). Purchase, renew, upgrade/downgrade, cancel-renewal (access continues to the paid end date), automatic expiry, 30/7/1-day expiry reminders, benefits restricted to active memberships.
* **Classes** — live capacity ("12 / 20 booked", "8 spots remaining", FULLY BOOKED), duplicate-booking prevention, **transaction-safe booking** (6 concurrent users racing for seats never overbook — tested), **waitlist** with automatic promotion + notification when someone cancels.
* **Personal training** — trainer profiles, availability windows, hourly slots, **double booking is impossible** (database UNIQUE constraint), plan-included sessions are free, others are charged.
* **Leads** — free-trial form (full spec fields), tour requests, contact form; stored with statuses, honeypot + per-IP rate limits + duplicate check, admin notified. Admin can change status, reschedule tours, reply by mail link.
* **Attendance & QR** — every member has a unique code + QR (profile page). Staff/trainers check members in/out by **camera scan** or typing the code; duplicate scans within 10 min are ignored; inactive memberships are refused. Daily/weekly/monthly reports.
* **Progress** — weight, body-fat %, notes, charts, attendance consistency. Private to the member, admins, and trainers who have trained that member.
* **Plan-finder quiz** — answers stored; recommends plan, classes and a coach; rules editable by admin (JSON) in *Site content*.
* **Admin** — KPIs (members, active, new, today's attendance/bookings, monthly revenue, pending payments, leads, tours), 5 charts, event analytics + conversion rates, member search/filter/pagination/detail/suspend/edit, booking management for classes/sessions/trials/tours, message inbox, trainer management (create with temp password, edit, photo, availability, disable), CMS for hero text/video URL/announcement/WhatsApp, plans, classes, testimonials (publish/unpublish), facilities, FAQs, image uploads.
* **Responsive dashboards** — members get a mobile bottom bar (Home · Classes · Bookings · Membership · Profile); staff get a scrolling top nav.
* **Security** — parameterized SQL everywhere, escaped output (XSS), server-side validation, role checks, CSRF guard (JSON-only + Origin check), rate limiting, helmet headers, no secrets in frontend code. Tested: SQL-injection-style login, cross-origin writes, RBAC on every area.

## Honest limits — read before launching

**Needs your credentials / not verified live**
* **Stripe** is implemented as hosted Checkout + signed webhook, but I could not test it without your keys. Only the `mock` provider (no real money) was exercised. Test with Stripe test keys first. Card data never touches this server.
* **Email** — the Resend transport is written but untested. Transactional emails (welcome, verify, reset, booking, receipt, reminders, trial, tour, expiry) are generated, but by default only printed to the console.
* **SMS / WhatsApp** — architecture hook only (`sendSms` in `server/lib.js`). The site's WhatsApp button is a `wa.me` link.

**Not built**
* Google sign-in. Refund workflow (status exists; no UI/Stripe refund call). PDF/emailed receipts (receipts are on-screen and printable). Strength/personal-record tracking and body measurements beyond weight/body-fat (use the notes field). Guest-pass redemption (stored on plans, not enforced). Video upload (hero video is a URL). Waitlist "claim within X hours" step (members are auto-promoted instead). Booking a class on an arbitrary future date (you book the next occurrence of the weekly class). Real-time push updates (availability is always correct on each request, but pages don't live-refresh).

**Platform caveats**
* SQLite = one server, great for a single gym; move to Postgres for multi-instance (replace `server/db.js`). `node:sqlite` is flagged experimental in Node 22.
* Rate limiting is in-memory (resets on restart, per instance). Sessions are 7-day JWTs (logout clears the cookie; suspension is checked on every request). CSP is relaxed because the marketing page loads fonts/stock media. No 2FA.
* Tests drive real pages in **jsdom, not a real browser** — layout, mobile appearance and camera scanning were not visually verified. No load testing, no third-party security audit. Add a privacy policy / terms and review data-protection rules for your region before collecting member data.
* The marketing page hotlinks Unsplash/Pexels stock media. Swap in your own photography/video before launch.
* Visual design: red / black / white theme. Colours live in the `:root` block at the top of `public/css/theme.css` (`--accent` is the red); fonts are in `public/fonts/`.

## Layout

```
server/  index.js · db.js (schema+seed) · lib.js (security, email, payment adapters) · routes/{public,member,staff,admin}.js
public/  index.html (marketing) · login/signup/forgot/reset/verify.html · dashboard/{member,trainer,admin}.html · css/ · js/ · fonts/
tests/   smoke.js (API) · ui-smoke.js (pages in jsdom) · run.js (`npm test`)
```

API groups: `/api/auth`, `/api/classes`, `/api/trainers`, `/api/sessions`, `/api/plans`, `/api/memberships`, `/api/payments/webhook`,
`/api/me/*`, `/api/attendance`, `/api/trainer/*`, `/api/staff/*`, `/api/trials`, `/api/tours`, `/api/contact`, `/api/quiz`, `/api/public/content`, `/api/track`, `/api/admin/*`.
Schema (21 tables, FKs, CHECK constraints, indexes) is at the top of `server/db.js`. Roles are a constrained column on `users`, and uploaded media are files in `data/uploads/` referenced by URL fields (no separate `roles`/`media` tables).
