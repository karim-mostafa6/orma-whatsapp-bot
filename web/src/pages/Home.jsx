import React, { useEffect, useState } from 'react';
import { api, fmtTime, reasonLabel } from '../api.js';
import { Switch, useToast, go } from '../ui.jsx';
import TestChat from '../editor/TestChat.jsx';

export default function HomePage({ status, onAuthError }) {
  const toast = useToast();
  const [waiting, setWaiting] = useState([]);
  const [log, setLog] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api('GET', '/api/contacts').then((cs) => alive && setWaiting(cs.filter((c) => c.paused).slice(0, 6))).catch(onAuthError);
      api('GET', '/api/activity').then((a) => alive && setLog(a)).catch(onAuthError);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onAuthError]);

  const s = status || {};
  const connected = s.connection === 'open';

  return (
    <div className="page">
      {s.missing?.length > 0 && (
        <div className="banner warn">
          ⚠️ لسه فيه معلومات ناقصة عن المتجر (زي الشحن والدفع)، والعملاء هيشوفوا علامة ⚠️ في الردود.
          <button className="btn sm" onClick={() => go('store')}>اكتبها دلوقتي</button>
        </div>
      )}

      <div className="card">
        <div className="status-line">
          <span className={`status-dot${connected ? ' ok' : ''}`} />
          <div>
            <b style={{ fontSize: 16 }}>{connected ? 'متصل بالواتساب ✅' : s.connection === 'qr' ? 'اربط رقم الواتساب' : 'بيتصل بالواتساب...'}</b>
            <div className="muted" style={{ fontSize: 13 }}>
              {connected ? `الرقم +${s.me || ''} — البوت بيرد على العملاء دلوقتي` : s.connection === 'qr' ? 'امسح الكود ده من موبايلك (مرة واحدة بس)' : 'لحظات... اتأكد إن النت شغال'}
            </div>
          </div>
        </div>
        {s.qr && (
          <div className="qr-wrap">
            <img src={s.qr} alt="QR" />
            <ol>
              <li>افتح واتساب على موبايلك</li>
              <li>
                اضغط <b>⋮</b> أو <b>الإعدادات</b> ← <b>الأجهزة المرتبطة</b>
              </li>
              <li>
                اضغط <b>ربط جهاز</b> ووجّه الكاميرا على المربع
              </li>
              <li className="muted">الكود بيتغير كل شوية لوحده، ده طبيعي.</li>
            </ol>
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="row-inline" style={{ justifyContent: 'space-between' }}>
            <div>
              <b>{s.globalPaused ? 'متوقف ⏸️' : 'شغال ▶️'}</b>
              <span>البوت لكل العملاء</span>
            </div>
            <Switch
              checked={!s.globalPaused}
              label="تشغيل البوت"
              onChange={async (on) => {
                try {
                  await api('POST', '/api/bot', { paused: !on });
                  toast(on ? 'البوت رجع يشتغل ▶️' : 'البوت اتوقف ⏸️');
                } catch (err) {
                  onAuthError(err);
                  toast(err.message, true);
                }
              }}
            />
          </div>
        </div>
        <div className="stat" style={{ cursor: 'pointer' }} onClick={() => go('flows')}>
          <b>
            {s.flows?.active ?? '–'} <small className="muted" style={{ fontSize: 13 }}>من {s.flows?.total ?? '–'}</small>
          </b>
          <span>Flows شغالة</span>
        </div>
        <div className="stat" style={{ cursor: 'pointer' }} onClick={() => go('inbox')}>
          <b style={{ color: s.waiting ? 'var(--warn)' : undefined }}>{s.waiting ?? 0}</b>
          <span>عملاء مستنيين موظف</span>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>👤 عملاء محتاجين موظف</h2>
          <p className="hint">البوت ساكت في المحادثات دي. رد إنت من موبايلك، ولما تخلّص رجّع البوت.</p>
          {!waiting.length && <div className="empty">مفيش حد مستني دلوقتي 👌</div>}
          {waiting.map((c) => (
            <div key={c.jid} className="list-row">
              <div style={{ cursor: 'pointer' }} onClick={() => go(`inbox/${encodeURIComponent(c.jid)}`)}>
                <b>{c.name || c.phone || c.jid}</b>
                <small>
                  {reasonLabel(c.paused.reason)} — {fmtTime(c.paused.since)}
                </small>
              </div>
              <button
                className="btn sm"
                onClick={async () => {
                  await api('POST', '/api/contacts/resume', { jid: c.jid }).catch(onAuthError);
                  setWaiting((w) => w.filter((x) => x.jid !== c.jid));
                  toast('البوت رجع يرد على العميل ده 🤖');
                }}
              >
                🤖 رجّع البوت
              </button>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>🧪 جرّب البوت</h2>
          <p className="hint">اكتب كأنك عميل وشوف البوت هيرد بإيه (بكل الـ Flows الشغالة). ما بيبعتش حاجة لحد.</p>
          <TestChat height={300} onAuthError={onAuthError} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>📋 آخر الأحداث</h2>
        <div className="log">
          {!log.length && <div className="empty">لسه مفيش أحداث</div>}
          {log.slice(0, 60).map((i, n) => (
            <div key={n} className={i.level}>
              <time>{fmtTime(i.time)}</time>
              {i.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
