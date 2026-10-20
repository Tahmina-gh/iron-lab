// `npm test`: starts a throw-away server (temp database, demo data) and runs the API + UI test suites against it.
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironlab-test-'));
const PORT = 3190 + Math.floor(Math.random() * 50);
const env = { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'test.db'), RATE_LIMIT_MULTIPLIER: '100', SEED_DEMO: 'true', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock' };
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const run = (file) => new Promise((res) => { const p = spawn(process.execPath, [path.join(__dirname, file)], { env: { ...env, BASE: `http://localhost:${PORT}` }, stdio: 'inherit' }); p.on('exit', (c) => res(c)); });
(async () => {
  for (let i = 0; i < 60; i++) { // wait (up to ~15s) until the server actually answers
    try { const r = await fetch(`http://localhost:${PORT}/api/auth/me`); if (r.ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('\n=== API tests ==='); const a = await run('smoke.js');
  let u = 0; try { require.resolve('jsdom'); console.log('\n=== UI tests (jsdom) ==='); u = await run('ui-smoke.js'); } catch (_) { console.log('\n(UI tests skipped — run `npm install` to get the jsdom dev dependency)'); }
  server.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(a || u ? 1 : 0);
})();
