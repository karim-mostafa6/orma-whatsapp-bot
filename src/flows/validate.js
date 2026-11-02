// فحص الـ Flow قبل الحفظ: أخطاء (تمنع التشغيل) وتنبيهات (للعلم بس).
// مشترك بين البوت وصفحة التحكم.
import { NODE_SPECS, nodeOutputs } from './specs.js';

/**
 * @returns {{errors: {nodeId?:string, text:string}[], warnings: {nodeId?:string, text:string}[]}}
 */
export function validateFlow(flow) {
  const errors = [];
  const warnings = [];
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (!String(flow?.name || '').trim()) errors.push({ text: 'الـ Flow محتاج اسم.' });

  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) errors.push({ text: 'لازم يكون فيه خطوة «المُشغّل» عشان الـ Flow يعرف يبدأ إمتى.' });
  if (triggers.length > 1) errors.push({ nodeId: triggers[1].id, text: 'مينفعش يكون فيه أكتر من «مُشغّل» في نفس الـ Flow.' });

  for (const n of nodes) {
    const d = n.data || {};
    const name = NODE_SPECS[n.type]?.label || n.type;
    if (!NODE_SPECS[n.type]) {
      errors.push({ nodeId: n.id, text: `نوع خطوة مش معروف: ${n.type}` });
      continue;
    }
    if (n.type === 'trigger' && d.event === 'keywords' && !(d.keywords || []).length) errors.push({ nodeId: n.id, text: 'المُشغّل محتاج كلمة واحدة على الأقل.' });
    if (n.type === 'send_message' && !(d.texts || []).some((t) => String(t).trim())) errors.push({ nodeId: n.id, text: '«إرسال رسالة» فاضية.' });
    if ((n.type === 'ask_choice' || n.type === 'ask_question') && !String(d.text || '').trim()) errors.push({ nodeId: n.id, text: `«${name}» محتاج نص السؤال.` });
    if (n.type === 'ask_choice') {
      const opts = (d.options || []).filter((o) => String(o).trim());
      if (opts.length < 1) errors.push({ nodeId: n.id, text: '«سؤال باختيارات» محتاج اختيار واحد على الأقل.' });
      if (opts.length > 9) errors.push({ nodeId: n.id, text: 'أقصى عدد اختيارات 9.' });
    }
    if (n.type === 'ask_question' && !/^[\w؀-ۿ]+$/.test(String(d.saveAs || ''))) errors.push({ nodeId: n.id, text: 'اسم حفظ الإجابة لازم يكون كلمة واحدة (حروف أو أرقام).' });
    if (n.type === 'delay' && !(Number(d.amount) > 0)) errors.push({ nodeId: n.id, text: 'مدة التأخير لازم تكون أكبر من صفر.' });
    if (n.type === 'delay' && toMs(d) > 7 * 86400_000) errors.push({ nodeId: n.id, text: 'أقصى تأخير 7 أيام.' });
    if ((n.type === 'add_tag' || n.type === 'remove_tag') && !String(d.tag || '').trim()) errors.push({ nodeId: n.id, text: `«${name}» محتاج اسم التصنيف.` });
    if (n.type === 'condition') {
      if (!(d.rules || []).length) errors.push({ nodeId: n.id, text: 'الشرط محتاج قاعدة واحدة على الأقل.' });
      for (const r of d.rules || []) {
        if (['message_contains', 'answer_contains', 'has_tag', 'within_hours', 'unmatched_at_least'].includes(r.type) && !String(r.value || '').trim()) {
          errors.push({ nodeId: n.id, text: 'فيه قاعدة في الشرط ناقصة قيمتها.' });
        }
        if (r.type === 'within_hours' && r.value && !/^\s*\d{1,2}(:\d{2})?\s*-\s*\d{1,2}(:\d{2})?\s*$/.test(r.value)) {
          errors.push({ nodeId: n.id, text: 'مواعيد العمل لازم تتكتب كده: 11:00-23:00' });
        }
      }
    }

    // المخارج اللي مش متوصلة
    if (n.type !== 'handoff') {
      const outs = nodeOutputs(n.type, d);
      const connected = new Set(edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle || 'next'));
      const main = outs.filter((o) => !['other', 'timeout', 'false'].includes(o.id));
      if (n.type !== 'send_message' && n.type !== 'add_tag' && n.type !== 'remove_tag' && n.type !== 'delay' && main.length && !main.some((o) => connected.has(o.id))) {
        warnings.push({ nodeId: n.id, text: `«${name}» مش متوصل بأي خطوة بعده.` });
      }
      if (n.type === 'trigger' && !connected.size) errors.push({ nodeId: n.id, text: 'المُشغّل لازم يتوصل بخطوة بعده.' });
    }
  }

  // خطوات مش متوصلة بالمُشغّل
  if (triggers.length === 1) {
    const reach = new Set([triggers[0].id]);
    const queue = [triggers[0].id];
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges) if (e.source === id && !reach.has(e.target) && byId.has(e.target)) reach.add(e.target), queue.push(e.target);
    }
    for (const n of nodes) if (!reach.has(n.id)) warnings.push({ nodeId: n.id, text: `«${NODE_SPECS[n.type]?.label || n.type}» مش متوصلة بالمُشغّل، فعمرها ما هتشتغل.` });
  }

  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) errors.push({ text: 'فيه سهم متوصل بخطوة اتمسحت.' });
  }
  return { errors, warnings };
}

export function toMs({ amount, unit }) {
  const n = Number(amount) || 0;
  return n * (unit === 'hours' ? 3600_000 : unit === 'seconds' ? 1000 : 60_000);
}
