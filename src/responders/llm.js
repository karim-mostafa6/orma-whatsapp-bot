// (اختياري) ربط بـ LLM مجاني لما الكلمات المفتاحية ما تلاقيش رد.
// بيشتغل مع أي API متوافق مع OpenAI Chat Completions، زي:
//   - Groq:   LLM_BASE_URL=https://api.groq.com/openai/v1
//   - Gemini: LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
//   - Ollama على جهازك: LLM_BASE_URL=http://localhost:11434/v1
// الـ LLM بياخد المعلومات من faq.json بس، وممنوع يألّف أسعار أو سياسات.
import { render } from '../faq.js';

function buildSystemPrompt(faq) {
  const facts = faq.intents
    .filter((it) => !it.smalltalk)
    .map((it) => `- ${it.id}: ${render(Array.isArray(it.answer) ? it.answer[0] : it.answer, faq.variables)}`)
    .join('\n');
  return [
    `إنت موظف خدمة عملاء لبراند فضة عيار 925 اسمه ${faq.variables.store_name || 'ORMA'} على واتساب.`,
    'اتكلم بالعامية المصرية، بأسلوب ودود وراقي ومحترم، ورد باختصار (3 سطور بالكتير).',
    'استخدم المعلومات اللي تحت بس. ما تألّفش أي سعر أو مدة أو سياسة مش مكتوبة.',
    'لو العميل طلب يكلم شخص حقيقي، أو سؤاله محتاج موظف (طلب معيّن، شكوى، حالة أوردر)، رد بكلمة HANDOFF بس.',
    'لو السؤال مالوش علاقة بالبراند أو مش لاقي إجابته في المعلومات، رد بكلمة NONE بس.',
    '',
    'المعلومات:',
    facts,
  ].join('\n');
}

export function createLlmResponder({ baseUrl, apiKey, model, timeoutMs = 15000 }, fetchImpl = fetch) {
  return async function llmResponder(text, faq) {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: 'system', content: buildSystemPrompt(faq) },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM API رجّع ${res.status}`);
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!out || /^NONE\b/i.test(out)) return { type: 'none' };
    if (/^HANDOFF\b/i.test(out)) return { type: 'handoff' };
    return { type: 'answer', text: out, intents: ['llm'] };
  };
}

/**
 * الكلمات المفتاحية الأول (مجانية وأكيدة)، ولو ما لقتش رد نسأل الـ LLM.
 * لو الـ LLM وقع أو اتأخر، بنكمّل عادي كأنه ما فهمش (يعني رسالة التوضيح ثم التحويل لموظف).
 */
export function createHybridResponder(keywordResponder, llmResponder, logger) {
  return async function hybridResponder(text, faq) {
    const first = await keywordResponder(text, faq);
    if (first.type !== 'none') return first;
    try {
      return await llmResponder(text, faq);
    } catch (err) {
      logger?.warn(`LLM مش متاح دلوقتي: ${err.message}`);
      return { type: 'none' };
    }
  };
}
