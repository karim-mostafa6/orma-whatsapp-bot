// أول تشغيل: بنحوّل الردود القديمة (data/faq.json) لـ Flows جاهزة + إعدادات افتراضية،
// عشان صاحب المتجر ما يبدأش من الصفر.
import fs from 'node:fs';

let seq = 0;
const nid = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export const DEFAULT_TEXTS = {
  handoff: 'حاضر من عينينا 🤍\nحوّلتك لحد من فريق خدمة العملاء، وهيرد عليك بنفسه في أقرب وقت.',
  invalidChoice: 'معلش، ابعت رقم الاختيار بس 🙏 (مثلاً 1)',
  ownerNotify: '🔔 *{reason}*\nالعميل: {customer}\nرسالته: {message}\n\n(البوت ساكت في المحادثة دي. اكتب #bot جوه المحادثة أو دوس "رجّع البوت" من صفحة التحكم)',
};

export function defaultSettings(config, faqRaw) {
  return {
    globalPaused: false,
    variables: faqRaw?.variables || { store_name: 'ORMA', store_url: '⚠️ لينك المتجر' },
    behavior: {
      minDelayMs: config.minDelayMs,
      maxDelayMs: config.maxDelayMs,
      markAsRead: config.markAsRead,
      handoffHours: config.handoffHours,
      ownerReplyPauseHours: config.ownerReplyPauseHours,
      notifyOwner: config.notifyOwner,
      deleteOwnerCommands: config.deleteOwnerCommands,
      maxRepliesPerMinute: config.maxRepliesPerMinute,
      maxAnswersPerMessage: Number(faqRaw?.max_answers_per_message) || 2,
    },
    texts: {
      handoff: faqRaw?.system?.handoff || DEFAULT_TEXTS.handoff,
      invalidChoice: DEFAULT_TEXTS.invalidChoice,
      ownerNotify: faqRaw?.system?.owner_notify || DEFAULT_TEXTS.ownerNotify,
    },
  };
}

const asList = (a) => (Array.isArray(a) ? a : [a]).filter((s) => typeof s === 'string' && s.trim());
const first = (a) => asList(a)[0] || '';

/** يبني Flow من سلسلة خطوات ورا بعض (كل خطوة تحت اللي قبلها) */
function chain(id, name, steps, extra = {}) {
  const nodes = steps.map((s, i) => ({ id: nid('n'), type: s.type, position: { x: 250, y: i * 170 }, data: s.data }));
  const edges = nodes.slice(1).map((n, i) => ({ id: nid('e'), source: nodes[i].id, sourceHandle: 'next', target: n.id }));
  return { id, name, status: 'active', priority: 0, description: '', nodes, edges, ...extra };
}

export function defaultFlows(faqRaw) {
  const flows = [];
  const sys = faqRaw?.system || {};

  // 1) طلب موظف — أعلى أولوية
  flows.push(
    chain(
      'flow_handoff',
      'العميل طلب يكلم موظف',
      [
        { type: 'trigger', data: { event: 'keywords', keywords: faqRaw?.handoff_keywords || ['موظف', 'خدمه العملاء', 'اكلم حد'], onlyIfAlone: false } },
        { type: 'handoff', data: { text: first(sys.handoff), hours: 0 } },
      ],
      { priority: 100 }
    )
  );

  // 2) كل موضوع من faq.json يبقى Flow
  for (const it of faqRaw?.intents || []) {
    const trigger = { type: 'trigger', data: { event: 'keywords', keywords: it.keywords || [], onlyIfAlone: Boolean(it.smalltalk) } };
    if (it.id === 'returns') {
      flows.push(returnsFlow(it, trigger));
      continue;
    }
    const steps = it.handoff
      ? [trigger, { type: 'handoff', data: { text: first(it.answer), hours: 0 } }]
      : [trigger, { type: 'send_message', data: { texts: asList(it.answer) } }];
    flows.push(chain(`flow_${it.id}`, it.title || it.id, steps, { priority: it.smalltalk ? -10 : 0 }));
  }

  // 3) صورة أو ريكورد
  flows.push(
    chain('flow_media', 'العميل بعت صورة أو ريكورد', [
      { type: 'trigger', data: { event: 'media' } },
      { type: 'handoff', data: { text: first(sys.media) || 'وصلتنا رسالتك 🤍 حد من الفريق هيرد عليك في أقرب وقت.', hours: 0 } },
    ])
  );

  // 4) رسالة مش مفهومة: أول مرة نوضّح، تاني مرة نحوّل لموظف
  const t = { id: nid('n'), type: 'trigger', position: { x: 250, y: 0 }, data: { event: 'fallback' } };
  const c = { id: nid('n'), type: 'condition', position: { x: 250, y: 170 }, data: { logic: 'and', rules: [{ type: 'unmatched_at_least', value: '2' }] } };
  // المخارج بتترتب من اليمين للشمال (أول مخرج على اليمين)، فالخطوات تحتها بنفس الترتيب عشان الأسهم ما تتقاطعش
  const h = { id: nid('n'), type: 'handoff', position: { x: 440, y: 360 }, data: { text: first(sys.fallback_handoff), hours: 0 } };
  const m = { id: nid('n'), type: 'send_message', position: { x: 60, y: 360 }, data: { texts: asList(sys.fallback).length ? asList(sys.fallback) : ['معلش ما فهمتش قصدك 🙏 ممكن توضّح أكتر؟ أو اكتب *موظف*.'] } };
  flows.push({
    id: 'flow_fallback',
    name: 'رسالة البوت ما فهمهاش',
    status: 'active',
    priority: 0,
    description: 'أول مرة البوت يوضّح المواضيع اللي يقدر يساعد فيها، وتاني مرة يحوّل لموظف.',
    nodes: [t, c, h, m],
    edges: [
      { id: nid('e'), source: t.id, sourceHandle: 'next', target: c.id },
      { id: nid('e'), source: c.id, sourceHandle: 'true', target: h.id },
      { id: nid('e'), source: c.id, sourceHandle: 'false', target: m.id },
    ],
  });
  return flows;
}

/** الاستبدال والاسترجاع: مثال فيه سؤال باختيارات (زي الصورة اللي في شاشة المتجر) */
function returnsFlow(it, trigger) {
  const t = { id: nid('n'), type: 'trigger', position: { x: 300, y: 0 }, data: trigger.data };
  const s = { id: nid('n'), type: 'send_message', position: { x: 300, y: 170 }, data: { texts: asList(it.answer).map((a) => a.replace(/\n*لو حابب تبدأ[^\n]*$/, '').trim()) } };
  const q = {
    id: nid('n'),
    type: 'ask_choice',
    position: { x: 230, y: 360 },
    data: { text: 'تحب تعمل إيه؟', options: ['أبدأ استبدال', 'أبدأ استرجاع', 'لا شكراً'], timeoutMinutes: 60 },
  };
  const h = { id: nid('n'), type: 'handoff', position: { x: 470, y: 600 }, data: { text: 'تمام 🤍 حد من الفريق هيكمّل معاك دلوقتي. ابعتلنا رقم الأوردر أو الاسم اللي طلبت بيه عشان نخلّص أسرع.', hours: 0 } };
  const ok = { id: nid('n'), type: 'send_message', position: { x: 60, y: 600 }, data: { texts: ['تحت أمرك في أي وقت 🤍'] } };
  return {
    id: 'flow_returns',
    name: it.title || 'الاستبدال والاسترجاع',
    status: 'active',
    priority: 0,
    description: '',
    nodes: [t, s, q, h, ok],
    edges: [
      { id: nid('e'), source: t.id, sourceHandle: 'next', target: s.id },
      { id: nid('e'), source: s.id, sourceHandle: 'next', target: q.id },
      { id: nid('e'), source: q.id, sourceHandle: 'opt_0', target: h.id },
      { id: nid('e'), source: q.id, sourceHandle: 'opt_1', target: h.id },
      { id: nid('e'), source: q.id, sourceHandle: 'opt_2', target: ok.id },
    ],
  };
}

export function readFaqSeed(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
