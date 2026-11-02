// تحميل data/faq.json ومراقبته: أي تعديل في الملف بيتقري تلقائياً من غير restart.
// لو الملف اتحفظ وفيه غلطة (JSON مكسور أو حاجة ناقصة)، البوت بيكمّل بالنسخة القديمة
// وبيكتب الغلطة في اللوج، عشان ما يقعش.
import fs from 'node:fs';
import { compileKeywords } from './matcher.js';

const REQUIRED_SYSTEM = ['handoff', 'fallback', 'fallback_handoff', 'media'];

/** يحوّل محتوى الملف (object) لشكل جاهز للاستخدام، أو يرمي Error بالمشكلة بالظبط. */
export function prepareFaq(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('الملف لازم يكون JSON object');
  if (!Array.isArray(raw.intents) || raw.intents.length === 0) throw new Error('"intents" لازم تكون list فيها موضوع واحد على الأقل');
  if (!Array.isArray(raw.handoff_keywords)) throw new Error('"handoff_keywords" لازم تكون list');

  const system = raw.system || {};
  for (const key of REQUIRED_SYSTEM) {
    if (!isAnswer(system[key])) throw new Error(`"system.${key}" ناقص أو فاضي`);
  }

  const ids = new Set();
  const intents = raw.intents.map((it, i) => {
    const where = `intents[${i}]${it?.id ? ` (${it.id})` : ''}`;
    if (!it || typeof it.id !== 'string' || !it.id) throw new Error(`${where}: "id" ناقص`);
    if (ids.has(it.id)) throw new Error(`${where}: الـ id ده متكرر`);
    ids.add(it.id);
    if (!Array.isArray(it.keywords) || it.keywords.length === 0) throw new Error(`${where}: "keywords" فاضية`);
    if (!isAnswer(it.answer)) throw new Error(`${where}: "answer" ناقص أو فاضي`);
    return { ...it, smalltalk: Boolean(it.smalltalk), compiled: compileKeywords(it.keywords) };
  });

  return {
    variables: raw.variables || {},
    system,
    intents,
    handoffCompiled: compileKeywords(raw.handoff_keywords),
    maxAnswersPerMessage: Number(raw.max_answers_per_message) > 0 ? Number(raw.max_answers_per_message) : 2,
  };
}

function isAnswer(a) {
  if (typeof a === 'string') return a.trim().length > 0;
  return Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string' && s.trim());
}

/**
 * يجهّز نص الرد: لو "answer" فيه أكتر من صيغة بيختار واحدة عشوائي (عشان الردود ما تبانش متكررة)،
 * وبيبدّل {store_url} وأي متغير تاني من "variables".
 */
export function render(answer, variables = {}, rand = Math.random) {
  const text = Array.isArray(answer) ? answer[Math.floor(rand() * answer.length)] : answer;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in variables ? String(variables[name]) : m));
}

export function loadFaqFile(file) {
  return prepareFaq(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** أسماء المتغيرات اللي لسه فيها ⚠️ (يعني لسه ما اتكتبش مكانها المعلومة الحقيقية) */
export function unfilledVariables(faq) {
  return Object.entries(faq.variables)
    .filter(([, v]) => String(v).includes('⚠️'))
    .map(([k]) => k);
}

function warnUnfilled(faq, logger) {
  const missing = unfilledVariables(faq);
  if (missing.length) {
    logger.warn(`⚠️ لسه فيه معلومات ناقصة في faq.json ← variables: ${missing.join(', ')}. العملاء هيشوفوا علامة ⚠️ في الردود لحد ما تكتبها.`);
  }
}

/** بيرجّع object فيه .current (آخر نسخة سليمة) وبيراقب الملف. */
export function watchFaq(file, logger) {
  const holder = { current: loadFaqFile(file) };
  logger.info(`تم تحميل ${holder.current.intents.length} موضوع من ${file}`);
  warnUnfilled(holder.current, logger);

  // watchFile (polling) أضمن من fs.watch مع المحررات اللي بتحفظ بملف مؤقت وتعمل rename
  fs.watchFile(file, { interval: 2000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    try {
      holder.current = loadFaqFile(file);
      logger.info(`✅ faq.json اتحدّث (${holder.current.intents.length} موضوع)`);
      warnUnfilled(holder.current, logger);
    } catch (err) {
      logger.error(`❌ faq.json فيه غلطة، البوت مكمّل بالنسخة القديمة: ${err.message}`);
    }
  });
  return holder;
}
