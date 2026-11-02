import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../ui.jsx';

const LABELS = {
  store_name: ['اسم البراند'],
  store_url: ['لينك المتجر', 'مثلاً: https://orma.com'],
  instagram: ['لينك الإنستجرام'],
  shipping_cairo: ['مدة الشحن للقاهرة والجيزة'],
  shipping_governorates: ['مدة الشحن للمحافظات'],
  shipping_fee: ['سعر الشحن'],
  free_shipping: ['الشحن المجاني', 'لو مفيش شحن مجاني اكتب مثلاً: الشحن مش مجاني'],
  return_days: ['مدة الاستبدال والاسترجاع'],
  payment_methods: ['طرق الدفع'],
  working_hours: ['مواعيد خدمة العملاء'],
};

export default function StoreInfo({ onAuthError }) {
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [vars, setVars] = useState(null);

  useEffect(() => {
    api('GET', '/api/settings')
      .then((s) => {
        setSaved(s.variables);
        setVars(s.variables);
      })
      .catch(onAuthError);
  }, [onAuthError]);

  if (!vars) return <div className="page empty">بيحمّل...</div>;
  const dirty = JSON.stringify(vars) !== JSON.stringify(saved);

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>معلومات المتجر</h1>
          <p>المعلومات دي بتتحط جوه الردود تلقائياً. لو حاجة اتغيرت، غيّرها هنا مرة واحدة وكل الردود هتتغير.</p>
        </div>
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={async () => {
            try {
              await api('PUT', '/api/settings', { variables: vars });
              setSaved(vars);
              toast('✅ اتحفظ');
            } catch (err) {
              onAuthError(err);
              toast(err.message, true);
            }
          }}
        >
          <Save size={14} /> حفظ
        </button>
      </div>
      <div className="card">
        {Object.entries(vars).map(([k, v]) => {
          const missing = String(v).includes('⚠️');
          const orig = String(saved[k] ?? '');
          const [label, hint] = LABELS[k] || [k];
          return (
            <label key={k} className="field">
              <span>
                {label} {missing && '⚠️'}
              </span>
              <input
                className={`input${missing ? ' missing' : ''}`}
                value={missing ? '' : v}
                placeholder={missing ? orig.replace('⚠️', '').trim() : ''}
                onChange={(e) => setVars({ ...vars, [k]: e.target.value.trim() ? e.target.value : orig.includes('⚠️') ? orig : '' })}
              />
              <small>
                {hint ? `${hint} — ` : ''}في الرسايل بتتكتب كده: <span dir="ltr">{`{${k}}`}</span>
              </small>
            </label>
          );
        })}
      </div>
    </div>
  );
}
