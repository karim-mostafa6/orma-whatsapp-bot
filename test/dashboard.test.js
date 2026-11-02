import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createDashboard } from '../src/dashboard/server.js';
import { loadFaqFile } from '../src/faq.js';
import { ChatState } from '../src/state.js';
import { createKeywordResponder } from '../src/responders/keyword.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orma-dash-'));
const faqFile = path.join(dir, 'faq.json');
fs.copyFileSync(new URL('../data/faq.json', import.meta.url), faqFile);

const faq = { current: loadFaqFile(faqFile) };
const state = new ChatState(null);
let loggedOut = false;
const whatsapp = { status: { connection: 'qr', qr: 'data:image/png;base64,xx', me: null }, logout: async () => (loggedOut = true) };
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const server = createDashboard({ whatsapp, faq, faqFile, state, responder: createKeywordResponder(), getActivity: () => [{ msg: 'x' }], logger: silent });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const call = (method, url, body, headers = {}) =>
  fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });

test('الصفحة نفسها بتفتح', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /ORMA/);
});

test('status فيه الـ QR والمعلومات الناقصة', async () => {
  const s = await (await call('GET', '/api/status')).json();
  assert.equal(s.connection, 'qr');
  assert.ok(s.qr);
  assert.ok(s.missing.includes('store_url'));
});

test('حفظ الردود من الصفحة بيكتب الملف وبيحدّث البوت على طول', async () => {
  const draft = await (await call('GET', '/api/faq')).json();
  draft.variables.store_url = 'https://orma.test';
  draft.intents.push({ id: 'custom', title: 'تفصيل', keywords: ['حفر'], answer: 'بنعمل حفر ✨ {store_url}' });
  const res = await call('PUT', '/api/faq', draft);
  assert.equal(res.status, 200);
  assert.ok(JSON.parse(fs.readFileSync(faqFile, 'utf8')).variables.store_url === 'https://orma.test');
  const t = await (await call('POST', '/api/test', { text: 'ممكن حفر اسم؟' })).json();
  assert.equal(t.text, 'بنعمل حفر ✨ https://orma.test');
});

test('حفظ ملف غلط بيترفض برسالة واضحة والملف ما بيتغيرش', async () => {
  const before = fs.readFileSync(faqFile, 'utf8');
  const res = await call('PUT', '/api/faq', { intents: [] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /intents/);
  assert.equal(fs.readFileSync(faqFile, 'utf8'), before);
});

test('التجربة بتستخدم التعديلات اللي لسه ما اتحفظتش', async () => {
  const draft = await (await call('GET', '/api/faq')).json();
  draft.intents.find((i) => i.id === 'shipping').answer = 'رد تجريبي';
  const t = await (await call('POST', '/api/test', { text: 'الشحن', faq: draft })).json();
  assert.equal(t.text, 'رد تجريبي');
  const h = await (await call('POST', '/api/test', { text: 'عايز اكلم موظف' })).json();
  assert.equal(h.type, 'handoff');
});

test('قائمة العملاء المحتاجين موظف + زرار رجّع البوت', async () => {
  state.pause('201001112222@s.whatsapp.net', 'customer_request', 12, 'Mona +201001112222');
  const list = await (await call('GET', '/api/chats')).json();
  assert.equal(list[0].label, 'Mona +201001112222');
  await call('POST', '/api/chats/resume', { jid: '201001112222@s.whatsapp.net' });
  assert.equal((await (await call('GET', '/api/chats')).json()).length, 0);
});

test('زرار إيقاف/تشغيل البوت', async () => {
  await call('POST', '/api/bot', { paused: true });
  assert.equal(state.globalPaused, true);
  await call('POST', '/api/bot', { paused: false });
  assert.equal(state.globalPaused, false);
});

test('فك ربط الرقم', async () => {
  await call('POST', '/api/logout', {});
  assert.equal(loggedOut, true);
});

test('حماية: مواقع تانية ما تقدرش تكلم الصفحة', async () => {
  // fetch ما بيسمحش بتغيير الـ Host، فبنستخدم http.request
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/status', headers: { Host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 403);
  const form = await fetch(base + '/api/bot', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"paused":true}' });
  assert.equal(form.status, 415);
  assert.equal(state.globalPaused, false);
});
