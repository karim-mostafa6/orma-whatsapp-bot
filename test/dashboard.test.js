import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDashboard } from '../src/dashboard/server.js';
import { createAuth } from '../src/dashboard/auth.js';
import { createDb } from '../src/db.js';
import { createEngine } from '../src/flows/engine.js';
import { defaultFlows, defaultSettings } from '../src/flows/defaults.js';

const CFG = { minDelayMs: 0, maxDelayMs: 0, markAsRead: true, handoffHours: 12, ownerReplyPauseHours: 12, notifyOwner: true, deleteOwnerCommands: true, maxRepliesPerMinute: 4 };
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orma-dash-'));

const db = createDb(null);
db.setSettings(defaultSettings(CFG, null));
db.setFlows(defaultFlows(null));
const engine = createEngine({ db, logger: silent, transport: { send: async () => {}, notifyOwner: async () => {} } });
let loggedOut = false;
const whatsapp = { status: { connection: 'qr', qr: 'data:x', me: null }, logout: async () => (loggedOut = true) };
const auth = createAuth({ password: 'secret-pass-1', dataDir: dir, secure: false });
const server = createDashboard({ whatsapp, db, engine, auth, allowedHosts: ['bot.example.com'], getActivity: () => [], logger: silent });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
after(() => server.close());

function call(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: url, method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: data ? safeJson(data) : null }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body));
    else req.end();
  });
}
const safeJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

let cookie = '';
const authed = (method, url, body) => call(method, url, body, { Cookie: cookie });

test('من غير دخول: ممنوع', async () => {
  assert.equal((await call('GET', '/api/status')).status, 401);
  assert.equal((await call('GET', '/api/flows')).status, 401);
});

test('باسورد غلط بيترفض، وبعد 5 محاولات بيوقف شوية', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/login', { password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'secret-pass-1' })).status, 429);
});

test('دخول صح بيدّي كوكي آمنة', async () => {
  // مفتاح جلسة جديد لـ IP جديد مش متاح هنا، فبنعمل auth جديد بنفس المفتاح
  const auth2 = createAuth({ password: 'secret-pass-1', dataDir: dir, secure: false });
  const fakeReq = { socket: { remoteAddress: '10.0.0.9' } };
  const c = auth2.login(fakeReq, 'secret-pass-1');
  assert.match(c, /HttpOnly; SameSite=Strict/);
  cookie = c.split(';')[0];
  assert.equal((await authed('GET', '/api/status')).status, 200);
});

test('كوكي متزوّرة ما بتشتغلش', async () => {
  assert.equal((await call('GET', '/api/status', undefined, { Cookie: 'orma_session=9999999999.fake' })).status, 401);
});

test('دومين غريب ممنوع، والدومين بتاعنا مسموح', async () => {
  assert.equal((await call('GET', '/api/status', undefined, { Host: 'evil.example' })).status, 403);
  assert.notEqual((await call('GET', '/', undefined, { Host: 'bot.example.com' })).status, 403);
});

test('الأوامر لازم JSON (حماية من المواقع التانية)', async () => {
  assert.equal((await call('POST', '/api/bot', '{"paused":true}', { Cookie: cookie, 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(db.getSettings().globalPaused, false);
});

test('حفظ Flow: الشغال لازم يكون سليم، والمتوقف يتحفظ عادي', async () => {
  const bad = { id: 'f1', name: 'x', status: 'active', nodes: [{ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'keywords', keywords: [] } }], edges: [] };
  const r1 = await authed('POST', '/api/flows/save', { flow: bad });
  assert.equal(r1.status, 400);
  const r2 = await authed('POST', '/api/flows/save', { flow: { ...bad, status: 'paused' } });
  assert.equal(r2.status, 200);
  assert.ok(db.getFlow('f1'));
  assert.equal((await authed('POST', '/api/flows/status', { id: 'f1', status: 'active' })).status, 400);
  await authed('POST', '/api/flows/delete', { id: 'f1' });
  assert.equal(db.getFlow('f1'), null);
});

test('التجربة بتشتغل على نسخة منفصلة وما بتلمسش العملاء الحقيقيين', async () => {
  await authed('POST', '/api/simulate', { session: 's1', reset: true });
  const r = await authed('POST', '/api/simulate', { session: 's1', text: 'عايز اكلم موظف' });
  assert.equal(r.status, 200);
  assert.ok(r.json.messages.length >= 1);
  assert.equal(r.json.paused, true);
  assert.equal(db.listContacts().length, 0);
});

test('الإعدادات: بتتحفظ وبتتظبط في حدود معقولة', async () => {
  const r = await authed('PUT', '/api/settings', { behavior: { minDelayMs: 5000, maxDelayMs: 1000, maxRepliesPerMinute: 999 }, variables: { store_url: 'https://orma.test' } });
  assert.equal(r.status, 200);
  const b = db.getSettings().behavior;
  assert.equal(b.minDelayMs, 5000);
  assert.equal(b.maxDelayMs, 5000);
  assert.equal(b.maxRepliesPerMinute, 30);
  assert.equal(db.getSettings().variables.store_url, 'https://orma.test');
});

test('رجّع البوت لعميل + زرار الإيقاف العام + فك الربط', async () => {
  engine.pauseContact('201001@s.whatsapp.net', 'dashboard', null, { name: 'Mona' });
  const list = (await authed('GET', '/api/contacts')).json;
  assert.equal(list[0].paused.reason, 'dashboard');
  await authed('POST', '/api/contacts/resume', { jid: '201001@s.whatsapp.net' });
  assert.equal(engine.isPaused('201001@s.whatsapp.net'), false);
  await authed('POST', '/api/bot', { paused: true });
  assert.equal(db.getSettings().globalPaused, true);
  await authed('POST', '/api/whatsapp/logout', {});
  assert.equal(loggedOut, true);
});
