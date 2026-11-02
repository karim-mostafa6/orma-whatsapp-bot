import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db.js';
import { createEngine } from '../src/flows/engine.js';
import { defaultFlows, defaultSettings, readFaqSeed } from '../src/flows/defaults.js';
import { validateFlow } from '../src/flows/validate.js';

const FAQ = readFaqSeed(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/faq.json'));
const CFG = { minDelayMs: 0, maxDelayMs: 0, markAsRead: true, handoffHours: 12, ownerReplyPauseHours: 12, notifyOwner: true, deleteOwnerCommands: true, maxRepliesPerMinute: 4 };
const JID = '201000000001@s.whatsapp.net';
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function setup({ flows, faq = FAQ } = {}) {
  let clock = new Date('2026-11-02T14:00:00').getTime();
  const db = createDb(null, { now: () => clock });
  db.setSettings(defaultSettings(CFG, faq));
  db.setFlows(flows || defaultFlows(faq));
  const out = [];
  const owner = [];
  const engine = createEngine({
    db,
    logger: silent,
    now: () => clock,
    rand: () => 0,
    transport: { send: async (_j, t) => out.push(t), notifyOwner: async (t) => owner.push(t) },
  });
  const say = (text, extra = {}) => engine.handleInbound({ jid: JID, text, kind: 'text', name: 'Sara', phone: '201000000001', ...extra });
  return { db, engine, out, owner, say, tick: (ms) => (clock += ms) };
}

const node = (id, type, data, x = 0, y = 0) => ({ id, type, position: { x, y }, data });
const edge = (source, target, sourceHandle = 'next') => ({ id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle });

test('الـ Flows الجاهزة سليمة (من غير أخطاء)', () => {
  for (const f of defaultFlows(FAQ)) assert.deepEqual(validateFlow(f).errors, [], f.name);
});

test('سؤال عادي → الرد بتاعه', async () => {
  const t = setup();
  await t.say('الشحن بياخد كام يوم؟');
  assert.equal(t.out.length, 1);
  assert.match(t.out[0], /الشحن والتوصيل/);
});

test('المتغيرات بتتبدّل من معلومات المتجر', async () => {
  const t = setup();
  t.db.setSettings({ ...t.db.getSettings(), variables: { ...t.db.getSettings().variables, store_url: 'https://orma.test' } });
  await t.say('عايز لينك الموقع');
  assert.match(t.out[0], /https:\/\/orma\.test/);
});

test('الترحيب لوحده بيترد عليه، ومع سؤال بيتجاهل', async () => {
  const t = setup();
  await t.say('السلام عليكم');
  assert.match(t.out[0], /أهلاً/);
  t.out.length = 0;
  await t.say('السلام عليكم الشحن بكام');
  assert.equal(t.out.length, 1);
  assert.match(t.out[0], /الشحن/);
});

test('سؤالين في رسالة → ردين', async () => {
  const t = setup();
  await t.say('الشحن بكام وطرق الدفع ايه');
  assert.equal(t.out.length, 2);
});

test('طلب موظف → رسالة تحويل + البوت يسكت + إشعار ليك', async () => {
  const t = setup();
  await t.say('عايز اكلم حد من خدمة العملاء');
  assert.equal(t.out.length, 1);
  assert.equal(t.owner.length, 1);
  assert.match(t.owner[0], /Sara/);
  assert.ok(t.engine.isPaused(JID));
  await t.say('الشحن بكام');
  assert.equal(t.out.length, 1);
});

test('التحويل بيخلص لوحده بعد مدة handoffHours', async () => {
  const t = setup();
  await t.say('موظف');
  t.tick(12 * 3600_000 + 1);
  await t.say('الشحن بكام');
  assert.equal(t.out.length, 2);
});

test('مش فاهم: أول مرة توضيح، تاني مرة تحويل لموظف', async () => {
  const t = setup();
  await t.say('ايه الاخبار');
  assert.equal(t.engine.isPaused(JID), false);
  await t.say('بقولك ايه');
  assert.equal(t.engine.isPaused(JID), true);
  assert.equal(t.out.length, 2);
});

test('رسالة مفهومة بين رسالتين مش مفهومين بتصفّر العدّاد', async () => {
  const t = setup();
  await t.say('ايه الاخبار');
  await t.say('الشحن بكام');
  await t.say('بقولك ايه');
  assert.equal(t.engine.isPaused(JID), false);
});

test('صورة من غير كلام → Flow الصور (تحويل لموظف)', async () => {
  const t = setup();
  await t.engine.handleInbound({ jid: JID, text: '', kind: 'media' });
  assert.ok(t.engine.isPaused(JID));
});

test('سؤال باختيارات: الرد بالرقم بيمشي في المسار الصح', async () => {
  const t = setup();
  await t.say('عايز استرجع الخاتم');
  assert.equal(t.out.length, 2); // السياسة + السؤال
  assert.match(t.out[1], /\*1\.\* أبدأ استبدال/);
  await t.say('٣'); // رقم عربي
  assert.equal(t.out[2], 'تحت أمرك في أي وقت 🤍');
  assert.equal(t.engine.isPaused(JID), false);
});

test('سؤال باختيارات: الرد بنص الاختيار نفسه برضه بيشتغل', async () => {
  const t = setup();
  await t.say('عايز استبدل');
  await t.say('أبدأ استرجاع');
  assert.ok(t.engine.isPaused(JID));
});

test('سؤال باختيارات: رد غلط → يطلب الرقم، وبعد كذا مرة يسيب السؤال', async () => {
  const t = setup();
  await t.say('استرجاع');
  await t.say('مش عارف');
  assert.match(t.out.at(-1), /ابعت رقم/);
  await t.say('برضه مش عارف');
  await t.say('ولا ده');
  assert.equal(t.db.runsFor(JID).length, 0);
});

test('سؤال باختيارات: سؤال تاني في النص بيبدأ الـ Flow بتاعه', async () => {
  const t = setup();
  await t.say('استرجاع');
  await t.say('طيب الشحن بكام؟');
  assert.match(t.out.at(-1), /الشحن/);
  assert.equal(t.db.runsFor(JID).length, 0);
});

test('سؤال باختيارات: العميل ما ردش → مسار "ما ردش"', async () => {
  const flow = {
    id: 'f',
    name: 'test',
    status: 'active',
    nodes: [node('t', 'trigger', { event: 'keywords', keywords: ['جرب'] }), node('q', 'ask_choice', { text: 'اختار', options: ['أ', 'ب'], timeoutMinutes: 5 }), node('late', 'send_message', { texts: ['لسه معانا؟'] })],
    edges: [edge('t', 'q'), edge('q', 'late', 'timeout')],
  };
  const t = setup({ flows: [flow] });
  await t.say('جرب');
  t.tick(6 * 60_000);
  await t.engine.tick();
  assert.equal(t.out.at(-1), 'لسه معانا؟');
});

test('طرح سؤال: بيحفظ الإجابة ويستخدمها في الرسالة اللي بعدها', async () => {
  const flow = {
    id: 'f',
    name: 'order',
    status: 'active',
    nodes: [node('t', 'trigger', { event: 'keywords', keywords: ['اوردري'] }), node('q', 'ask_question', { text: 'ابعت رقم الأوردر', saveAs: 'order_no' }), node('m', 'send_message', { texts: ['تمام يا {name}، هنشوف أوردر {order_no}'] })],
    edges: [edge('t', 'q'), edge('q', 'm', 'answered')],
  };
  const t = setup({ flows: [flow] });
  await t.say('فين اوردري');
  await t.say('ORD-552');
  assert.equal(t.out.at(-1), 'تمام يا Sara، هنشوف أوردر ORD-552');
  assert.equal(t.db.getContact(JID).vars.order_no, 'ORD-552');
});

test('تأخير: الرسالة اللي بعده بتتبعت بعد المدة', async () => {
  const flow = {
    id: 'f',
    name: 'd',
    status: 'active',
    nodes: [node('t', 'trigger', { event: 'keywords', keywords: ['جرب'] }), node('d', 'delay', { amount: 2, unit: 'minutes' }), node('m', 'send_message', { texts: ['بعد دقيقتين'] })],
    edges: [edge('t', 'd'), edge('d', 'm')],
  };
  const t = setup({ flows: [flow] });
  await t.say('جرب');
  assert.equal(t.out.length, 0);
  t.tick(60_000);
  await t.engine.tick();
  assert.equal(t.out.length, 0);
  t.tick(61_000);
  await t.engine.tick();
  assert.deepEqual(t.out, ['بعد دقيقتين']);
});

test('شرط + تصنيفات: إضافة تصنيف وبعدين شرط عليه', async () => {
  const flow = {
    id: 'f',
    name: 'c',
    status: 'active',
    nodes: [
      node('t', 'trigger', { event: 'keywords', keywords: ['خاتم'] }),
      node('c', 'condition', { logic: 'and', rules: [{ type: 'has_tag', value: 'vip' }] }),
      node('yes', 'send_message', { texts: ['أهلاً يا VIP'] }),
      node('tag', 'add_tag', { tag: 'vip' }),
      node('no', 'send_message', { texts: ['أهلاً'] }),
    ],
    edges: [edge('t', 'c'), edge('c', 'yes', 'true'), edge('c', 'tag', 'false'), edge('tag', 'no')],
  };
  const t = setup({ flows: [flow] });
  await t.say('خاتم');
  await t.say('خاتم');
  assert.deepEqual(t.out, ['أهلاً', 'أهلاً يا VIP']);
  assert.deepEqual(t.db.getContact(JID).tags, ['vip']);
});

test('شرط مواعيد العمل', async () => {
  const mk = (hours) => ({
    id: 'f',
    name: 'h',
    status: 'active',
    nodes: [node('t', 'trigger', { event: 'keywords', keywords: ['مواعيد'] }), node('c', 'condition', { rules: [{ type: 'within_hours', value: hours }] }), node('a', 'send_message', { texts: ['فاتحين'] }), node('b', 'send_message', { texts: ['قافلين'] })],
    edges: [edge('t', 'c'), edge('c', 'a', 'true'), edge('c', 'b', 'false')],
  });
  const open = setup({ flows: [mk('11:00-23:00')] }); // الساعة 2 الضهر
  await open.say('مواعيد');
  const closed = setup({ flows: [mk('20:00-02:00')] });
  await closed.say('مواعيد');
  assert.deepEqual([open.out[0], closed.out[0]], ['فاتحين', 'قافلين']);
});

test('Flow متوقف ما بيشتغلش', async () => {
  const t = setup();
  t.db.setFlows(t.db.listFlows().map((f) => (f.id === 'flow_shipping' ? { ...f, status: 'paused' } : f)));
  await t.say('الشحن بكام');
  assert.doesNotMatch(t.out[0], /الشحن والتوصيل/);
});

test('زرار إيقاف البوت لكل العملاء', async () => {
  const t = setup();
  t.db.setSettings({ ...t.db.getSettings(), globalPaused: true });
  await t.say('الشحن بكام');
  assert.equal(t.out.length, 0);
  assert.equal(t.db.getContact(JID).messages.length, 1); // الرسالة اتسجلت في المحادثة
});

test('الأولوية: Flow أعلى أولوية بيكسب', async () => {
  const t = setup();
  await t.say('عايز اكلم موظف بخصوص الشحن');
  assert.ok(t.engine.isPaused(JID));
});

test('حماية من الـ loop: Flow بيلف على نفسه ما بيعلّقش البوت', async () => {
  const flow = { id: 'f', name: 'loop', status: 'active', nodes: [node('t', 'trigger', { event: 'keywords', keywords: ['لوب'] }), node('a', 'add_tag', { tag: 'x' })], edges: [edge('t', 'a'), edge('a', 'a')] };
  const t = setup({ flows: [flow] });
  const res = await t.say('لوب');
  assert.equal(res.result, 'done');
});

test('validate: بيكشف الأخطاء الأساسية', () => {
  const bad = { name: '', nodes: [node('s', 'send_message', { texts: [''] })], edges: [] };
  const { errors, warnings } = validateFlow(bad);
  assert.ok(errors.some((e) => /اسم/.test(e.text)));
  assert.ok(errors.some((e) => /المُشغّل/.test(e.text)));
  assert.ok(errors.some((e) => /فاضية/.test(e.text)));
  const orphan = validateFlow({ name: 'x', nodes: [node('t', 'trigger', { event: 'fallback' }), node('a', 'send_message', { texts: ['hi'] }), node('b', 'send_message', { texts: ['lost'] })], edges: [edge('t', 'a')] });
  assert.deepEqual(orphan.errors, []);
  assert.ok(orphan.warnings.some((e) => e.nodeId === 'b' && /مش متوصلة/.test(e.text)));
  assert.ok(warnings.length >= 0);
});
