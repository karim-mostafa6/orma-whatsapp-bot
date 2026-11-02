// الرد بالكلمات المفتاحية من faq.json. ده الوضع الافتراضي: مجاني، سريع، ومن غير إنترنت إضافي.
import { matchMessage } from '../matcher.js';
import { render } from '../faq.js';

/**
 * كل "responder" لازم يرجّع واحد من دول:
 *   { type: 'answer', text, handoff? } → رد جاهز يتبعت (ولو handoff: true يتحوّل لموظف بعده)
 *   { type: 'handoff' }        → العميل عايز يكلم موظف
 *   { type: 'none' }           → مش فاهم الرسالة
 */
export function createKeywordResponder() {
  return async function keywordResponder(text, faq) {
    const result = matchMessage(text, faq);
    if (result.type !== 'answer') return result;
    const reply = result.intents.map((it) => render(it.answer, faq.variables)).join('\n\n');
    // موضوع عليه "handoff": true → البوت يرد وبعدين يحوّل لموظف (مثلاً: "الأوردر بتاعي فين؟")
    const handoff = result.intents.some((it) => it.handoff === true);
    return { type: 'answer', text: reply, intents: result.intents.map((it) => it.id), handoff };
  };
}
