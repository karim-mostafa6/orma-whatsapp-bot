import React, { useCallback, useEffect, useState } from 'react';
import { Home, Workflow, MessagesSquare, Store, Settings as SettingsIcon } from 'lucide-react';
import { api, AuthError } from './api.js';
import { ToastProvider, useHashRoute } from './ui.jsx';
import Login from './pages/Login.jsx';
import HomePage from './pages/Home.jsx';
import FlowsPage from './pages/Flows.jsx';
import FlowEditor from './editor/FlowEditor.jsx';
import Inbox from './pages/Inbox.jsx';
import StoreInfo from './pages/StoreInfo.jsx';
import SettingsPage from './pages/Settings.jsx';

const TABS = [
  { id: 'home', label: 'الرئيسية', icon: Home },
  { id: 'flows', label: 'الأتمتة (Flows)', icon: Workflow },
  { id: 'inbox', label: 'المحادثات', icon: MessagesSquare },
  { id: 'store', label: 'معلومات المتجر', icon: Store },
  { id: 'settings', label: 'الإعدادات', icon: SettingsIcon },
];

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const route = useHashRoute();
  const [auth, setAuth] = useState('checking'); // checking | in | out
  const [status, setStatus] = useState(null);

  const onAuthError = useCallback((err) => {
    if (err instanceof AuthError) setAuth('out');
  }, []);

  useEffect(() => {
    api('GET', '/api/me')
      .then(() => setAuth('in'))
      .catch((err) => setAuth(err instanceof AuthError ? 'out' : 'in'));
  }, []);

  useEffect(() => {
    if (auth !== 'in') return;
    let alive = true;
    const load = () =>
      api('GET', '/api/status')
        .then((s) => alive && setStatus(s))
        .catch((err) => {
          onAuthError(err);
          if (alive && !(err instanceof AuthError)) setStatus((s) => (s ? { ...s, offline: true } : { offline: true }));
        });
    load();
    const id = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [auth, onAuthError]);

  if (auth === 'checking') return null;
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;

  const [page, sub] = route;
  const editing = page === 'flows' && sub;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <b>ORMA</b>
            <span>بوت الواتساب</span>
          </div>
          <nav className="tabs">
            {TABS.map((t) => (
              <a key={t.id} href={`#/${t.id}`} className={page === t.id ? 'active' : ''}>
                <t.icon size={15} />
                {t.label}
                {t.id === 'inbox' && status?.waiting > 0 && <span className="badge">{status.waiting}</span>}
              </a>
            ))}
          </nav>
          <div className={`conn-pill${status?.connection === 'open' ? ' ok' : ''}`}>
            <i />
            {status?.offline ? 'البوت مش شغال' : status?.connection === 'open' ? 'متصل' : status?.connection === 'qr' ? 'مستني QR' : 'بيتصل...'}
          </div>
        </div>
      </header>
      {status?.offline && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <div className="banner bad">⚠️ الصفحة مش قادرة توصل للبوت. لو على الكمبيوتر: اتأكد إن الشباك الأسود مفتوح.</div>
        </div>
      )}
      {editing ? (
        <FlowEditor flowId={sub} onAuthError={onAuthError} />
      ) : page === 'flows' ? (
        <FlowsPage onAuthError={onAuthError} />
      ) : page === 'inbox' ? (
        <Inbox selected={sub ? decodeURIComponent(sub) : null} onAuthError={onAuthError} />
      ) : page === 'store' ? (
        <StoreInfo onAuthError={onAuthError} />
      ) : page === 'settings' ? (
        <SettingsPage status={status} onAuthError={onAuthError} />
      ) : (
        <HomePage status={status} onAuthError={onAuthError} />
      )}
    </>
  );
}
