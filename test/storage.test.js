import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { startFakeSupabase } from './fakeSupabase.js';
import { createSupabaseKv } from '../src/storage/supabaseKv.js';
import { useKvAuthState } from '../src/storage/kvAuth.js';
import { createDb } from '../src/db.js';

const sb = await startFakeSupabase({ pageLimit: 7 }); // صفحات صغيرة عشان نختبر التقسيم
after(() => sb.close());
const silent = { info() {}, warn() {}, error() {} };
const mkKv = () => createSupabaseKv({ url: sb.url, key: sb.key, flushMs: 10, logger: silent });

test('kv: الكتابة بتتجمّع وبتتحفظ، والقراية بالصفحات بترجّع كله', async () => {
  const kv = mkKv();
  for (let i = 0; i < 20; i++) kv.set(`t:${String(i).padStart(2, '0')}`, `v${i}`);
  kv.set('other:x', 'y');
  await kv.flushNow();
  const all = await mkKv().loadAll('t:');
  assert.equal(all.size, 20);
  assert.equal(all.get('t:19'), 'v19');
  assert.equal((await mkKv().loadAll('other:')).get('other:x'), 'y');
});

test('kv: المسح شغال حتى مع أسماء فيها رموز', async () => {
  const kv = mkKv();
  kv.set('auth:session-201000:1@s.whatsapp.net', 'a');
  kv.set('auth:weird "q"', 'b');
  await kv.flushNow();
  kv.del('auth:session-201000:1@s.whatsapp.net');
  kv.del('auth:weird "q"');
  await kv.flushNow();
  assert.equal(sb.rows.has('auth:session-201000:1@s.whatsapp.net'), false);
  assert.equal(sb.rows.has('auth:weird "q"'), false);
});

test('kv: المفتاح الجديد (sb_secret) بيتبعت في apikey بس، والقديم (JWT) في الاتنين', async () => {
  for (const k of ['sb_secret_abc', 'eyJhbGciOiJIUzI1NiJ9.x.y']) {
    const s2 = await startFakeSupabase({ key: k });
    const kv = createSupabaseKv({ url: s2.url, key: k, flushMs: 10, logger: silent });
    await kv.check();
    kv.set('a', '1');
    await kv.flushNow();
    assert.equal(s2.rows.get('a'), '1', k);
    await s2.close();
  }
});

test('kv: مفتاح غلط → رسالة واضحة', async () => {
  const bad = createSupabaseKv({ url: sb.url, key: 'wrong', logger: silent });
  await assert.rejects(bad.check(), /service_role/);
});

test('kv: لو الحفظ فشل، التعديل ما بيضيعش وبيتحفظ في المحاولة الجاية', async () => {
  let fail = true;
  const flaky = (u, o) => (fail ? Promise.resolve(new Response('boom', { status: 500 })) : fetch(u, o));
  const kv = createSupabaseKv({ url: sb.url, key: sb.key, flushMs: 10, logger: silent, fetchImpl: flaky });
  kv.set('retry:k', '1');
  await kv.flushNow();
  assert.equal(sb.rows.has('retry:k'), false);
  fail = false;
  await kv.flushNow();
  assert.equal(sb.rows.get('retry:k'), '1');
});

test('جلسة الواتساب: بتتحفظ وترجع زي ما هي بعد restart (ومعاها الـ Buffers)', async () => {
  const kv1 = mkKv();
  const a = await useKvAuthState(kv1);
  a.state.creds.me = { id: '201099999999:5@s.whatsapp.net' };
  await a.saveCreds();
  await a.state.keys.set({ 'pre-key': { 1: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5]) } }, session: { 'x@s.whatsapp.net': Buffer.from('hello') } });
  await a.state.keys.set({ 'app-state-sync-key': { AAA: { keyData: Buffer.from([9, 9]) } } });
  await kv1.flushNow();

  const b = await useKvAuthState(mkKv()); // كأن البوت عمل restart
  assert.equal(b.state.creds.me.id, '201099999999:5@s.whatsapp.net');
  assert.deepEqual(Buffer.from(b.state.creds.noiseKey.public), Buffer.from(a.state.creds.noiseKey.public));
  const pk = await b.state.keys.get('pre-key', ['1', '2']);
  assert.deepEqual([...pk['1'].public], [1, 2, 3]);
  assert.equal(pk['2'], null);
  const sess = await b.state.keys.get('session', ['x@s.whatsapp.net']);
  assert.equal(Buffer.from(sess['x@s.whatsapp.net']).toString(), 'hello');
  const ask = await b.state.keys.get('app-state-sync-key', ['AAA']);
  assert.deepEqual([...ask.AAA.keyData], [9, 9]);

  // مسح مفتاح واحد
  await b.state.keys.set({ 'pre-key': { 1: null } });
  // فك الربط: الجلسة كلها بتتمسح
  await b.clear();
  assert.equal([...sb.rows.keys()].filter((k) => k.startsWith('auth:')).length, 0);
  const c = await useKvAuthState(mkKv());
  assert.equal(c.state.creds.me, undefined);
});

test('البيانات (الـ Flows والعملاء) بتتحفظ في Supabase وترجع بعد restart', async () => {
  const kv = mkKv();
  const db = createDb('/should/not/be/used', { kv, kvData: await kv.loadAll('data:') });
  assert.equal(db.isNew, true);
  db.setSettings({ variables: { store_name: 'ORMA' } });
  db.setFlows([{ id: 'f1', name: 'شحن', nodes: [], edges: [] }]);
  db.upsertContact('201@s.whatsapp.net', { name: 'Sara' });
  db.addMessage('201@s.whatsapp.net', 'in', 'الشحن بكام');
  await db.flush();

  const kv2 = mkKv();
  const db2 = createDb(null, { kv: kv2, kvData: await kv2.loadAll('data:') });
  assert.equal(db2.isNew, false);
  assert.equal(db2.getFlow('f1').name, 'شحن');
  assert.equal(db2.getContact('201@s.whatsapp.net').messages[0].text, 'الشحن بكام');
  assert.ok(JSON.parse(sb.rows.get('data:settings')).variables.store_name === 'ORMA');
});

test('BufferJSON: نفس الصيغة اللي Baileys بيستخدمها', () => {
  const creds = initAuthCreds();
  const back = JSON.parse(JSON.stringify(creds, BufferJSON.replacer), BufferJSON.reviver);
  assert.deepEqual(Buffer.from(back.signedIdentityKey.private), Buffer.from(creds.signedIdentityKey.private));
});
