/* Shared helpers: API client, escaping, toast, modal, SVG charts, QR, check-in panel. No secrets live in frontend code. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toFixed(2).replace(/\.00$/, '');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtDate = (d) => { if (!d) return '—'; const x = new Date(d.length === 10 ? d + 'T00:00:00' : d.replace(' ', 'T') + 'Z'); return isNaN(x) ? d : x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch('/api' + path, init); } catch (_) { throw Object.assign(new Error('Cannot reach the server. Check your connection and try again.'), { status: 0 }); }
  let data = {}; try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
  return data;
}
const put = (p, body) => api(p, { method: 'PUT', body });
const patch = (p, body) => api(p, { method: 'PATCH', body });
const del = (p) => api(p, { method: 'DELETE' });

function toast(msg, type = 'ok') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, type === 'err' ? 6000 : 3800);
}
/* Run an async action on a button with loading + error handling (never fails silently). */
async function withBtn(btn, fn, loading = 'Please wait…') {
  const label = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = loading; }
  try { return await fn(); } catch (e) { toast(e.message, 'err'); throw e; } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

/* ---------- modal ---------- */
function ensureModal() {
  let bg = $('#modalBg');
  if (!bg) { bg = document.createElement('div'); bg.id = 'modalBg'; bg.className = 'modal-bg'; bg.innerHTML = '<div class="modal glass" id="modalBox" role="dialog" aria-modal="true"></div>'; document.body.appendChild(bg);
    bg.addEventListener('click', (e) => { if (e.target === bg) closeModal(); }); addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); }); }
  return bg;
}
function openModal(html, wide) {
  const bg = ensureModal(); const box = $('#modalBox'); box.classList.toggle('wide', !!wide);
  box.innerHTML = '<button class="modal-close" aria-label="Close" data-close>&times;</button>' + html; bg.classList.add('open');
  $('[data-close]', box).onclick = closeModal; const f = $('input:not([type=hidden]):not(.hp),select,textarea', box); if (f) setTimeout(() => f.focus(), 50);
  return box;
}
function closeModal() { const bg = $('#modalBg'); if (bg) bg.classList.remove('open'); }
/* form helper: values -> object, inline error line, submit loading state */
function bindForm(form, submit) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const err = $('.form-err', form); if (err) err.textContent = '';
    const btn = $('button[type=submit]', form); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    try { await submit(Object.fromEntries(new FormData(form).entries()), form); }
    catch (ex) { if (err) err.textContent = ex.message; else toast(ex.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
}
const field = (label, name, o = {}) => `<div class="field"><label for="f_${name}">${label}</label>${o.options
  ? `<select id="f_${name}" name="${name}" ${o.required ? 'required' : ''}>${o.options.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(o.value ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`
  : o.area ? `<textarea id="f_${name}" name="${name}" ${o.required ? 'required' : ''} maxlength="${o.max || 2000}">${esc(o.value)}</textarea>`
  : `<input id="f_${name}" name="${name}" type="${o.type || 'text'}" value="${esc(o.value)}" ${o.required ? 'required' : ''} ${o.min != null ? `min="${esc(o.min)}"` : ''} ${o.max != null ? `max="${esc(o.max)}"` : ''} ${o.autocomplete ? `autocomplete="${o.autocomplete}"` : ''} ${o.step ? `step="${o.step}"` : ''}>`}</div>`;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const homeFor = (role) => role === 'admin' ? '/dashboard/admin.html' : role === 'trainer' ? '/dashboard/trainer.html' : '/dashboard/member.html';

/* ---------- SVG charts (no dependencies) ---------- */
function barChart(data, { color = 'var(--accent)', fmt = (v) => v, height = 150 } = {}) {
  const W = 420, H = height, pad = 22, max = Math.max(1, ...data.map((d) => d.value)), bw = (W - pad) / data.length;
  return `<svg viewBox="0 0 ${W} ${H + 22}" class="chart" role="img">${data.map((d, i) => { const h = Math.round((d.value / max) * (H - 18)); const x = pad / 2 + i * bw + bw * .18;
    return `<rect x="${x}" y="${H - h}" width="${bw * .64}" height="${h}" rx="2" fill="${color}" opacity=".9"><title>${esc(d.label)}: ${fmt(d.value)}</title></rect>${data.length <= 14 || i % 2 === 0 ? `<text x="${x + bw * .32}" y="${H + 14}" text-anchor="middle">${esc(String(d.label).slice(data.length > 7 ? 8 : 5))}</text>` : ''}`; }).join('')}
    <text x="2" y="10" class="mx">${fmt(max)}</text></svg>`;
}
function lineChart(points, { color = 'var(--accent)', unit = '' } = {}) {
  if (points.length < 2) return '<p class="muted small">Log at least two entries to see a trend.</p>';
  const W = 420, H = 150, vals = points.map((p) => p.value), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const xy = points.map((p, i) => [14 + (i * (W - 28)) / (points.length - 1), H - 14 - ((p.value - min) / span) * (H - 34)]);
  return `<svg viewBox="0 0 ${W} ${H + 22}" class="chart" role="img"><polyline fill="none" stroke="${color}" stroke-width="2.5" points="${xy.map((p) => p.join(',')).join(' ')}"/>
    ${xy.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${color}"><title>${esc(points[i].label)}: ${points[i].value}${unit}</title></circle>`).join('')}
    <text x="2" y="10" class="mx">${max}${unit}</text><text x="2" y="${H}" class="mx">${min}${unit}</text><text x="${W - 4}" y="${H + 16}" text-anchor="end">${esc(points[points.length - 1].label.slice(5))}</text></svg>`;
}
function qrSvg(text, size = 200) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); const n = qr.getModuleCount(), q = 4; let p = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) p += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="Member QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#0a0d11"/></svg>`;
}
const badge = (s) => `<span class="badge b-${esc(String(s).replace(/_/g, '-'))}">${esc(String(s).replace(/_/g, ' '))}</span>`;
async function logout() { try { await api('/auth/logout', { method: 'POST', body: {} }); } catch (_) {} location.href = '/'; }
/* Gate for dashboards: returns the user or redirects. */
async function requireRole(...roles) {
  let u = null; try { u = (await api('/auth/me')).user; } catch (_) {}
  if (!u) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash); return new Promise(() => {}); }
  if (!roles.includes(u.role)) { location.href = homeFor(u.role); return new Promise(() => {}); }
  return u;
}

/* ---------- staff check-in panel: camera QR scan (jsQR) + manual member-code entry ---------- */
function checkinPanel(box, onDone) {
  box.innerHTML = `<div class="scanner"><video id="cam" playsinline muted hidden></video><canvas id="camc" hidden></canvas></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0"><button class="btn btn-outline sm" id="camBtn">Start camera scan</button></div>
    <form id="ciForm" style="display:flex;gap:10px;flex-wrap:wrap"><input name="member_code" placeholder="Member code e.g. IL-3F9A12CD" autocomplete="off" style="flex:1;min-width:200px;background:var(--surface2);border:1px solid var(--line2);border-radius:var(--radius);padding:12px;color:var(--white);font:inherit" required><button class="btn btn-primary" type="submit">Check in / out</button></form>
    <p class="form-err" id="ciErr" role="alert"></p><p id="ciOk" style="color:#6fdc9c;font-size:14px"></p>`;
  let stream = null, timer = null, busy = false;
  const submit = async (code) => { if (busy) return; busy = true; $('#ciErr', box).textContent = ''; $('#ciOk', box).textContent = '';
    try { const r = await api('/attendance/checkin', { body: { member_code: code } }); $('#ciOk', box).textContent = r.message; toast(r.message); if (onDone) onDone(); }
    catch (e) { $('#ciErr', box).textContent = e.message; } finally { setTimeout(() => { busy = false; }, 2500); } };
  $('#ciForm', box).onsubmit = (e) => { e.preventDefault(); submit(new FormData(e.target).get('member_code').trim().toUpperCase()); e.target.reset(); };
  const stop = () => { if (timer) cancelAnimationFrame(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('#cam', box).hidden = true; $('#camBtn', box).textContent = 'Start camera scan'; };
  $('#camBtn', box).onclick = async () => {
    if (stream) return stop();
    if (!navigator.mediaDevices || !window.jsQR) return toast('Camera scanning is unavailable here — enter the code manually.', 'err');
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (_) { return toast('Camera permission denied — enter the code manually.', 'err'); }
    const v = $('#cam', box), c = $('#camc', box), ctx = c.getContext('2d', { willReadFrequently: true }); v.srcObject = stream; v.hidden = false; await v.play(); $('#camBtn', box).textContent = 'Stop camera';
    const tick = () => { if (!stream) return; if (v.readyState === v.HAVE_ENOUGH_DATA) { c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0); const img = ctx.getImageData(0, 0, c.width, c.height); const q = jsQR(img.data, c.width, c.height); if (q && /^IL-[0-9A-F]{8}$/i.test(q.data)) submit(q.data.toUpperCase()); } timer = requestAnimationFrame(tick); };
    tick();
  };
  return stop;
}
