// تخزين مفتاح/قيمة في Supabase (جدول واحد: orma_kv).
// بنستخدمه لما البوت يشتغل على استضافة بتمسح الملفات مع كل restart (زي Render المجاني):
// جلسة الواتساب والـ Flows والمحادثات بتتحفظ هنا بدل فولدر data/ و auth/.
//
// الكتابة بتتجمّع (batch) وبتتبعت مرة كل شوية، عشان ما نضغطش على Supabase مع كل رسالة.

const PAGE = 1000;

/**
 * @param {object} opts
 * @param {string} opts.url  Project URL (https://xxxx.supabase.co)
 * @param {string} opts.key  service_role key (بيتخطى RLS — لازم يفضل سر على السيرفر)
 * @param {string} [opts.table]
 * @param {number} [opts.flushMs]
 * @param {object} [opts.logger]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createSupabaseKv({ url, key, table = 'orma_kv', flushMs = 1500, logger, fetchImpl = fetch }) {
  const base = `${String(url).replace(/\/+$/, '')}/rest/v1/${table}`;
  // المفاتيح القديمة (service_role) عبارة عن JWT وبتتبعت في الاتنين. الجديدة (sb_secret_...) في apikey بس
  const headers = String(key).startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
  const pending = new Map(); // key → string (كتابة) أو null (مسح)
  let timer = null;
  let flushing = Promise.resolve();
  let failures = 0;

  async function request(method, path, { body, extraHeaders = {} } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 404 || /does not exist|schema cache/i.test(text)) {
        throw new Error(`جدول ${table} مش موجود في Supabase. شغّل كود الـ SQL اللي في الدليل (README) الأول.`);
      }
      if (res.status === 401 || res.status === 403) throw new Error('مفتاح Supabase غلط. اتأكد إنك نسخت الـ service_role key.');
      throw new Error(`Supabase رجّع ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }

  /** كل المفاتيح اللي بتبدأ بـ prefix (بصفحات، عشان Supabase بيرجّع 1000 بالكتير مرة واحدة) */
  async function loadAll(prefix = '') {
    const out = new Map();
    const filter = prefix ? `&key=like.${encodeURIComponent(`${prefix}*`)}` : '';
    // بنكمّل لحد ما ترجع صفحة فاضية (السيرفر ممكن يرجّع أقل من اللي طلبناه بسبب حد عنده)
    for (let from = 0; ; ) {
      const res = await request('GET', `?select=key,value&order=key${filter}`, {
        extraHeaders: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
      });
      const rows = await res.json();
      if (!rows.length) break;
      for (const r of rows) out.set(r.key, r.value);
      from += rows.length;
    }
    return out;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, flushMs);
  }

  function flush() {
    // .catch: لو حفظ قبل كده فشل، ما نسيبش الفشل ده يوقف كل الحفظ اللي بعده
    flushing = flushing.catch(() => {}).then(async () => {
      if (!pending.size) return;
      const batch = new Map(pending);
      pending.clear();
      const upserts = [];
      const deletes = [];
      for (const [k, v] of batch) (v === null ? deletes : upserts).push(k);
      try {
        for (let i = 0; i < upserts.length; i += 200) {
          const rows = upserts.slice(i, i + 200).map((k) => ({ key: k, value: batch.get(k), updated_at: new Date().toISOString() }));
          await request('POST', '?on_conflict=key', { body: rows, extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
        }
        for (let i = 0; i < deletes.length; i += 100) {
          const list = deletes
            .slice(i, i + 100)
            .map((k) => `"${k.replace(/["\\]/g, (c) => `\\${c}`)}"`)
            .join(',');
          await request('DELETE', `?key=in.(${encodeURIComponent(list)})`, { extraHeaders: { Prefer: 'return=minimal' } });
        }
        failures = 0;
      } catch (err) {
        // نرجّع اللي ما اتحفظش للطابور (من غير ما نكتب فوق تعديل أحدث) ونحاول تاني بعد شوية
        for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v);
        failures += 1;
        if (failures === 1 || failures % 20 === 0) logger?.warn(`⚠️ ما قدرتش أحفظ في Supabase (هحاول تاني): ${err.message}`);
        setTimeout(schedule, Math.min(60_000, 2000 * failures)).unref?.();
        throw err;
      }
    });
    return flushing;
  }

  return {
    loadAll,
    set(k, value) {
      pending.set(k, String(value));
      schedule();
    },
    del(k) {
      pending.set(k, null);
      schedule();
    },
    /** يستنى لحد ما كل حاجة تتحفظ (قبل ما البوت يقفل) */
    async flushNow() {
      clearTimeout(timer);
      timer = null;
      await flush().catch(() => {});
    },
    /** اختبار سريع وقت التشغيل: الجدول موجود والمفتاح صح */
    async check() {
      await request('GET', '?select=key&limit=1');
    },
  };
}
