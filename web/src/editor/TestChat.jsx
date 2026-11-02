// تجربة البوت: محادثة وهمية، ما بتبعتش حاجة لحد على الواتساب
import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Image as ImageIcon } from 'lucide-react';
import { api, newId } from '../api.js';
import { WaText } from '../ui.jsx';

export default function TestChat({ flow = null, height = 380, onAuthError }) {
  const [session] = useState(() => newId('sim'));
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  const reset = async () => {
    setMsgs([]);
    await api('POST', '/api/simulate', { session, reset: true, flow }).catch(onAuthError);
  };
  useEffect(() => {
    reset();
  }, [flow?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs]);

  async function send(t, media = false) {
    if (busy || (!t.trim() && !media)) return;
    setBusy(true);
    setText('');
    setMsgs((m) => [...m, { dir: 'in', text: media ? '📎 (صورة)' : t }]);
    try {
      const r = await api('POST', '/api/simulate', { session, text: media ? '' : t, flow });
      const notes = [];
      if (r.result?.type === 'paused') notes.push('البوت ساكت هنا (العميل متحوّل لموظف). دوس ↺ عشان تبدأ من جديد.');
      else if (!r.messages.length) notes.push('البوت ما ردش على الرسالة دي.');
      if (r.result?.flows?.length) notes.push(`اشتغل: ${r.result.flows.join(' + ')}`);
      setMsgs((m) => [...m, ...r.messages.map((x) => ({ dir: x.dir, text: x.text })), ...notes.map((n) => ({ dir: 'note', text: n }))]);
    } catch (err) {
      onAuthError?.(err);
      setMsgs((m) => [...m, { dir: 'note', text: `❌ ${err.message}` }]);
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div className="chat" ref={box} style={{ minHeight: height, maxHeight: height === 'auto' ? undefined : height + 200 }}>
        {!msgs.length && <div className="bubble note">اكتب رسالة تحت كأنك عميل 👇</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.dir === 'owner' ? 'owner' : m.dir}`}>
            {m.dir === 'owner' && <small style={{ marginTop: 0 }}>🔔 إشعار ليك إنت</small>}
            <WaText text={m.text} />
          </div>
        ))}
      </div>
      <form
        className="send-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <button type="button" className="btn icon" title="ابدأ من جديد" onClick={reset}>
          <RotateCcw size={15} />
        </button>
        <button type="button" className="btn icon" title="ابعت صورة" onClick={() => send('', true)}>
          <ImageIcon size={15} />
        </button>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: الشحن بياخد كام يوم؟" />
        <button className="btn primary" disabled={busy}>
          ابعت
        </button>
      </form>
    </div>
  );
}
