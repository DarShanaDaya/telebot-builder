import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { NODE_DEFS, summarize } from '../builder/nodeDefs';

// One custom renderer for every node type; visuals + dynamic handles are
// driven by NODE_DEFS and the node's own data.

const HANDLE_OFFSET = 34; // px from node top for the first dynamic handle
const ROW_HEIGHT = 26;

function ButtonsHandles({ buttons }) {
  const items = (buttons || []).filter((b) => b && b.label);
  return (
    <div className="tb-btn-list">
      {items.map((b, i) => (
        <div className="tb-btn-row" key={b.id}>
          <span className="tb-btn-chip" title={b.url ? `Link: ${b.url}` : ''}>
            {b.url && b.url.trim() ? '🔗' : '▸'} {b.label}
          </span>
          {!b.url?.trim() && (
            <Handle
              type="source"
              position={Position.Right}
              id={`btn-${b.id}`}
              style={{ top: HANDLE_OFFSET + 28 + i * ROW_HEIGHT }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function TbNode({ id, type, data, selected }) {
  // The actual node type is stored in data.nodeType (e.g., 'start', 'message', 'buttons', etc.)
  // while `type` is the React Flow custom node type ('tb')
  const nodeType = data?.nodeType || 'unknown';
  const def = NODE_DEFS[nodeType] || { label: nodeType, icon: '❓', color: '#666' };
  const isStart = nodeType === 'start';
  const showOut = !['end', 'buttons'].includes(nodeType);
  const dualOut = nodeType === 'http' || nodeType === 'ai';

  return (
    <div className={`tb-node ${selected ? 'selected' : ''}`} style={{ '--node-color': def.color }}>
      {!isStart && <Handle type="target" position={Position.Left} />}
      <div className="tb-node-head">
        <span className="tb-node-icon">{def.icon}</span>
        <span className="tb-node-title">{def.label}</span>
      </div>
      <div className="tb-node-summary">{summarize({ type: nodeType, data })}</div>
      {nodeType === 'buttons' && <ButtonsHandles buttons={data?.buttons} />}
      {nodeType === 'condition' && (
        <div className="tb-dual">
          <div className="tb-dual-row">
            <span className="tb-tag true">true</span>
            <Handle type="source" position={Position.Right} id="true" style={{ top: HANDLE_OFFSET + 28 }} />
          </div>
          <div className="tb-dual-row">
            <span className="tb-tag false">false</span>
            <Handle type="source" position={Position.Right} id="false" style={{ top: HANDLE_OFFSET + 28 + ROW_HEIGHT }} />
          </div>
        </div>
      )}
      {dualOut && (
        <div className="tb-dual">
          <div className="tb-dual-row">
            <span className="tb-tag true">{nodeType === 'http' ? '✓ ok' : 'out'}</span>
            <Handle type="source" position={Position.Right} id={nodeType === 'http' ? 'success' : 'out'} style={{ top: HANDLE_OFFSET + 28 }} />
          </div>
          <div className="tb-dual-row">
            <span className="tb-tag false">✗ error</span>
            <Handle type="source" position={Position.Right} id="error" style={{ top: HANDLE_OFFSET + 28 + ROW_HEIGHT }} />
          </div>
        </div>
      )}
      {nodeType === 'input' && (
        <div className="tb-dual">
          <div className="tb-dual-row">
            <span className="tb-tag true">answered</span>
            <Handle type="source" position={Position.Right} id="out" style={{ top: HANDLE_OFFSET + 28 }} />
          </div>
          <div className="tb-dual-row">
            <span className="tb-tag false">/cancel</span>
            <Handle type="source" position={Position.Right} id="cancel" style={{ top: HANDLE_OFFSET + 28 + ROW_HEIGHT }} />
          </div>
        </div>
      )}
      {showOut && !dualOut && nodeType !== 'input' && <Handle type="source" position={Position.Right} id="out" />}
    </div>
  );
}

export default memo(TbNode);
