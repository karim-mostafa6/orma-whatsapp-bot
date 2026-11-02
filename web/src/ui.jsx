// عناصر صغيرة مشتركة
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((msg, bad = false) => setT({ msg, bad, id: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), 3500);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast${t.bad ? ' bad' : ''}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

/** تنسيق واتساب: *عريض* و _مايل_ */
export function WaText({ text }) {
  const parts = String(text || '').split(/(\*[^*\n]+\*|_[^_\n]+_)/);
  return parts.map((p, i) =>
    /^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : /^_[^_\n]+_$/.test(p) ? <i key={i}>{p.slice(1, -1)}</i> : <React.Fragment key={i}>{p}</React.Fragment>
  );
}

export function useHashRoute() {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || 'home').split('/');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path) => {
  window.location.hash = `/${path}`;
};
