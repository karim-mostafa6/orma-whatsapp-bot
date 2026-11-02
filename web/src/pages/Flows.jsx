import React, { useEffect, useState } from 'react';
import { Plus, Copy, Trash2, Pencil } from 'lucide-react';
import { api, newId, fmtTime } from '../api.js';
import { Switch, useToast, go } from '../ui.jsx';
import { nodeSummary, TRIGGER_EVENTS } from '../../../src/flows/specs.js';
import { validateFlow } from '../../../src/flows/validate.js';

function triggerText(f) {
  const t = f.nodes.find((n) => n.type === 'trigger');
  if (!t) return 'من غير مُشغّل';
  return t.data?.event === 'keywords' ? nodeSummary('trigger', t.data) : TRIGGER_EVENTS[t.data?.event] || '';
}

export default function FlowsPage({ onAuthError }) {
  const toast = useToast();
  const [flows, setFlows] = useState(null);

  const load = () =>
    api('GET', '/api/flows')
      .then(setFlows)
      .catch((err) => {
        onAuthError(err);
        toast(err.message, true);
      });
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    const tId = newId('n');
    const mId = newId('n');
    const flow = {
      id: newId('flow'),
      name: 'Flow جديد',
      status: 'paused',
      priority: 0,
      description: '',
      nodes: [
        { id: tId, type: 'trigger', position: { x: 250, y: 0 }, data: { event: 'keywords', keywords: [], onlyIfAlone: false } },
        { id: mId, type: 'send_message', position: { x: 250, y: 170 }, data: { texts: [''] } },
      ],
      edges: [{ id: newId('e'), source: tId, sourceHandle: 'next', target: mId }],
    };
    try {
      await api('POST', '/api/flows/save', { flow });
      go(`flows/${flow.id}`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function duplicate(f) {
    const copy = { ...JSON.parse(JSON.stringify(f)), id: newId('flow'), name: `${f.name} (نسخة)`, status: 'paused' };
    await api('POST', '/api/flows/save', { flow: copy }).catch((e) => toast(e.message, true));
    toast('اتعملت نسخة (متوقفة)');
    load();
  }

  async function remove(f) {
    if (!confirm(`تمسح «${f.name}» نهائياً؟`)) return;
    await api('POST', '/api/flows/delete', { id: f.id }).catch((e) => toast(e.message, true));
    load();
  }

  async function toggle(f, on) {
    try {
      await api('POST', '/api/flows/status', { id: f.id, status: on ? 'active' : 'paused' });
      setFlows((fs) => fs.map((x) => (x.id === f.id ? { ...x, status: on ? 'active' : 'paused' } : x)));
    } catch (err) {
      toast(err.message, true);
    }
  }

  const sorted = (flows || []).slice().sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, 'ar'));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>الأتمتة (Flows)</h1>
          <p>كل Flow بيبدأ لما العميل يكتب كلمات معيّنة، وبعدين يمشي في الخطوات اللي إنت راسمها.</p>
        </div>
        <button className="btn primary" onClick={create}>
          <Plus size={15} /> Flow جديد
        </button>
      </div>

      <div className="card table-card">
        {!flows ? (
          <div className="empty">بيحمّل...</div>
        ) : !flows.length ? (
          <div className="empty">مفيش Flows لسه. دوس «Flow جديد».</div>
        ) : (
          <table className="flow-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>شغال</th>
                <th>الاسم</th>
                <th className="hide-sm" style={{ width: 90 }}>الخطوات</th>
                <th className="hide-sm" style={{ width: 150 }}>آخر تعديل</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => {
                const v = validateFlow(f);
                return (
                  <tr key={f.id}>
                    <td>
                      <Switch checked={f.status === 'active'} onChange={(on) => toggle(f, on)} label="تشغيل" />
                    </td>
                    <td>
                      <div className="flow-name" onClick={() => go(`flows/${f.id}`)}>
                        {f.name}{' '}
                        {v.errors.length > 0 && <span className="pill bad">{v.errors.length} خطأ</span>}
                        {f.priority > 0 && <span className="pill info">أولوية {f.priority}</span>}
                      </div>
                      <div className="flow-sub">{triggerText(f)}</div>
                    </td>
                    <td className="hide-sm muted">{f.nodes.length}</td>
                    <td className="hide-sm muted">{fmtTime(f.updatedAt || f.createdAt)}</td>
                    <td>
                      <div className="row-inline" style={{ justifyContent: 'flex-end', gap: 2 }}>
                        <button className="btn icon ghost" title="تعديل" onClick={() => go(`flows/${f.id}`)}>
                          <Pencil size={15} />
                        </button>
                        <button className="btn icon ghost" title="نسخة" onClick={() => duplicate(f)}>
                          <Copy size={15} />
                        </button>
                        <button className="btn icon ghost danger" title="مسح" onClick={() => remove(f)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
