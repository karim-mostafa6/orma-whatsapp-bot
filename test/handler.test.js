import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/handler.js';
import { createDb } from '../src/db.js';
import { createEngine } from '../src/flows/engine.js';
import { defaultSettings } from '../src/flows/defaults.js';

const CUSTOMER = '201000000001@s.whatsapp.net';
const CFG = { minDelayMs: 0, maxDelayMs: 0, markAsRead: true, handoffHours: 12, ownerReplyPauseHours: 12, notifyOwner: true, deleteOwnerCommands: true, maxRepliesPerMinute: 4 };
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const n = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data });
const FLOWS = [
  { id: 'ship', name: 'شحن', status: 'active', nodes: [n('t', 'trigger', { event: 'keywords', keywords: ['شحن'] }), n('m', 'send_message', { texts: ['SHIPPING'] })], edges: [{ id: 'e', source: 't', sourceHandle: 'next', target: 'm' }] },
];

function setup(behavior = {}) {
  let clock = 1_700_000_000_000;
  const db = createDb(null, { now: () => clock });
  const s = defaultSettings(CFG, null);
  db.setSettings({ ...s, behavior: { ...s.behavior, ...behavior } });
  db.setFlows(FLOWS);
  const sent = [];
  const presence = [];
  let id = 0;
  const sock = {
    user: { id: '201099999999:5@s.whatsapp.net' },
    readMessages: async () => {},
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async (type) => presence.push(type),
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: `BOT${++id}`, remoteJid: jid, fromMe: true } };
    },
  };
  const handler = createHandler({
    getSock: () => sock,
    db,
    makeEngine: (transport) => createEngine({ db, transport, logger: silent, now: () => clock }),
    config: { maxMessageAgeMinutes: 60 },
    logger: silent,
    now: () => clock,
  });
  let mid = 0;
  const incoming = (text, extra = {}) =>
    handler.onMessagesUpsert({
      type: extra.type || 'notify',
      messages: [
        {
          key: { remoteJid: extra.jid || CUSTOMER, id: `IN${++mid}`, fromMe: Boolean(extra.fromMe) },
          message: extra.message || { conversation: text },
          messageTimestamp: Math.floor((extra.ts ?? clock) / 1000),
          pushName: 'Sara',
        },
      ],
    });
  const toCustomer = () => sent.filter((x) => x.jid === CUSTOMER && x.content.text).map((x) => x.content.text);
  return { incoming, sent, presence, db, handler, toCustomer, tick: (ms) => (clock += ms) };
}

test('بيرد بالـ Flow، وبيظهر typing قبل الرد وبيرجع unavailable بعده', async () => {
  const t = setup();
  await t.incoming('الشحن بكام؟');
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
  assert.deepEqual(t.presence, ['available', 'composing', 'paused', 'unavailable']);
  const c = t.db.getContact(CUSTOMER);
  assert.equal(c.name, 'Sara');
  assert.equal(c.phone, '201000000001');
});

test('إنت رديت بنفسك → البوت يسكت في المحادثة دي', async () => {
  const t = setup();
  await t.incoming('أهلاً يا سارة', { fromMe: true });
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), []);
  assert.equal(t.db.getContact(CUSTOMER).paused.reason, 'owner_reply');
});

test('#stop بيوقف لحد #bot، والأمر بيتمسح، وردك العادي ما يلغيش #stop', async () => {
  const t = setup();
  await t.incoming('#stop', { fromMe: true });
  await t.incoming('تمام', { fromMe: true });
  assert.equal(t.db.getContact(CUSTOMER).paused.until, null);
  t.tick(100 * 3600_000);
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), []);
  await t.incoming('#BOT', { fromMe: true });
  await t.incoming('شحن');
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
  assert.equal(t.sent.filter((x) => x.content.delete).length, 2);
});

test('رسايل البوت نفسه ما تتحسبش كأنك رديت', async () => {
  const t = setup();
  await t.incoming('شحن');
  await t.handler.onMessagesUpsert({ type: 'append', messages: [{ key: { remoteJid: CUSTOMER, id: 'BOT1', fromMe: true }, message: { conversation: 'SHIPPING' }, messageTimestamp: 1_700_000_000 }] });
  assert.equal(t.db.getContact(CUSTOMER).paused, null);
});

test('بيتجاهل الجروبات والـ Status والرسايل القديمة والمزامنة', async () => {
  const t = setup();
  await t.incoming('شحن', { jid: '120363000000000000@g.us' });
  await t.incoming('شحن', { jid: 'status@broadcast' });
  await t.incoming('شحن', { ts: 1_700_000_000_000 - 2 * 3600_000 });
  await t.incoming('شحن', { type: 'append' });
  assert.equal(t.sent.length, 0);
});

test('صورة عليها كلام → بيرد على الكلام', async () => {
  const t = setup();
  await t.incoming('', { message: { imageMessage: { caption: 'الشحن؟' } } });
  assert.deepEqual(t.toCustomer(), ['SHIPPING']);
});

test('حد أقصى للردود في الدقيقة', async () => {
  const t = setup({ maxRepliesPerMinute: 2 });
  for (let i = 0; i < 5; i++) await t.incoming('شحن');
  assert.equal(t.toCustomer().length, 2);
  t.tick(61_000);
  await t.incoming('شحن');
  assert.equal(t.toCustomer().length, 3);
});

test('رسايل نفس العميل بتترد بالترتيب حتى لو وصلت مع بعض', async () => {
  const t = setup();
  await Promise.all([t.incoming('شحن 1'), t.incoming('شحن 2')]);
  assert.equal(t.toCustomer().length, 2);
  assert.deepEqual(
    t.db.getContact(CUSTOMER).messages.map((m) => m.text),
    ['شحن 1', 'SHIPPING', 'شحن 2', 'SHIPPING']
  );
});
