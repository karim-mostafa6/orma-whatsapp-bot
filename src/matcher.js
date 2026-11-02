// مطابقة رسالة العميل مع المواضيع اللي في faq.json بالكلمات المفتاحية.
//
// شكل الكلمة المفتاحية:
//   "شحن"          → لازم تيجي ككلمة كاملة (وبتطابق برضه "والشحن"، "بالشحن"، "للشحن")
//   "استرج*"       → أي كلمة بتبدأ بـ "استرج" (استرجاع، استرجع، استرجعها ...)
//   "مدة التوصيل"  → جملة من أكتر من كلمة، لازم تيجي بنفس الترتيب
import { normalize, tokenVariants } from './normalize.js';

/** يحوّل الكلمات المفتاحية لشكل جاهز للمطابقة (مرة واحدة وقت تحميل الملف). */
export function compileKeywords(keywords = []) {
  const seen = new Set();
  const out = [];
  for (const raw of keywords) {
    const isPrefix = raw.trim().endsWith('*');
    let text = normalize(raw.replace(/\*+\s*$/, ''));
    if (!text) continue;
    const isPhrase = text.includes(' ');
    // "المقاس" و"مقاس" نفس الكلمة (أشكال الكلمة في الرسالة بتتشال منها "ال" أصلاً)، فنعدّهم مرة واحدة
    if (!isPhrase && !isPrefix && text.startsWith('ال') && text.length >= 5) text = text.slice(2);
    const id = `${text}|${isPrefix}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ raw, text, isPrefix, isPhrase, weight: text.split(' ').length });
  }
  return out;
}

function phraseHits(kw, text) {
  const padded = ` ${text} `;
  return kw.isPrefix ? padded.includes(` ${kw.text}`) : padded.includes(` ${kw.text} `);
}

// نفس النص بس من غير "و" العطف في أول الكلمات: "الشحن وطرق الدفع" → "الشحن طرق الدفع"
// عشان الجمل زي "طرق الدفع" تطابق حتى لو قبلها "و"
function withoutWaw(normText) {
  return normText
    .split(' ')
    .map((t) => (t.startsWith('و') && t.length > 3 ? t.slice(1) : t))
    .join(' ');
}

function keywordHits(kw, normText, variants) {
  if (kw.isPhrase) return phraseHits(kw, normText) || phraseHits(kw, withoutWaw(normText));
  for (const v of variants) {
    if (kw.isPrefix ? v.startsWith(kw.text) : v === kw.text) return true;
  }
  return false;
}

/**
 * بيحسب "سكور" لكل موضوع = مجموع أوزان الكلمات اللي طابقت.
 * الجملة اللي من كلمتين وزنها 2 وهكذا، عشان المطابقة الأدق تكسب.
 */
export function scoreIntent(intent, normText, variants) {
  let score = 0;
  const matched = [];
  for (const kw of intent.compiled) {
    if (keywordHits(kw, normText, variants)) {
      score += kw.weight;
      matched.push(kw.raw);
    }
  }
  return { score, matched };
}

/**
 * @param {string} text رسالة العميل
 * @param {object} faq  محتوى faq.json بعد التجهيز (loadFaq)
 * @returns {{type:'handoff'} | {type:'answer', intents:object[]} | {type:'none'}}
 */
export function matchMessage(text, faq) {
  const normText = normalize(text);
  if (!normText) return { type: 'none' };

  const variants = new Set();
  for (const tok of normText.split(' ')) for (const v of tokenVariants(tok)) variants.add(v);

  // طلب التحويل لموظف ليه الأولوية على أي حاجة تانية
  if (scoreIntent({ compiled: faq.handoffCompiled }, normText, variants).score > 0) {
    return { type: 'handoff' };
  }

  const hits = faq.intents
    .map((intent, order) => ({ intent, order, ...scoreIntent(intent, normText, variants) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);

  if (hits.length === 0) return { type: 'none' };

  // لو فيه سؤال حقيقي، نتجاهل الترحيب/الشكر (smalltalk) عشان ما نرغيش
  const real = hits.filter((h) => !h.intent.smalltalk);
  const pool = real.length ? real : hits;
  // الرد التاني بيتضاف بس لو قوي زي الأول تقريباً (نص السكور على الأقل)،
  // عشان "الشحن بكام" يرد بالشحن بس، مش بالشحن + الأسعار
  const top = pool[0].score;
  const chosen = pool.filter((h) => h.score * 2 >= top).slice(0, faq.maxAnswersPerMessage);

  return { type: 'answer', intents: chosen.map((h) => h.intent), matched: chosen.flatMap((h) => h.matched) };
}
