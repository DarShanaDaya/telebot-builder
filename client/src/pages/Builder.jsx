import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import { api, apiError } from '../api';
import { NODE_DEFS, PALETTE, defaultData } from '../builder/nodeDefs';
import TbNode from '../builder/TbNode';
import PropertiesPanel from '../builder/PropertiesPanel';

const nodeTypes = { tb: TbNode };

const edgeStyle = {
  type: 'smoothstep',
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#8ea2c0' },
  style: { stroke: '#8ea2c0', strokeWidth: 1.6 },
};

// Stored payloads keep only stable fields.
const toStored = (nodes, edges, viewport) => JSON.parse(JSON.stringify({
  nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, position: n.position, data: n.data })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
  viewport,
}));

const fromStored = (flow) => ({
  nodes: (flow?.nodes || []).map((n) => ({ ...n, type: 'tb', data: { ...n.data, nodeType: n.type } })),
  edges: (flow?.edges || []).map((e) => ({ ...edgeStyle, ...e })),
  viewport: flow?.viewport,
});

let idCounter = 1;
const newId = () => `n${Date.now().toString(36)}_${idCounter++}`;

export default function Builder() {
  const { botId } = useParams();
  const wrapperRef = useRef(null);
  const [rfInstance, setRfInstance] = useState(null);
  const [bot, setBot] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [credentials, setCredentials] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState('');
  const [deployOpen, setDeployOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const viewportRef = useRef(null);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    Promise.all([api.get(`/bots/${botId}`), api.get(`/bots/${botId}/flow`), api.get('/credentials')])
      .then(([botRes, flowRes, credRes]) => {
        setBot(botRes.data.bot);
        setCredentials(credRes.data.credentials);
        const flow = flowRes.data.draft || flowRes.data.published || { nodes: [{ id: 'start-1', type: 'start', position: { x: 80, y: 140 }, data: {} }], edges: [] };
        let { nodes: n, edges: e, viewport } = fromStored(flow);
        // Resolve multiple-start bug: keep only the first Start node found
        const startNodes = n.filter((nn) => nn.data?.nodeType === 'start');
        if (startNodes.length > 1) {
          const keepId = startNodes[0].id;
          n = n.filter((nn) => nn.data?.nodeType !== 'start' || nn.id === keepId);
          // also prune edges to removed starts
          const removed = startNodes.slice(1).map((s) => s.id);
          e = e.filter((ee) => !removed.includes(ee.source) && !removed.includes(ee.target));
        }
        setNodes(n);
        setEdges(e);
        viewportRef.current = viewport || null;
        setLoaded(true);
      })
      .catch((err) => showToast(apiError(err, 'Failed to load bot'), 'error'));
  }, [botId]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDirty = () => setDirty(true);

  const handleNodesChange = useCallback((changes) => {
    if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) markDirty();
    onNodesChange(changes);
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes) => {
    if (changes.some((c) => c.type !== 'select')) markDirty();
    onEdgesChange(changes);
  }, [onEdgesChange]);

  const onConnect = useCallback((params) => {
    markDirty();
    setEdges((eds) => addEdge({ ...edgeStyle, ...params }, eds));
  }, [setEdges]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('application/telebot-node');
    if (!nodeType || !rfInstance) return;
    const bounds = wrapperRef.current.getBoundingClientRect();
    const position = rfInstance.project({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    if (nodeType === 'start') {
      const existingStart = nodes.find((n) => n.data.nodeType === 'start');
      if (existingStart) {
        // Prevent multiple starts: select the existing one instead
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === existingStart.id })));
        return;
      }
    } else if (!nodes.some((n) => n.data.nodeType === 'start')) {
      // Auto-seed a Start node so flows are always runnable.
      setNodes((ns) => ns.concat({ id: 'start-1', type: 'tb', position: { x: position.x - 260, y: position.y }, data: { nodeType: 'start' } }));
    }
    const node = { id: newId(), type: 'tb', position, selected: true, data: { ...defaultData(nodeType), nodeType } };
    markDirty();
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })).concat(node));
  }, [rfInstance, nodes, setNodes]);

  const addNodeAtViewport = (nodeType) => {
    if (!rfInstance) return;
    const bounds = wrapperRef.current.getBoundingClientRect();
    const center = rfInstance.project({ x: bounds.width / 2 - 320, y: bounds.height / 2 });
    const jitter = (Math.random() - 0.5) * 60;
    if (nodeType === 'start') {
      const existingStart = nodes.find((n) => n.data.nodeType === 'start');
      if (existingStart) {
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === existingStart.id })));
        return;
      }
    } else if (!nodes.some((n) => n.data.nodeType === 'start')) {
      setNodes((ns) => ns.concat({ id: 'start-1', type: 'tb', position: { x: center.x - 280, y: center.y }, data: { nodeType: 'start' } }));
    }
    const node = { id: newId(), type: 'tb', position: { x: center.x + jitter, y: center.y + jitter }, selected: true, data: { ...defaultData(nodeType), nodeType } };
    markDirty();
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })).concat(node));
  };

  const selectedNode = useMemo(() => nodes.find((n) => n.selected) || null, [nodes]);
  const selectedId = selectedNode?.id || null;

  const updateData = useCallback((data) => {
    markDirty();
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data } : n)));
  }, [selectedId, setNodes]);

  const deleteNode = useCallback((node) => {
    markDirty();
    setEdges((eds) => eds.filter((e) => e.source !== node.id && e.target !== node.id));
    setNodes((ns) => ns.filter((n) => n.id !== node.id));
  }, [setNodes, setEdges]);

  const collectFlow = () => {
    const vp = rfInstance ? { x: rfInstance.getViewport().x, y: rfInstance.getViewport().y, zoom: rfInstance.getViewport().zoom } : viewportRef.current;
    // Ensure at most one Start node (keep the first one by id order)
    let cleanNodes = nodes;
    const starts = nodes.filter((n) => n.data?.nodeType === 'start');
    if (starts.length > 1) {
      const keep = starts[0];
      cleanNodes = nodes.filter((n) => n.data?.nodeType !== 'start' || n.id === keep.id);
    }
    return toStored(cleanNodes, edges, vp);
  };

  const saveDraft = async () => {
    setBusy('save');
    try {
      await api.put(`/bots/${botId}/flow`, { flow: collectFlow() });
      setDirty(false);
      showToast('Draft saved');
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const validate = async () => {
    setBusy('validate');
    try {
      const { data } = await api.post(`/bots/${botId}/flow/validate`, { flow: collectFlow() });
      setIssues(data);
      if (!data.errors.length && !data.warnings.length) showToast('Flow looks good ✨');
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    setBusy('publish');
    try {
      const { data } = await api.post(`/bots/${botId}/flow/publish`, { flow: collectFlow() });
      setDirty(false);
      setIssues(data.warnings?.length ? { errors: [], warnings: data.warnings } : null);
      setBot((b) => ({ ...b, published_at: new Date().toISOString() }));
      showToast('Flow published 🚀 — live bots use it immediately');
    } catch (err) {
      if (err.response?.data?.details) setIssues(err.response.data.details);
      showToast(apiError(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const deploy = async (mode) => {
    setBusy('deploy');
    try {
      const { data } = await api.post(`/bots/${botId}/deploy`, { mode });
      setBot(data.bot);
      setDeployOpen(false);
      showToast(mode === 'webhook' ? 'Webhook registered — bot is live ⚡' : 'Bot is live via polling ⚡');
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const stop = async () => {
    setBusy('stop');
    try {
      const { data } = await api.post(`/bots/${botId}/stop`);
      setBot(data.bot);
      showToast('Bot stopped');
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const running = bot?.live?.running;

  return (
    <div className="builder-shell">
      <header className="builder-topbar">
        <Link to="/" className="btn ghost sm">← Bots</Link>
        <div className="builder-title">
          <strong>{bot?.name || '…'}</strong>
          {bot?.username && <span className="muted">@{bot.username}</span>}
          <span className={`status-dot ${running ? 'on' : bot?.last_error ? 'err' : 'off'}`} title={running ? 'running' : 'stopped'} />
          {!bot?.published_at && <span className="pill warn">unpublished</span>}
          {dirty && <span className="pill warn">unsaved</span>}
        </div>
        <div className="builder-actions">
          <button className="btn ghost sm" disabled={busy === 'validate'} onClick={validate}>Validate</button>
          <button className="btn ghost sm" disabled={busy === 'save' || !dirty} onClick={saveDraft}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          <button className="btn primary sm" disabled={busy === 'publish'} onClick={publish}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
          {running
            ? <button className="btn danger sm" disabled={busy === 'stop'} onClick={stop}>■ Stop</button>
            : <button className="btn primary sm" disabled={busy === 'deploy'} onClick={() => setDeployOpen(true)}>▶ Deploy</button>}
        </div>
      </header>

      <div className="builder-main">
        <aside className="palette">
          <p className="palette-title">Nodes</p>
          {PALETTE.map((type) => {
            const def = NODE_DEFS[type];
            return (
              <div
                key={type}
                className="palette-item"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/telebot-node', type)}
                onClick={() => addNodeAtViewport(type)}
                style={{ '--node-color': def.color }}
                title={def.description}
              >
                <span className="palette-icon">{def.icon}</span>
                <span>{def.label}</span>
              </div>
            );
          })}
          <p className="palette-hint">Drag onto the canvas or click to add.</p>
        </aside>

        <div className="canvas-wrap" ref={wrapperRef}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}>
          {loaded && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onInit={setRfInstance}
              deleteKeyCode={['Backspace', 'Delete']}
              defaultViewport={viewportRef.current || undefined}
              fitView={!viewportRef.current}
              proOptions={{ hideAttribution: true }}
              minZoom={0.2}
              maxZoom={1.6}
            >
              <Background gap={22} size={1} color="#253349" />
              <MiniMap pannable zoomable className="tb-minimap" />
              <Controls position="bottom-right" />
            </ReactFlow>
          )}
        </div>

        <PropertiesPanel node={selectedNode} credentials={credentials} onChange={updateData} onDelete={deleteNode} />
      </div>

      {issues && (issues.errors.length > 0 || issues.warnings.length > 0) && (
        <div className="issues-pop">
          <div className="issues-head">
            <strong>Flow check</strong>
            <button className="icon-btn" onClick={() => setIssues(null)}>✕</button>
          </div>
          {issues.errors.map((e, i) => <p key={`e${i}`} className="issue err">⛔ {e}</p>)}
          {issues.warnings.map((w, i) => <p key={`w${i}`} className="issue warn">⚠️ {w}</p>)}
        </div>
      )}

      {deployOpen && (
        <div className="modal-overlay" onClick={() => setDeployOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Deploy “{bot?.name}”</h3>
            <p className="muted">Choose how the bot receives Telegram updates. Republishing a flow updates a live bot automatically.</p>
            <div className="deploy-options">
              <button className="deploy-option" disabled={busy === 'deploy'} onClick={() => deploy('polling')}>
                <span className="deploy-icon">🔄</span>
                <strong>Long polling</strong>
                <span className="muted">Works anywhere, no public URL needed. Great for testing and small bots.</span>
              </button>
              <button className="deploy-option" disabled={busy === 'deploy'} onClick={() => deploy('webhook')}>
                <span className="deploy-icon">⚡</span>
                <strong>Webhook</strong>
                <span className="muted">Lowest latency. Requires PUBLIC_BASE_URL to be set on the server.</span>
              </button>
            </div>
            <button className="btn ghost sm block" onClick={() => setDeployOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
