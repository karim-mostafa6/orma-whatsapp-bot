import React, { useEffect, useRef, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import { api, fmtTime, reasonLabel } from '../api.js';
import { useToast, go, WaText } from '../ui.jsx';

export default function Inbox({ selected, onAuthError }) {
  const toast = useToast();
  const [contacts, setContacts] = useState(null);
  const [q, setQ] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [detail, setDetail] = useState(null);
  const chat = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () => api('GET', '/api/contacts').then((c) => alive && setContacts(c)).catch(onAuthError);
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onAuthError]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    let alive = true;
    const load = () =>
      api('GET', `/api/contact?jid=${encodeURIComponent(selected)}`)
        .then((d) => alive && setDetail(d))
        .catch((err) => {
          onAuthError(err);
          if (alive) setDetail({ error: err.message });
        });
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [selected, onAuthError]);

  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [detail?.messages?.length]);

  const filtered = (contacts || []).filter(
    (c) => (!onlyWaiting || c.paused) && (!q || `${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase()))
  );

  async function act(path, msg) {
    try {
      await api('POST', path, { jid: selected });
      toast(msg);
      const d = await api('GET', `/api/contact?jid=${encodeURIComponent(selected)}`);
      setDetail(d);
    } catch (err) {
      onAuthError(err);
      toast(err.message, true);
    }
  }

  return (
    <div className="page">
      <div className="inbox">
        <div className="card">
          <div className="row-inline" style={{ marginBottom: 8 }}>
            <Search size={15} className="muted" />
            <input className="input" placeholder="دوّر باسم أو رقم" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="row-inline" style={{ fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} /> المستنيين موظف بس
          </label>
          <div className="contact-list">
            {!contacts && <div className="empty">بيحمّل...</div>}
            {contacts && !filtered.length && <div className="empty">مفيش محادثات لسه</div>}
            {filtered.map((c) => (
              <div key={c.jid} className={`contact${c.jid === selected ? ' active' : ''}`} onClick={() => go(`inbox/${encodeURIComponent(c.jid)}`)}>
                <b>
                  <span>{c.name || (c.phone ? `+${c.phone}` : 'عميل')}</span>
                  {c.paused ? <span className="pill warn">محتاج موظف</span> : <small>{fmtTime(c.lastInboundAt)}</small>}
                </b>
                <small>
                  {c.lastMessage ? `${c.lastMessage.dir === 'in' ? '' : c.lastMessage.dir === 'owner' ? 'إنت: ' : '🤖 '}${c.lastMessage.text}` : ''}
                </small>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          {!selected ? (
            <div className="empty" style={{ margin: 'auto' }}>
              اختار محادثة من القايمة
            </div>
          ) : !detail ? (
            <div className="empty">بيحمّل...</div>
          ) : detail.error ? (
            <div className="empty">{detail.error}</div>
          ) : (
            <>
              <div className="row-inline" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <b style={{ fontSize: 15 }}>{detail.name || 'عميل'}</b>{' '}
                  {detail.phone && (
                    <a className="muted" style={{ fontSize: 12 }} href={`https://wa.me/${detail.phone}`} target="_blank" rel="noreferrer">
                      +{detail.phone} <ExternalLink size={11} />
                    </a>
                  )}
                  <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {detail.paused ? (
                      <span className="pill warn">
                        البوت ساكت: {reasonLabel(detail.paused.reason)}
                        {detail.paused.until ? ` — يرجع ${fmtTime(detail.paused.until)}` : ''}
                      </span>
                    ) : (
                      <span className="pill ok">البوت بيرد</span>
                    )}
                    {(detail.tags || []).map((t) => (
                      <span key={t} className="pill info">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                {detail.paused ? (
                  <button className="btn primary" onClick={() => act('/api/contacts/resume', 'البوت رجع يرد على العميل ده 🤖')}>
                    🤖 رجّع البوت
                  </button>
                ) : (
                  <button className="btn" onClick={() => act('/api/contacts/pause', 'البوت سكت في المحادثة دي لحد ما ترجّعه')}>
                    ✋ أنا هرد بنفسي
                  </button>
                )}
              </div>
              <div className="chat" ref={chat}>
                {(detail.messages || []).map((m, i) => (
                  <div key={i} className={`bubble ${m.dir}`}>
                    <WaText text={m.text} />
                    <small>
                      {m.dir === 'out' ? '🤖 البوت · ' : m.dir === 'owner' ? 'إنت · ' : ''}
                      {fmtTime(m.at)}
                    </small>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                عشان ترد بنفسك، رد من الواتساب على موبايلك عادي. البوت بيلاحظ ويسكت في المحادثة دي لوحده.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
