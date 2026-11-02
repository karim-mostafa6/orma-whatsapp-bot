// اللوحة اللي على الجنب: إعدادات الخطوة اللي اخترتها
import React, { useEffect, useRef, useState } from 'react';
import { Trash2, X, Plus } from 'lucide-react';
import { NODE_SPECS, TRIGGER_EVENTS, CONDITION_TYPES, DELAY_UNITS, splitList } from '../../../src/flows/specs.js';

export const VAR_LABELS = {
  store_name: 'اسم البراند',
  store_url: 'لينك المتجر',
  instagram: 'الإنستجرام',
  shipping_cairo: 'شحن القاهرة',
  shipping_governorates: 'شحن المحافظات',
  shipping_fee: 'سعر الشحن',
  free_shipping: 'الشحن المجاني',
  return_days: 'مدة الاستبدال',
  payment_methods: 'طرق الدفع',
  working_hours: 'المواعيد',
};

/** خانة كلمات: بتحتفظ بالنص زي ما بتكتبه (عشان الفاصلة ما تختفيش وإنت بتكتب) */
function ListInput({ value, onChange, placeholder, rows = 3, resetKey }) {
  const [text, setText] = useState((value || []).join('، '));
  useEffect(() => setText((value || []).join('، ')), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <textarea
      className="input"
      rows={rows}
      style={{ minHeight: rows * 24 }}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitList(e.target.value));
      }}
    />
  );
}

/** زرار المتغيرات: بيضيف {store_url} مكان المؤشر */
function VarChips({ variables, onInsert }) {
  const keys = ['name', ...Object.keys(variables || {})];
  return (
    <div className="chip-list">
      {keys.map((k) => (
        <button key={k} type="button" className="chip" onClick={() => onInsert(`{${k}}`)} title={`بيتكتب في الرسالة كده: {${k}}`}>
          {k === 'name' ? 'اسم العميل' : VAR_LABELS[k] || k}
        </button>
      ))}
    </div>
  );
}

function TextWithVars({ value, onChange, variables, rows = 5, placeholder }) {
  const ref = useRef(null);
  const insert = (tok) => {
    const el = ref.current;
    const v = value || '';
    const at = el ? el.selectionStart : v.length;
    const next = v.slice(0, at) + tok + v.slice(el ? el.selectionEnd : v.length);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = at + tok.length;
    });
  };
  return (
    <>
      <textarea ref={ref} className="input" rows={rows} style={{ minHeight: rows * 22 }} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <VarChips variables={variables} onInsert={insert} />
    </>
  );
}

export default function NodeConfig({ node, onChange, onDelete, onClose, variables }) {
  const spec = NODE_SPECS[node.nodeType];
  const d = node.config || {};
  const set = (patch) => onChange({ ...d, ...patch });

  return (
    <>
      <div className="ed-config-head" style={{ background: spec.color }}>
        <div>
          <b>{spec.label}</b>
          <small>{spec.english}</small>
        </div>
        <button className="btn icon ghost" style={{ color: '#fff' }} onClick={onClose} aria-label="قفل">
          <X size={16} />
        </button>
      </div>
      <div className="ed-config-body">
        <p className="desc">{spec.description}</p>

        {node.nodeType === 'trigger' && (
          <>
            <label className="field">
              <span>يشتغل لما</span>
              <select className="input" value={d.event || 'keywords'} onChange={(e) => set({ event: e.target.value })}>
                {Object.entries(TRIGGER_EVENTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {(d.event || 'keywords') === 'keywords' && (
              <>
                <label className="field">
                  <span>الكلمات</span>
                  <ListInput value={d.keywords} onChange={(keywords) => set({ keywords })} placeholder="شحن، توصيل، shipping" rows={5} resetKey={node.id} />
                  <small>
                    افصل بفاصلة (،). مش لازم تقلق من الهمزات أو "ال" أو "و" في أول الكلمة. ولو حطيت * في آخر الكلمة (زي استرج*) هتطابق أي كلمة بتبدأ بيها.
                  </small>
                </label>
                <label className="row-inline" style={{ marginBottom: 10 }}>
                  <input type="checkbox" checked={Boolean(d.onlyIfAlone)} onChange={(e) => set({ onlyIfAlone: e.target.checked })} />
                  <span style={{ fontSize: 13 }}>رد ترحيب/شكر: يشتغل بس لو الرسالة مافيهاش سؤال تاني</span>
                </label>
              </>
            )}
            {d.event === 'fallback' && <p className="field-hint">ده بيشتغل لما رسالة العميل ما تطابقش أي Flow تاني.</p>}
          </>
        )}

        {node.nodeType === 'send_message' && (
          <>
            {(d.texts?.length ? d.texts : ['']).map((t, i, arr) => (
              <div key={i} className="field" style={{ marginBottom: 14 }}>
                <div className="row-inline" style={{ justifyContent: 'space-between' }}>
                  <span className="field-label">{arr.length > 1 ? `صيغة ${i + 1}` : 'الرسالة'}</span>
                  {arr.length > 1 && (
                    <button className="btn sm ghost danger" onClick={() => set({ texts: arr.filter((_, j) => j !== i) })}>
                      امسح
                    </button>
                  )}
                </div>
                <TextWithVars value={t} variables={variables} onChange={(v) => set({ texts: arr.map((x, j) => (j === i ? v : x)) })} placeholder="اكتب الرد هنا..." />
              </div>
            ))}
            <button className="btn sm" onClick={() => set({ texts: [...(d.texts || ['']), ''] })}>
              <Plus size={13} /> صيغة تانية للرد
            </button>
            <p className="field-hint" style={{ marginTop: 8 }}>
              لو فيه أكتر من صيغة، البوت يختار واحدة عشوائي. *كلام بين نجمتين* بيظهر عريض في الواتساب.
            </p>
          </>
        )}

        {(node.nodeType === 'ask_choice' || node.nodeType === 'ask_question') && (
          <div className="field">
            <span className="field-label">السؤال</span>
            <TextWithVars value={d.text} variables={variables} onChange={(text) => set({ text })} rows={3} placeholder="مثلاً: تحب تعمل إيه؟" />
          </div>
        )}

        {node.nodeType === 'ask_choice' && (
          <div className="field" style={{ marginTop: 12 }}>
            <span className="field-label">الاختيارات</span>
            {(d.options || []).map((o, i) => (
              <div key={i} className="opt-row">
                <span className="num">{i + 1}</span>
                <input className="input" value={o} onChange={(e) => set({ options: d.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button className="btn icon ghost danger" disabled={d.options.length <= 1} onClick={() => set({ options: d.options.filter((_, j) => j !== i) })} aria-label="امسح">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {(d.options || []).length < 9 && (
              <button className="btn sm" onClick={() => set({ options: [...(d.options || []), ''] })}>
                <Plus size={13} /> اختيار
              </button>
            )}
            <small className="field-hint">العميل بيرد برقم الاختيار (1، 2 ...) أو بنص الاختيار نفسه. كل اختيار ليه مخرج تحت المربع توصّله بخطوة.</small>
          </div>
        )}

        {node.nodeType === 'ask_question' && (
          <label className="field" style={{ marginTop: 12 }}>
            <span>احفظ الإجابة باسم</span>
            <input className="input" dir="ltr" value={d.saveAs || ''} onChange={(e) => set({ saveAs: e.target.value.replace(/\s+/g, '_') })} placeholder="order_no" />
            <small>تقدر تستخدمها بعد كده في أي رسالة كده: {`{${d.saveAs || 'answer'}}`}</small>
          </label>
        )}

        {(node.nodeType === 'ask_choice' || node.nodeType === 'ask_question') && (
          <label className="field">
            <span>لو ما ردش خلال (دقيقة)</span>
            <input className="input" type="number" min="1" value={d.timeoutMinutes ?? 60} onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })} />
            <small>بعدها يمشي في مخرج «ما ردش» لو متوصل، أو السؤال يتلغي.</small>
          </label>
        )}

        {node.nodeType === 'condition' && (
          <>
            <label className="field">
              <span>يبقى صح لو</span>
              <select className="input" value={d.logic || 'and'} onChange={(e) => set({ logic: e.target.value })}>
                <option value="and">كل القواعد صح</option>
                <option value="or">أي قاعدة منهم صح</option>
              </select>
            </label>
            {(d.rules || []).map((r, i) => {
              const ct = CONDITION_TYPES[r.type] || {};
              const upd = (patch) => set({ rules: d.rules.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="rule">
                  <div className="row-inline">
                    <select className="input" value={r.type} onChange={(e) => upd({ type: e.target.value, value: '' })}>
                      {Object.entries(CONDITION_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn icon ghost danger" disabled={d.rules.length <= 1} onClick={() => set({ rules: d.rules.filter((_, j) => j !== i) })} aria-label="امسح القاعدة">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {ct.input !== 'none' && (
                    <input
                      className="input"
                      style={{ marginTop: 6 }}
                      type={ct.input === 'number' ? 'number' : 'text'}
                      dir={ct.input === 'hours' ? 'ltr' : undefined}
                      value={r.value || ''}
                      placeholder={ct.placeholder}
                      onChange={(e) => upd({ value: e.target.value })}
                    />
                  )}
                </div>
              );
            })}
            <button className="btn sm" onClick={() => set({ rules: [...(d.rules || []), { type: 'message_contains', value: '' }] })}>
              <Plus size={13} /> قاعدة
            </button>
          </>
        )}

        {node.nodeType === 'delay' && (
          <div className="row-inline">
            <input className="input" type="number" min="1" value={d.amount ?? 5} onChange={(e) => set({ amount: Number(e.target.value) })} />
            <select className="input" value={d.unit || 'minutes'} onChange={(e) => set({ unit: e.target.value })}>
              {Object.entries(DELAY_UNITS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}

        {(node.nodeType === 'add_tag' || node.nodeType === 'remove_tag') && (
          <label className="field">
            <span>التصنيف</span>
            <input className="input" value={d.tag || ''} onChange={(e) => set({ tag: e.target.value })} placeholder="مثلاً: مهتم بالخواتم" />
          </label>
        )}

        {node.nodeType === 'handoff' && (
          <>
            <div className="field">
              <span className="field-label">الرسالة للعميل</span>
              <TextWithVars value={d.text} variables={variables} onChange={(text) => set({ text })} rows={4} placeholder="لو سبتها فاضية: رسالة التحويل الافتراضية من الإعدادات" />
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              <span>البوت يسكت كام ساعة؟</span>
              <input className="input" type="number" min="0" value={d.hours ?? 0} onChange={(e) => set({ hours: Number(e.target.value) })} />
              <small>0 = حسب الإعدادات (افتراضي 12 ساعة). وتقدر ترجّعه قبلها من صفحة المحادثات.</small>
            </label>
          </>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--line-2)', margin: '16px 0' }} />
        <button className="btn danger sm" onClick={onDelete}>
          <Trash2 size={13} /> امسح الخطوة دي
        </button>
      </div>
    </>
  );
}
