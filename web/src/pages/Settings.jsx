import React, { useEffect, useState } from 'react';
import { Save, LogOut, Unlink } from 'lucide-react';
import { api } from '../api.js';
import { Switch, useToast } from '../ui.jsx';

export default function SettingsPage({ status, onAuthError }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState('');
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    api('GET', '/api/settings')
      .then((x) => {
        setS(x);
        setSaved(JSON.stringify(x));
      })
      .catch(onAuthError);
    api('GET', '/api/me').then((m) => setAuthRequired(m.authRequired)).catch(() => {});
  }, [onAuthError]);

  if (!s) return <div className="page empty">بيحمّل...</div>;
  const b = s.behavior;
  const setB = (patch) => setS({ ...s, behavior: { ...b, ...patch } });
  const setT = (patch) => setS({ ...s, texts: { ...s.texts, ...patch } });
  const dirty = JSON.stringify(s) !== saved;

  const num = (label, key, hint, scale = 1) => (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="number" min="0" step={scale === 1000 ? 0.5 : 1} value={b[key] / scale} onChange={(e) => setB({ [key]: Number(e.target.value) * scale })} />
      {hint && <small>{hint}</small>}
    </label>
  );
  const toggle = (label, key) => (
    <label className="row-inline" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <Switch checked={b[key]} onChange={(v) => setB({ [key]: v })} label={label} />
    </label>
  );

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>الإعدادات</h1>
          <p>طريقة رد البوت ورسايله الثابتة.</p>
        </div>
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={async () => {
            try {
              const r = await api('PUT', '/api/settings', { behavior: s.behavior, texts: s.texts });
              setS(r.settings);
              setSaved(JSON.stringify(r.settings));
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
        <h2>⏱️ طريقة الرد</h2>
        <p className="hint">قبل كل رد البوت بيظهر «بيكتب...» ويستنى وقت عشوائي بين الرقمين دول، عشان الرد يبان طبيعي.</p>
        <div className="grid2" style={{ gap: 12 }}>
          {num('أقل وقت قبل الرد (ثانية)', 'minDelayMs', null, 1000)}
          {num('أكتر وقت قبل الرد (ثانية)', 'maxDelayMs', null, 1000)}
        </div>
        {num('أقصى عدد ردود لنفس العميل في الدقيقة', 'maxRepliesPerMinute', 'حماية من السبام ومن حظر الرقم.')}
        {toggle('يعلّم رسالة العميل «مقروءة» قبل الرد', 'markAsRead')}
      </div>

      <div className="card">
        <h2>👤 التحويل لموظف</h2>
        {num('البوت يسكت كام ساعة بعد التحويل لموظف', 'handoffHours', 'بعدها يرجع يرد لوحده. 0 = لحد ما ترجّعه بنفسك.')}
        {num('لو رديت بنفسك، البوت يسكت كام ساعة', 'ownerReplyPauseHours', '0 = البوت يكمّل يرد حتى لو إنت رديت.')}
        {toggle('ابعتلي إشعار على الواتساب لما عميل يتحوّل لموظف', 'notifyOwner')}
        {toggle('امسح أوامر #bot و #stop من المحادثة بعد ما تتنفذ', 'deleteOwnerCommands')}
      </div>

      <div className="card">
        <h2>💬 رسايل ثابتة</h2>
        <label className="field">
          <span>رسالة التحويل لموظف (الافتراضية)</span>
          <textarea className="input" value={s.texts.handoff} onChange={(e) => setT({ handoff: e.target.value })} />
        </label>
        <label className="field">
          <span>لما العميل يرد على سؤال باختيارات برد مش مفهوم</span>
          <textarea className="input" rows={2} style={{ minHeight: 50 }} value={s.texts.invalidChoice} onChange={(e) => setT({ invalidChoice: e.target.value })} />
        </label>
        <label className="field">
          <span>الإشعار اللي بيوصلك إنت</span>
          <textarea className="input" value={s.texts.ownerNotify} onChange={(e) => setT({ ownerNotify: e.target.value })} />
          <small>{'{reason}'} = السبب، {'{customer}'} = اسم العميل ورقمه، {'{message}'} = رسالته</small>
        </label>
      </div>

      <div className="card">
        <h2>🔐 الحساب</h2>
        <div className="row-inline" style={{ flexWrap: 'wrap' }}>
          {status?.connection === 'open' && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm('متأكد؟ البوت هيبطّل يرد لحد ما تربط الرقم تاني.')) return;
                await api('POST', '/api/whatsapp/logout', {}).catch((e) => toast(e.message, true));
                toast('تم فك ربط الرقم');
              }}
            >
              <Unlink size={14} /> فك ربط رقم الواتساب
            </button>
          )}
          {authRequired && (
            <button
              className="btn"
              onClick={async () => {
                await api('POST', '/api/logout-session', {}).catch(() => {});
                window.location.reload();
              }}
            >
              <LogOut size={14} /> خروج من الصفحة
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
