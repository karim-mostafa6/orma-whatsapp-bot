// قلب البوت: بيستقبل كل رسالة، يقرر يرد ولا لأ، ويرد إزاي.
import {
  isJidGroup,
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
  jidNormalizedUser,
  normalizeMessageContent,
  getContentType,
} from '@whiskeysockets/baileys';
import { render } from './faq.js';
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

/** اسم العميل ورقمه (من غير لينك) عشان يظهروا في صفحة التحكم */
function shortLabel(msg) {
  const jid = msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? msg.key.remoteJidAlt : msg.key.remoteJid;
  const phone = jid.endsWith('@s.whatsapp.net') ? `+${jid.split('@')[0].split(':')[0]}` : '';
  return [msg.pushName, phone].filter(Boolean).join(' ') || jid.split('@')[0];
}

/** رقم العميل (لو متاح) عشان نبعتهولك في الإشعار */
function customerLabel(msg) {
  const jid = msg.key.remoteJidAlt?.endsWith('@s.whatsapp.net') ? msg.key.remoteJidAlt : msg.key.remoteJid;
  const name = msg.pushName ? `${msg.pushName} ` : '';
  if (jid.endsWith('@s.whatsapp.net')) {
    const phone = jid.split('@')[0].split(':')[0];
    return `${name}(+${phone}) wa.me/${phone}`;
  }
  return name.trim() || jid;
}

/**
 * @param {object} deps
 * @param {() => object} deps.getSock  بيرجّع الـ socket الحالي (بيتغير لو حصل reconnect)
 * @param {{current: object}} deps.faq
 * @param {import('./state.js').ChatState} deps.state
 * @param {(text:string, faq:object)=>Promise<object>} deps.responder
 * @param {object} deps.config
 * @param {object} deps.logger
 */
export function createHandler({ getSock, faq, state, responder, config, logger, now = () => Date.now(), rand = Math.random }) {
  const queues = new Map(); // jid → Promise: رسايل نفس المحادثة بتتعالج بالترتيب واحدة ورا التانية
  const recentReplies = new Map(); // jid → [timestamps] للحد الأقصى في الدقيقة
  const botSent = new Set(); // IDs الرسايل اللي البوت بعتها، عشان ما يفتكرهاش رد منك

  const remember = (sent) => {
    if (!sent?.key?.id) return;
    botSent.add(sent.key.id);
    if (botSent.size > 1000) botSent.delete(botSent.values().next().value);
  };

  const selfJids = () => {
    const u = getSock().user || {};
    return [u.id, u.lid].filter(Boolean).map((j) => jidNormalizedUser(j));
  };

  async function reply(jid, key, text) {
    const sent = await sendLikeHuman(getSock(), jid, key, text, config, rand);
    remember(sent);
    return sent;
  }

  async function notifyOwner(msg, reason, text) {
    if (!config.notifyOwner) return;
    const [me] = selfJids();
    if (!me) return;
    const template = faq.current.system.owner_notify || '🔔 {reason}\nالعميل: {customer}\nرسالته: {message}';
    const body = render(template, { reason, customer: customerLabel(msg), message: text || '(صورة/ريكورد/ملف)' });
    try {
      remember(await getSock().sendMessage(me, { text: body }));
    } catch (err) {
      logger.warn(`ما قدرتش أبعت إشعار لرقمك: ${err.message}`);
    }
  }

  function overRateLimit(jid) {
    const t = now();
    const list = (recentReplies.get(jid) || []).filter((x) => t - x < 60_000);
    recentReplies.set(jid, list);
    if (list.length >= config.maxRepliesPerMinute) return true;
    list.push(t);
    return false;
  }

  async function handoff(jid, msg, text, replyText, reason) {
    await reply(jid, msg.key, replyText);
    state.pause(jid, reason, config.handoffHours, shortLabel(msg));
    logger.info(`👤 [${jid}] اتحوّل لموظف (${reason}) — البوت ساكت هنا ${config.handoffHours || '∞'} ساعة أو لحد #bot`);
    await notifyOwner(msg, reasonLabel(reason), text);
  }

  // ---- رسايل إنت بعتها من موبايلك/جهازك ----
  async function handleOwnerMessage(msg, jid) {
    if (botSent.has(msg.key.id)) return;
    const { text } = extractText(msg.message);
    const cmd = text.trim().toLowerCase();

    if (cmd === '#bot' || cmd === '#stop') {
      if (cmd === '#bot') {
        state.resume(jid);
        logger.info(`🤖 [${jid}] البوت رجع يرد (أمر #bot)`);
      } else {
        state.pause(jid, 'owner_command', null);
        logger.info(`⏸️ [${jid}] البوت اتوقف هنا لحد ما تكتب #bot`);
      }
      if (config.deleteOwnerCommands) {
        await getSock().sendMessage(jid, { delete: msg.key }).catch(() => {});
      }
      return;
    }

    // إنت رديت بنفسك → البوت يسكت في المحادثة دي عشان ما يدخلش في كلامك
    if (config.ownerReplyPauseHours > 0) {
      const current = state.pausedInfo(jid);
      if (current?.until === null) return; // متوقف لحد #bot، سيبه كده
      const wasActive = !state.isPaused(jid);
      state.pause(jid, 'owner_reply', config.ownerReplyPauseHours);
      if (wasActive) logger.info(`✋ [${jid}] إنت رديت بنفسك — البوت ساكت هنا ${config.ownerReplyPauseHours} ساعة`);
    }
  }

  // ---- رسايل العملاء ----
  async function handleCustomerMessage(msg, jid) {
    if (state.globalPaused) return; // البوت متوقف من صفحة التحكم
    if (state.isPaused(jid)) {
      logger.debug(`[${jid}] متحوّل لموظف، البوت مش هيرد`);
      return;
    }
    const { kind, text } = extractText(msg.message);
    if (kind === 'ignore') return;

    if (overRateLimit(jid)) {
      logger.warn(`[${jid}] رسايل كتير في دقيقة، البوت هيستنى شوية`);
      return;
    }

    const f = faq.current;
    if (kind === 'media') {
      await handoff(jid, msg, '', render(f.system.media, f.variables, rand), 'media');
      return;
    }

    const result = await responder(text, f);
    logger.info(`💬 [${jid}] "${text.slice(0, 80)}" → ${result.type}${result.intents ? ` (${result.intents.join(', ')})` : ''}`);

    if (result.type === 'answer' && result.handoff) {
      await handoff(jid, msg, text, result.text, 'needs_human');
    } else if (result.type === 'answer') {
      state.clearUnmatched(jid);
      await reply(jid, msg.key, result.text);
    } else if (result.type === 'handoff') {
      await handoff(jid, msg, text, render(f.system.handoff, f.variables, rand), 'customer_request');
    } else {
      const n = state.bumpUnmatched(jid);
      if (config.unmatchedBeforeHandoff > 0 && n >= config.unmatchedBeforeHandoff) {
        await handoff(jid, msg, text, render(f.system.fallback_handoff, f.variables, rand), 'not_understood');
      } else {
        await reply(jid, msg.key, render(f.system.fallback, f.variables, rand));
      }
    }
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
      const prev = queues.get(jid) || Promise.resolve();
      const job = prev
        .then(() => processMessage(msg, type))
        .catch((err) => logger.error({ err }, `[${jid}] حصلت مشكلة وأنا بعالج الرسالة`))
        .finally(() => {
          if (queues.get(jid) === job) queues.delete(jid);
        });
      queues.set(jid, job);
      jobs.push(job);
    }
    return Promise.all(jobs);
  }

  return { onMessagesUpsert, botSent };
}

function reasonLabel(reason) {
  return (
    {
      customer_request: 'عميل طلب يكلم موظف',
      not_understood: 'البوت ما فهمش العميل',
      media: 'عميل بعت صورة/ريكورد/ملف',
      needs_human: 'عميل سأل عن حاجة محتاجة موظف',
    }[reason] || reason
  );
}
