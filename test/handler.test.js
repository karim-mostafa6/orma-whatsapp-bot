import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/handler.js';
import { prepareFaq } from '../src/faq.js';
import { ChatState } from '../src/state.js';
import { createKeywordResponder } from '../src/responders/keyword.js';
import { createHybridResponder } from '../src/responders/llm.js';

const CUSTOMER = '201000000001@s.whatsapp.net';
const ME = '201099999999@s.whatsapp.net';

const FAQ = prepareFaq({
  variables: { store_name: 'ORMA' },
  handoff_keywords: ['موظف'],
  intents: [
    { id: 'greeting', smalltalk: true, keywords: ['اهلا'], answer: 'أهلاً في {store_name}' },
    { id: 'shipping', keywords: ['شحن'], answer: 'SHIPPING' },
    { id: 'order_status', handoff: true, keywords: ['اوردري'], answer: 'ORDER' },
  ],
  system: { handoff: 'HANDOFF', fallback: 'FALLBACK', fallback_handoff: 'FALLBACK_HANDOFF', media: 'MEDIA', owner_notify: 'NOTIFY {reason}' },
});

function setup(overrides = {}) {
  let clock = 1_700_000_000_000;
  const sent = [];
  const presence = [];
  let n = 0;
  const sock = {
    user: { id: '201099999999:5@s.whatsapp.net' },
    readMessages: async () => {},
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async (type, jid) => presence.push([type, jid]),
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: `BOT${++n}`, remoteJid: jid, fromMe: true } };
    },
  };
  const config = {
    minDelayMs: 0,
    maxDelayMs: 0,
    markAsRead: true,
    handoffHours: 12,
    ownerReplyPauseHours: 12,
    unmatchedBeforeHandoff: 2,
    maxRepliesPerMinute: 4,
    maxMessageAgeMinutes: 60,
    notifyOwner: true,
    deleteOwnerCommands: true,
    ...overrides,
  };
  const now = () => clock;
  const state = new ChatState(null, { now });
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const handler = createHandler({
    getSock: () => sock,
    faq: { current: FAQ },
    state,
    responder: overrides.responder || createKeywordResponder(),
    config,
    logger: silent,
    now,
  });
  let id = 0;
  const incoming = (text, extra = {}) =>
    handler.onMessagesUpsert({
      type: extra.type || 'notify',
      messages: [
        {
          key: { remoteJid: extra.jid || CUSTOMER, id: `IN${++id}`, fromMe: Boolean(extra.fromMe) },
          message: extra.message || { conversation: text },
          messageTimestamp: Math.floor((extra.ts ?? clock) / 1000),
          pushName: 'Sara',
        },
      ],
    });
  const toCustomer = () => sent.filter((s) => s.jid === CUSTOMER && s.content.text).map((s) => s.content.text);
  const toMe = () => sent.filter((s) => s.jid === ME).map((s) => s.content.text);
  return { incoming, sent, presence, state, toCustomer, toMe, tick: (ms) => (clock += ms), handler };
}

test('بيرد على السؤال، وبيظهر typing قبل الرد وبيرجع unavailable بعده', async () => {
  const t = setup();
  await t.incoming('الشحن بكام؟');
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
  const types = t.presence.map((p) => p[0]);
  assert.deepEqual(types, ['available', 'composing', 'paused', 'unavailable']);
});

test('المتغيرات بتتبدّل في الرد', async () => {
  const t = setup();
  await t.incoming('اهلا');
  assert.deepEqual(t.toCustomer(), ['أهلاً في ORMA']);
});

test('طلب موظف → رسالة تحويل + البوت يسكت + إشعار ليك', async () => {
  const t = setup();
  await t.incoming('عايز موظف');
  assert.deepEqual(t.toCustomer(), ['HANDOFF']);
  assert.deepEqual(t.toMe(), ['NOTIFY عميل طلب يكلم موظف']);
  await t.incoming('الشحن بكام؟');
  assert.deepEqual(t.toCustomer(), ['HANDOFF']); // ما ردش تاني
});

test('بعد مدة التحويل (HANDOFF_HOURS) البوت يرجع يرد لوحده', async () => {
  const t = setup();
  await t.incoming('موظف');
  t.tick(12 * 3600_000 + 1);
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), ['HANDOFF', 'SHIPPING']);
});

test('موضوع عليه handoff: true → يرد بالإجابة وبعدين يسكت', async () => {
  const t = setup();
  await t.incoming('فين اوردري');
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), ['ORDER']);
  assert.equal(t.toMe().length, 1);
});

test('مش فاهم: أول مرة رسالة توضيح، تاني مرة تحويل لموظف', async () => {
  const t = setup();
  await t.incoming('ايه الاخبار');
  await t.incoming('بقولك ايه');
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), ['FALLBACK', 'FALLBACK_HANDOFF']);
});

test('رسالة مفهومة بين رسالتين مش مفهومين بتصفّر العدّاد', async () => {
  const t = setup();
  await t.incoming('ايه الاخبار');
  await t.incoming('شحن');
  await t.incoming('بقولك ايه');
  assert.deepEqual(t.toCustomer(), ['FALLBACK', 'SHIPPING', 'FALLBACK']);
});

test('صورة أو ريكورد من غير كلام → تحويل لموظف', async () => {
  const t = setup();
  await t.incoming('', { message: { audioMessage: { seconds: 5 } } });
  assert.deepEqual(t.toCustomer(), ['MEDIA']);
  assert.ok(t.state.isPaused(CUSTOMER));
});

test('صورة عليها كلام → بيرد على الكلام', async () => {
  const t = setup();
  await t.incoming('', { message: { imageMessage: { caption: 'الشحن؟' } } });
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
});

test('إنت رديت بنفسك من الموبايل → البوت يسكت في المحادثة دي', async () => {
  const t = setup();
  await t.incoming('أهلاً يا سارة، أنا معاكي', { fromMe: true });
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), []);
  assert.equal(t.state.pausedInfo(CUSTOMER).reason, 'owner_reply');
});

test('#bot بيرجّع البوت، و #stop بيوقفه لحد #bot، والأمر بيتمسح', async () => {
  const t = setup();
  await t.incoming('#stop', { fromMe: true });
  assert.equal(t.state.pausedInfo(CUSTOMER).until, null);
  t.tick(100 * 3600_000);
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), []);
  await t.incoming('#BOT', { fromMe: true });
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
  assert.equal(t.sent.filter((s) => s.content.delete).length, 2);
});

test('ردك العادي ما يلغيش #stop', async () => {
  const t = setup();
  await t.incoming('#stop', { fromMe: true });
  await t.incoming('تمام', { fromMe: true });
  assert.equal(t.state.pausedInfo(CUSTOMER).until, null);
});

test('رسايل البوت نفسه ما تتحسبش كأنك رديت', async () => {
  const t = setup();
  await t.incoming('شحن');
  // نفس ID الرسالة اللي البوت بعتها راجع كـ fromMe
  await t.handler.onMessagesUpsert({
    type: 'append',
    messages: [{ key: { remoteJid: CUSTOMER, id: 'BOT1', fromMe: true }, message: { conversation: 'SHIPPING' }, messageTimestamp: 1_700_000_000 }],
  });
  assert.equal(t.state.isPaused(CUSTOMER), false);
});

test('بيتجاهل الجروبات والـ Status والرسايل القديمة ورسايل المزامنة', async () => {
  const t = setup();
  await t.incoming('شحن', { jid: '120363000000000000@g.us' });
  await t.incoming('شحن', { jid: 'status@broadcast' });
  await t.incoming('شحن', { ts: 1_700_000_000_000 - 2 * 3600_000 });
  await t.incoming('شحن', { type: 'append' });
  assert.equal(t.sent.length, 0);
});

test('حد أقصى للردود في الدقيقة لكل محادثة', async () => {
  const t = setup({ maxRepliesPerMinute: 2 });
  for (let i = 0; i < 5; i++) await t.incoming('شحن');
  assert.equal(t.toCustomer().length, 2);
  t.tick(61_000);
  await t.incoming('شحن');
  assert.equal(t.toCustomer().length, 3);
});

test('رسايل نفس العميل بتترد بالترتيب حتى لو وصلت مع بعض', async () => {
  const t = setup();
  await Promise.all([t.incoming('اهلا'), t.incoming('شحن')]);
  assert.deepEqual(t.toCustomer(), ['أهلاً في ORMA', 'SHIPPING']);
});

test('hybrid: لو الكلمات ما لقتش، يسأل الـ LLM؛ ولو الـ LLM وقع يكمّل عادي', async () => {
  const llm = async (text) => (text.includes('crash') ? Promise.reject(new Error('down')) : { type: 'answer', text: 'LLM', intents: ['llm'] });
  const responder = createHybridResponder(createKeywordResponder(), llm, { warn() {} });
  const t = setup({ responder });
  await t.incoming('شحن');
  await t.incoming('سؤال غريب');
  await t.incoming('crash');
  assert.deepEqual(t.toCustomer(), ['SHIPPING', 'LLM', 'FALLBACK']);
});

test('زرار إيقاف البوت من الصفحة: البوت ما يردش على حد', async () => {
  const t = setup();
  t.state.setGlobalPaused(true);
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), []);
  t.state.setGlobalPaused(false);
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
});

test('اسم العميل ورقمه بيتحفظوا مع التحويل (عشان يظهروا في الصفحة)', async () => {
  const t = setup();
  await t.incoming('موظف');
  assert.equal(t.state.pausedInfo(CUSTOMER).label, 'Sara +201000000001');
});
