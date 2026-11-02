import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, tokenVariants } from '../src/normalize.js';
import { matchMessage } from '../src/matcher.js';
import { loadFaqFile, prepareFaq, render, unfilledVariables } from '../src/faq.js';

const FAQ_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/faq.json');
const faq = loadFaqFile(FAQ_FILE);
const ids = (text) => {
  const r = matchMessage(text, faq);
  return r.type === 'answer' ? r.intents.map((i) => i.id) : r.type;
};

test('normalize: يوحّد الحروف ويشيل التشكيل والتطويل والتكرار', () => {
  assert.equal(normalize('الشّحــن'), 'الشحن');
  assert.equal(normalize('إستبدال أو إسترجاع؟'), 'استبدال او استرجاع');
  assert.equal(normalize('فضة عيار ٩٢٥'), 'فضه عيار 925');
  assert.equal(normalize('شكراااا 🙏🙏'), 'شكرا');
  assert.equal(normalize('مستشفى'), 'مستشفي');
  assert.equal(normalize('SH7N!!'), 'sh7n');
  assert.equal(normalize(''), '');
});

test('tokenVariants: يشيل السوابق (و، ب، ل، ال ...)', () => {
  assert.ok(tokenVariants('والشحن').includes('شحن'));
  assert.ok(tokenVariants('بالفيزا').includes('فيزا'));
  assert.ok(tokenVariants('للاستبدال').includes('استبدال'));
  assert.deepEqual(tokenVariants('بس'), ['بس']); // ما يطلعش كلمة حرف واحد
});

test('matcher: الأسئلة الشائعة بتروح للموضوع الصح', () => {
  assert.deepEqual(ids('الفضة دي عيار كام؟'), ['material_925']);
  assert.deepEqual(ids('الشحن بياخد كام يوم'), ['shipping']);
  assert.deepEqual(ids('ممكن استرجع الخاتم؟'), ['returns']);
  assert.deepEqual(ids('عايزة أبدل المقاس'), ['returns', 'sizes']);
  assert.deepEqual(ids('بتقبلوا انستاباي؟'), ['payment']);
  assert.deepEqual(ids('بالفيزا ينفع؟'), ['payment']);
  assert.deepEqual(ids('السلسلة بتسود؟'), ['care']);
  assert.deepEqual(ids('sh7n'), ['shipping']);
  assert.deepEqual(ids('السعر كام'), ['prices_catalog']);
});

test('matcher: الترحيب لوحده بيترد عليه، ومع سؤال بيتجاهل', () => {
  assert.deepEqual(ids('السلام عليكم'), ['greeting']);
  assert.deepEqual(ids('السلام عليكم، الشحن بكام؟'), ['shipping']);
  assert.deepEqual(ids('شكرا جدا'), ['thanks']);
});

test('matcher: سؤالين في رسالة واحدة → ردين (بحد أقصى max_answers_per_message)', () => {
  assert.deepEqual(ids('الشحن بكام وطرق الدفع ايه'), ['shipping', 'payment']);
  assert.equal(ids('الشحن والدفع والاستبدال والخامة').length, 2);
});

test('matcher: طلب موظف ليه الأولوية على أي حاجة', () => {
  assert.equal(ids('عايز اكلم حد من خدمة العملاء'), 'handoff');
  assert.equal(ids('عاوز أكلم موظف بخصوص الشحن'), 'handoff');
  assert.equal(ids('I want a human'), 'handoff');
});

test('matcher: رسالة مالهاش علاقة → none', () => {
  assert.equal(ids('ايه رأيك في الماتش امبارح'), 'none');
  assert.equal(ids('🙂'), 'none');
  assert.equal(ids(''), 'none');
});

test('matcher: الكلمة لازم تكون كاملة (مش جزء من كلمة تانية)', () => {
  // "دفع" ما تطابقش "مدفعيه"
  assert.equal(ids('مدفعيه'), 'none');
});

test('faq: order_status عليه handoff', () => {
  const r = matchMessage('الاوردر بتاعي اتأخر', faq);
  assert.equal(r.type, 'answer');
  assert.equal(r.intents[0].handoff, true);
});

test('faq: render بيبدّل المتغيرات وبيختار صيغة من الصيغ', () => {
  assert.equal(render('أهلاً في {store_name}', { store_name: 'ORMA' }), 'أهلاً في ORMA');
  assert.equal(render('{unknown}', {}), '{unknown}');
  assert.equal(render(['أ', 'ب'], {}, () => 0.99), 'ب');
});

test('faq: الملف الحالي سليم، وبيكشف المتغيرات الناقصة', () => {
  assert.ok(faq.intents.length > 5);
  assert.ok(unfilledVariables(prepareFaq({ ...minimal(), variables: { a: '⚠️ x', b: 'ok' } })).includes('a'));
});

test('faq: validation بيرفض الملف الغلط برسالة واضحة', () => {
  assert.throws(() => prepareFaq({}), /intents/);
  assert.throws(() => prepareFaq({ ...minimal(), system: {} }), /system\.handoff/);
  assert.throws(() => prepareFaq({ ...minimal(), intents: [{ id: 'x', keywords: [], answer: 'y' }] }), /keywords/);
  const dup = { id: 'x', keywords: ['a'], answer: 'y' };
  assert.throws(() => prepareFaq({ ...minimal(), intents: [dup, dup] }), /متكرر/);
});

function minimal() {
  return {
    handoff_keywords: ['موظف'],
    intents: [{ id: 'a', keywords: ['اهلا'], answer: 'hi' }],
    system: { handoff: 'h', fallback: 'f', fallback_handoff: 'fh', media: 'm' },
  };
}
