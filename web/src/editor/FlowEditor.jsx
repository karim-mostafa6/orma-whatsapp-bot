// محرر الـ Flow: نفس فكرة وتصميم شاشة الأتمتة بتاعة المتجر
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, MarkerType, applyNodeChanges, applyEdgeChanges, useReactFlow } from '@xyflow/react';
import { ArrowRight, Undo2, Redo2, CheckCircle2, AlertTriangle, FlaskConical, Save, Pause, Play, X, Loader2 } from 'lucide-react';
import { api, newId } from '../api.js';
import { go, useToast } from '../ui.jsx';
import { NODE_SPECS, NODE_ORDER, newNodeData } from '../../../src/flows/specs.js';
import { validateFlow } from '../../../src/flows/validate.js';
import FlowNode from './FlowNode.jsx';
import NodeConfig from './NodeConfig.jsx';
import TestChat from './TestChat.jsx';

const nodeTypes = { orma: FlowNode };
const edgeDefaults = { markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#8a8a8a' } };

const toRfNode = (n) => ({ id: n.id, type: 'orma', position: n.position || { x: 0, y: 0 }, data: { nodeType: n.type, config: n.data || {} } });
const toRfEdge = (e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle || 'next', target: e.target, ...edgeDefaults });

export default function FlowEditorPage(props) {
  return (
    <ReactFlowProvider>
      <FlowEditor {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditor({ flowId, onAuthError }) {
  const toast = useToast();
  const rf = useReactFlow();
  const wrapper = useRef(null);
  const [meta, setMeta] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [variables, setVariables] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [savedJson, setSavedJson] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [testing, setTesting] = useState(false);
  const history = useRef({ past: [], future: [] });

  // ---------- تحميل ----------
  useEffect(() => {
    Promise.all([api('GET', '/api/flows'), api('GET', '/api/settings')])
      .then(([flows, settings]) => {
        const f = flows.find((x) => x.id === flowId);
        if (!f) return setLoadError('الـ Flow ده مش موجود (يمكن اتمسح).');
        setMeta({ id: f.id, name: f.name, status: f.status, priority: f.priority || 0, description: f.description || '' });
        setNodes(f.nodes.map(toRfNode));
        setEdges(f.edges.map(toRfEdge));
        setVariables(settings.variables || {});
        setSavedJson(JSON.stringify(snapshotFlow(f)));
        setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1 }), 50);
      })
      .catch((err) => {
        onAuthError(err);
        setLoadError(err.message);
      });
  }, [flowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flow = useMemo(
    () =>
      meta && {
        ...meta,
        nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data.config })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle || 'next', target: e.target })),
      },
    [meta, nodes, edges]
  );
  const validation = useMemo(() => (flow ? validateFlow(flow) : { errors: [], warnings: [] }), [flow]);
  const dirty = flow && JSON.stringify(snapshotFlow(flow)) !== savedJson;

  const issueOf = useMemo(() => {
    const m = new Map();
    for (const w of validation.warnings) if (w.nodeId) m.set(w.nodeId, 'warning');
    for (const e of validation.errors) if (e.nodeId) m.set(e.nodeId, 'error');
    return m;
  }, [validation]);
  const shownNodes = useMemo(() => nodes.map((n) => (issueOf.has(n.id) ? { ...n, data: { ...n.data, issue: issueOf.get(n.id) } } : n)), [nodes, issueOf]);

  // ---------- تراجع/إعادة ----------
  const remember = useCallback(() => {
    history.current.past.push({ nodes, edges });
    if (history.current.past.length > 60) history.current.past.shift();
    history.current.future = [];
  }, [nodes, edges]);
  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push({ nodes, edges });
    setNodes(prev.nodes);
    setEdges(prev.edges);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push({ nodes, edges });
    setNodes(next.nodes);
    setEdges(next.edges);
  };

  // ---------- تعديل المساحة ----------
  const onNodesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === 'remove')) remember();
      setNodes((ns) => applyNodeChanges(changes, ns));
    },
    [remember]
  );
  const onEdgesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === 'remove')) remember();
      setEdges((es) => applyEdgeChanges(changes, es));
    },
    [remember]
  );
  const onConnect = useCallback(
    (c) => {
      if (c.source === c.target) return;
      remember();
      // كل مخرج ليه سهم واحد بس: التوصيل الجديد بيبدّل القديم
      setEdges((es) => [...es.filter((e) => !(e.source === c.source && (e.sourceHandle || 'next') === (c.sourceHandle || 'next'))), toRfEdge({ id: newId('e'), ...c })]);
    },
    [remember]
  );

  function addNode(type, position) {
    if (type === 'trigger' && nodes.some((n) => n.data.nodeType === 'trigger')) {
      toast('الـ Flow فيه مُشغّل خلاص، ومينفعش يبقى فيه اتنين.', true);
      return;
    }
    remember();
    let pos = position;
    if (!pos) {
      const b = wrapper.current?.getBoundingClientRect();
      pos = b ? rf.screenToFlowPosition({ x: b.left + b.width / 2 - 115, y: b.top + b.height / 3 }) : { x: 100, y: 100 };
      pos = { x: pos.x + (nodes.length % 4) * 20, y: pos.y + (nodes.length % 4) * 20 };
    }
    const id = newId('n');
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'orma', position: pos, selected: true, data: { nodeType: type, config: newNodeData(type) } }]);
    setSelectedId(id);
  }

  const onDrop = (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/orma-node');
    if (!NODE_SPECS[type]) return;
    addNode(type, rf.screenToFlowPosition({ x: e.clientX - 115, y: e.clientY - 20 }));
  };

  const configTimer = useRef(0);
  function updateConfig(id, config) {
    // نحفظ خطوة "تراجع" واحدة لكل مجموعة كتابة (مش لكل حرف)
    if (Date.now() - configTimer.current > 1500) remember();
    configTimer.current = Date.now();
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n)));
  }

  function deleteNode(id) {
    remember();
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  }

  // ---------- حفظ ----------
  async function save(statusOverride) {
    const toSave = { ...flow, status: statusOverride || flow.status };
    if (toSave.status === 'active' && validation.errors.length) {
      setShowIssues(true);
      toast(statusOverride ? 'صلّح الأخطاء الأول عشان تشغّل الـ Flow' : 'فيه أخطاء، فالـ Flow اتحفظ متوقف لحد ما تصلّحها', true);
      if (statusOverride) return;
      toSave.status = 'paused';
    }
    setSaving(true);
    try {
      const r = await api('POST', '/api/flows/save', { flow: toSave });
      setMeta((m) => ({ ...m, status: r.flow.status }));
      setSavedJson(JSON.stringify(snapshotFlow(r.flow)));
      if (!statusOverride && toSave.status === flow.status) toast('✅ اتحفظ');
      else toast(r.flow.status === 'active' ? '▶️ الـ Flow شغال دلوقتي' : '⏸️ الـ Flow اتوقف');
    } catch (err) {
      onAuthError(err);
      toast(err.message, true);
    }
    setSaving(false);
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (flow) save();
      }
    };
    window.addEventListener('keydown', onKey);
    const warn = (e) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', warn);
    };
  });

  const back = () => {
    if (dirty && !confirm('فيه تعديلات ما اتحفظتش. تخرج من غير حفظ؟')) return;
    go('flows');
  };

  if (loadError)
    return (
      <div className="page narrow">
        <div className="card empty">
          <p>{loadError}</p>
          <button className="btn" onClick={() => go('flows')}>
            رجوع للـ Flows
          </button>
        </div>
      </div>
    );
  if (!meta)
    return (
      <div className="page empty">
        <Loader2 className="spin" size={20} />
      </div>
    );

  const selected = nodes.find((n) => n.id === selectedId);
  const active = meta.status === 'active';

  return (
    <div className="editor">
      <div className="ed-bar">
        <button className="btn icon" onClick={back} aria-label="رجوع">
          <ArrowRight size={16} />
        </button>
        <input className="name" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="اسم الـ Flow" aria-label="اسم الـ Flow" />
        {dirty && <span className="dirty">● مش محفوظ</span>}
        <span className={`pill ${active ? 'ok' : 'off'}`}>{active ? 'شغال' : 'متوقف'}</span>
        <button className="btn icon ghost" onClick={undo} disabled={!history.current.past.length} title="تراجع">
          <Undo2 size={15} />
        </button>
        <button className="btn icon ghost" onClick={redo} disabled={!history.current.future.length} title="إعادة">
          <Redo2 size={15} />
        </button>
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setShowIssues((v) => !v)} style={validation.errors.length ? { color: 'var(--bad)', borderColor: '#f3c1c1' } : undefined}>
            {validation.errors.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} color="#0c6b34" />}
            {validation.errors.length ? `${validation.errors.length} خطأ` : 'سليم'}
            {validation.warnings.length > 0 && <span style={{ color: 'var(--warn)' }}>• {validation.warnings.length} تنبيه</span>}
          </button>
          {showIssues && (validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="issues">
              {[...validation.errors.map((x) => ({ ...x, k: 'err' })), ...validation.warnings.map((x) => ({ ...x, k: 'wrn' }))].map((i, n) => (
                <button
                  key={n}
                  className={i.k}
                  onClick={() => {
                    if (!i.nodeId) return;
                    setSelectedId(i.nodeId);
                    const nd = nodes.find((x) => x.id === i.nodeId);
                    if (nd) rf.setCenter(nd.position.x + 115, nd.position.y + 50, { zoom: 1, duration: 300 });
                    setShowIssues(false);
                  }}
                >
                  {i.k === 'err' ? '⛔' : '⚠️'} {i.text}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn" onClick={() => setTesting(true)}>
          <FlaskConical size={14} /> اختبار
        </button>
        <button className="btn" onClick={() => save()} disabled={saving}>
          <Save size={14} /> حفظ
        </button>
        <button className={`btn ${active ? '' : 'primary'}`} onClick={() => save(active ? 'paused' : 'active')} disabled={saving}>
          {active ? <Pause size={14} /> : <Play size={14} />} {active ? 'إيقاف مؤقت' : 'تشغيل'}
        </button>
      </div>

      <div className="ed-body">
        {selected ? (
          <aside className="ed-config">
            <NodeConfig
              key={selected.id}
              node={{ id: selected.id, nodeType: selected.data.nodeType, config: selected.data.config }}
              variables={variables}
              onChange={(config) => updateConfig(selected.id, config)}
              onDelete={() => deleteNode(selected.id)}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        ) : (
          <aside className="ed-side">
            <h4>اسحب خطوة للمساحة أو اضغط عليها</h4>
            {NODE_ORDER.map((t) => (
              <button
                key={t}
                className="palette-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/orma-node', t);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addNode(t)}
                title={NODE_SPECS[t].description}
              >
                <i style={{ background: NODE_SPECS[t].color }} />
                {NODE_SPECS[t].label}
              </button>
            ))}
            <div style={{ borderTop: '1px solid var(--line-2)', marginTop: 10, paddingTop: 10, width: '100%' }}>
              <label className="field">
                <span style={{ fontSize: 12 }}>وصف</span>
                <textarea className="input" rows={3} style={{ minHeight: 60 }} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="ملاحظة ليك إنت" />
              </label>
              <label className="field" title="لو أكتر من Flow مناسب لنفس الرسالة، الأعلى أولوية هو اللي يشتغل">
                <span style={{ fontSize: 12 }}>الأولوية</span>
                <input className="input" type="number" value={meta.priority} onChange={(e) => setMeta({ ...meta, priority: Number(e.target.value) })} />
                <small>الأكبر يكسب لو أكتر من Flow مناسب لنفس الرسالة.</small>
              </label>
            </div>
          </aside>
        )}

        <div className="ed-canvas" ref={wrapper} dir="ltr" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ReactFlow
            nodes={shownNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => {
              setSelectedId(null);
              setShowIssues(false);
            }}
            onNodeDragStart={remember}
            onNodesDelete={(ds) => ds.some((d) => d.id === selectedId) && setSelectedId(null)}
            deleteKeyCode={['Delete', 'Backspace']}
            defaultEdgeOptions={edgeDefaults}
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d4d4d4" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" style={{ width: 140, height: 90 }} nodeColor={(n) => NODE_SPECS[n.data.nodeType]?.color || '#999'} />
          </ReactFlow>
        </div>
      </div>

      {testing && (
        <div className="drawer-bg" onClick={() => setTesting(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <h3>اختبار «{meta.name}»</h3>
                <small className="muted">بيجرّب آخر تعديلاتك حتى لو ما اتحفظتش. ما بيبعتش حاجة لحد.</small>
              </div>
              <button className="btn icon" onClick={() => setTesting(false)} aria-label="قفل">
                <X size={16} />
              </button>
            </div>
            <TestChat flow={flow} height={420} onAuthError={onAuthError} />
          </div>
        </div>
      )}
    </div>
  );
}

function snapshotFlow(f) {
  return {
    name: f.name,
    priority: Number(f.priority) || 0,
    description: f.description || '',
    nodes: f.nodes.map((n) => ({ id: n.id, type: n.type, x: Math.round(n.position?.x || 0), y: Math.round(n.position?.y || 0), data: n.data })),
    edges: f.edges.map((e) => ({ s: e.source, h: e.sourceHandle || 'next', t: e.target })).sort((a, b) => `${a.s}${a.h}`.localeCompare(`${b.s}${b.h}`)),
  };
}
