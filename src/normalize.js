// توحيد طريقة كتابة النص العربي قبل المطابقة.
// الهدف إن "الشّحن" و"الشحن" و"إلشحن" و"الشحــن" يتعاملوا كأنهم نفس الكلمة.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

/**
 * يرجّع نص موحّد: حروف صغيرة، من غير تشكيل أو تطويل أو علامات ترقيم،
 * والحروف المتشابهة متوحدة (أ/إ/آ → ا، ة → ه، ى → ي ...).
 * الأرقام بتتحول لأرقام إنجليزي عشان الفرانكو (sh7n) يفضل زي ما هو.
 */
export function normalize(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // أي حاجة مش حرف أو رقم (ترقيم، إيموجي) تبقى مسافة
    .replace(/(\p{L})\1{2,}/gu, '$1') // "شكراااا" → "شكرا" ، "ازييييك" → "ازيك"
    .replace(/\s+/g, ' ')
    .trim();
}

// السوابق الشائعة اللي بتلزق في أول الكلمة: "والشحن"، "بالفيزا"، "للاستبدال"، "فالدفع".
// مرتبة من الأطول للأقصر.
const PREFIXES = ['وبال', 'وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف'];

/**
 * لكل كلمة بيرجّع الشكل الأصلي + أشكالها من غير السوابق.
 * مثلاً "والشحن" → ["والشحن", "الشحن", "شحن"].
 * ما بنشيلش سابقة لو الباقي هيبقى أقل من حرفين، عشان ما نطلعش كلمات مالهاش معنى.
 */
export function tokenVariants(token) {
  const out = new Set([token]);
  for (const p of PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= 2) {
      const rest = token.slice(p.length);
      out.add(rest);
      if (rest.startsWith('ال') && rest.length - 2 >= 2) out.add(rest.slice(2));
    }
  }
  return [...out];
}
