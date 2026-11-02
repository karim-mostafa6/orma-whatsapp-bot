// شكل المربع (الخطوة) على المساحة — نفس تصميم شاشة الأتمتة بتاعة المتجر
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { NODE_SPECS, nodeOutputs, nodeSummary } from '../../../src/flows/specs.js';

function FlowNode({ data, selected }) {
  const spec = NODE_SPECS[data.nodeType] || { label: data.nodeType, english: '', color: '#999' };
  const outs = nodeOutputs(data.nodeType, data.config);
  const text = nodeSummary(data.nodeType, data.config);
  const cls = ['fnode', outs.length > 3 ? 'wide' : '', data.issue ? `issue-${data.issue}` : selected ? 'selected' : ''].join(' ');

  return (
    <div className={cls}>
      {data.nodeType !== 'trigger' && <Handle type="target" position={Position.Top} className="h-target" />}
      <div className="fnode-head" style={{ background: spec.color }}>
        <span>{spec.label}</span>
        <small>{spec.english}</small>
      </div>
      <div className="fnode-body">
        <div className="clamp">{text || <span className="placeholder">اضغط للإعداد…</span>}</div>
      </div>
      {outs.length > 0 && (
        <div className="fnode-outs">
          {outs.map((o) => (
            <div key={o.id} className="fnode-out" title={o.label}>
              <span>{o.label}</span>
              <Handle id={o.id} type="source" position={Position.Bottom} className="h-source" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(FlowNode);
