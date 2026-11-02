import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await api('POST', '/api/login', { password: pw });
            onDone();
          } catch (x) {
            setErr(x.message);
          }
          setBusy(false);
        }}
      >
        <h1>ORMA</h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>لوحة تحكم بوت الواتساب</p>
        <label className="field">
          <span>الباسورد</span>
          <input className="input" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <div className="banner bad">{err}</div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !pw}>
          دخول
        </button>
      </form>
    </div>
  );
}
