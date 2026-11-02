// استقبال رسايل الواتساب: بيفلتر (جروبات، Status، رسايل قديمة)، ويتعامل مع ردودك إنت،
// وبيدّي رسايل العملاء للمحرّك (flows/engine.js) اللي بيقرر يرد بإيه.
import {
  isJidGroup,
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
  jidNormalizedUser,
  normalizeMessageContent,
  getContentType,
} from '@whiskeysockets/baileys';
import { sendLikeHuman } from './humanize.js';

// أنواع رسايل مالهاش رد (تفاعلات، تعديلات، رسايل نظام ...)
const IGNORED_TYPES = new Set([
  'protocolMessage',
  'reactionMessage',
  'senderKeyDistributionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
  'editedMessage',
  'messageContextInfo',
  'encReactionMessage',
  'encCommentMessage',
  'callLogMesssage',
]);
const MEDIA_TYPES = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'stickerMessage',
  'ptvMessage',
  'locationMessage',
  'liveLocationMessage',
  'contactMessage',
  'contactsArrayMessage',
]);

/** بيطلّع النص من الرسالة، ويحدد نوعها: text / media / ignore */
export function extractText(message) {
  const content = normalizeMessageContent(message);
  if (!content) return { kind: 'ignore', text: '' };
  const type = getContentType(content);
  if (!type || IGNORED_TYPES.has(type)) return { kind: 'ignore', text: '' };

  const text =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    '';

  if (text.trim()) return { kind: 'text', text: text.trim() };
  if (MEDIA_TYPES.has(type)) return { kind: 'media', text: '' };
  return { kind: 'ignore', text: '' };
}

/** محادثات البوت ما يردش فيها خالص */
export function isIgnoredJid(jid) {
  return !jid || Boolean(isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid));
}

/** رقم العميل لو متاح (أحياناً واتساب بيبعت معرّف @lid بدل الرقم) */
function phoneOf(msg) {
  const jid = msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? msg.key.remoteJidAlt : msg.key.remoteJid;
  return jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0].split(':')[0] : '';
}

/**
 * @param {object} deps
 * @param {() => object} deps.getSock  الـ socket الحالي (بيتغير لو حصل reconnect)
 * @param {ReturnType<import('./db.js').createDb>} deps.db
 * @param {(transport:object)=>ReturnType<import('./flows/engine.js').createEngine>} deps.makeEngine
 * @param {object} deps.config  إعدادات ثابتة (maxMessageAgeMinutes)
 * @param {object} deps.logger
 */
export function createHandler({ getSock, db, makeEngine, config, logger, now = () => Date.now(), rand = Math.random }) {
  const queues = new Map(); // jid → Promise: رسايل نفس المحادثة بتتعالج بالترتيب
  const recentReplies = new Map(); // jid → [timestamps] للحد الأقصى في الدقيقة
  const botSent = new Set(); // IDs الرسايل اللي البوت بعتها، عشان ما يفتكرهاش رد منك
  const behavior = () => db.getSettings().behavior;

  const remember = (sent) => {
    if (!sent?.key?.id) return;
    botSent.add(sent.key.id);
    if (botSent.size > 1000) botSent.delete(botSent.values().next().value);
  };

  const selfJids = () => {
    const u = getSock()?.user || {};
    return [u.id, u.lid].filter(Boolean).map((j) => jidNormalizedUser(j));
  };

  const engine = makeEngine({
    async send(jid, text, key) {
      const sent = await sendLikeHuman(getSock(), jid, key, text, behavior(), rand);
      remember(sent);
      return sent;
    },
    async notifyOwner(text) {
      const [me] = selfJids();
      if (!me) return;
      remember(await getSock().sendMessage(me, { text }));
    },
  });

  function overRateLimit(jid) {
    const t = now();
    const list = (recentReplies.get(jid) || []).filter((x) => t - x < 60_000);
    recentReplies.set(jid, list);
    if (list.length >= behavior().maxRepliesPerMinute) return true;
    list.push(t);
    return false;
  }

  // ---- رسايل إنت بعتها من موبايلك/جهازك ----
  async function handleOwnerMessage(msg, jid) {
    if (botSent.has(msg.key.id)) return;
    const { text } = extractText(msg.message);
    const cmd = text.trim().toLowerCase();

    if (cmd === '#bot' || cmd === '#stop') {
      if (cmd === '#bot') {
        engine.resumeContact(jid);
        logger.info(`🤖 [${jid}] البوت رجع يرد (أمر #bot)`);
      } else {
        engine.pauseContact(jid, 'owner_command', null);
        logger.info(`⏸️ [${jid}] البوت اتوقف هنا لحد ما تكتب #bot`);
      }
      if (behavior().deleteOwnerCommands) await getSock().sendMessage(jid, { delete: msg.key }).catch(() => {});
      return;
    }

    // إنت رديت بنفسك → البوت يسكت في المحادثة دي عشان ما يدخلش في كلامك
    const hours = behavior().ownerReplyPauseHours;
    if (hours > 0) {
      const c = db.getContact(jid);
      if (c?.paused?.until === null) return; // متوقف لحد #bot، سيبه كده
      const wasActive = !engine.isPaused(jid);
      engine.pauseContact(jid, 'owner_reply', hours);
      if (text) db.addMessage(jid, 'owner', text);
      if (wasActive) logger.info(`✋ [${c?.name || jid}] إنت رديت بنفسك — البوت ساكت هنا ${hours} ساعة`);
    }
  }

  // ---- رسايل العملاء ----
  async function handleCustomerMessage(msg, jid) {
    const { kind, text } = extractText(msg.message);
    if (kind === 'ignore') return;
    if (!db.getSettings().globalPaused && !engine.isPaused(jid) && overRateLimit(jid)) {
      logger.warn(`[${jid}] رسايل كتير في دقيقة، البوت هيستنى شوية`);
      return;
    }
    await engine.handleInbound({ jid, text, kind, key: msg.key, name: msg.pushName || '', phone: phoneOf(msg) });
  }

  async function processMessage(msg, type) {
    const jid = msg.key?.remoteJid;
    if (!msg.message || isIgnoredJid(jid)) return;
    if (selfJids().includes(jidNormalizedUser(jid))) return; // محادثتك مع نفسك

    const ts = Number(msg.messageTimestamp || 0) * 1000;
    if (ts && now() - ts > config.maxMessageAgeMinutes * 60_000) return; // رسايل قديمة (من قبل التشغيل)

    if (msg.key.fromMe) return handleOwnerMessage(msg, jid);
    if (type !== 'notify') return; // 'append' = رسايل قديمة/مزامنة، مش رسايل جديدة
    return handleCustomerMessage(msg, jid);
  }

  /** الـ listener بتاع حدث messages.upsert */
  function onMessagesUpsert({ messages, type }) {
    const jobs = [];
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid) continue;
      jobs.push(enqueue(jid, () => processMessage(msg, type)));
    }
    return Promise.all(jobs);
  }

  /** كل محادثة ليها طابور: الرسايل بتتعالج بالترتيب واحدة ورا التانية */
  function enqueue(jid, fn) {
    const prev = queues.get(jid) || Promise.resolve();
    const job = prev
      .then(fn)
      .catch((err) => logger.error({ err }, `[${jid}] حصلت مشكلة وأنا بعالج الرسالة`))
      .finally(() => {
        if (queues.get(jid) === job) queues.delete(jid);
      });
    queues.set(jid, job);
    return job;
  }

  return { onMessagesUpsert, engine, botSent, tick: () => engine.tick() };
}
