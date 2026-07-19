import { NODE_DEFS, CONDITION_OPS, NODE_META_SCHEMA } from '../builder/nodeDefs';

// Right-hand inspector panel: type-specific editors for the selected node.

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

const set = (data, onChange, key, value) => onChange({ ...data, [key]: value });

function ButtonsEditor({ data, onChange }) {
  const buttons = data.buttons || [];
  const update = (i, patch) => {
    const next = buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    set(data, onChange, 'buttons', next);
  };
  const add = () => set(data, onChange, 'buttons', [...buttons, { id: `b${Date.now().toString(36)}`, label: `Option ${buttons.length + 1}`, url: '' }]);
  const remove = (i) => set(data, onChange, 'buttons', buttons.filter((_, idx) => idx !== i));
  return (
    <div className="btn-editor">
      {buttons.map((b, i) => (
        <div className="btn-editor-row" key={b.id}>
          <input value={b.label} placeholder="Button label" onChange={(e) => update(i, { label: e.target.value })} />
          <input value={b.url || ''} placeholder="URL (optional — makes it a link button)" onChange={(e) => update(i, { url: e.target.value })} />
          <button className="icon-btn" title="Remove button" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={add}>+ Add button</button>
      <p className="field-hint">Each non-link button has its own output handle on the canvas — wire it to the next step.</p>
    </div>
  );
}

function HeadersEditor({ headers = [], onChange }) {
  const update = (i, patch) => onChange(headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  return (
    <div className="btn-editor">
      {headers.map((h, i) => (
        <div className="btn-editor-row" key={i}>
          <input value={h.key || ''} placeholder="Header" onChange={(e) => update(i, { key: e.target.value })} />
          <input value={h.value || ''} placeholder="Value (templates ok)" onChange={(e) => update(i, { value: e.target.value })} />
          <button className="icon-btn" onClick={() => onChange(headers.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => onChange([...headers, { key: '', value: '' }])}>+ Add header</button>
    </div>
  );
}

function CredentialSelect({ credentials, filterType, value, onChange }) {
  const options = credentials.filter((c) => !filterType || c.type === filterType);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
      ))}
    </select>
  );
}

function ArrayEditor({ label, items, onChange, renderItem, itemKey = 'id' }) {
  return (
    <Field label={label}>
      <div className="btn-editor">
        {items.map((item, i) => (
          <div className="btn-editor-row" key={item[itemKey] || i}>
            {renderItem(item, i, (patch) => {
              const next = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
              onChange(next);
            })}
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => onChange([...items, {}])}>+ Add</button>
      </div>
    </Field>
  );
}

function SwitchCasesEditor({ cases = [], onChange }) {
  const update = (i, patch) => onChange(cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...cases, { value: '', label: `Case ${cases.length + 1}` }]);
  const remove = (i) => onChange(cases.filter((_, idx) => idx !== i));
  return (
    <div className="btn-editor">
      {cases.map((c, i) => (
        <div className="btn-editor-row" key={i}>
          <input value={c.value || ''} placeholder="Match value" onChange={(e) => update(i, { value: e.target.value })} />
          <input value={c.label || ''} placeholder="Case label" onChange={(e) => update(i, { label: e.target.value })} />
          <button className="icon-btn" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={add}>+ Add case</button>
      <p className="field-hint">Each case creates an output handle. Wire each to a different branch.</p>
    </div>
  );
}

function ParallelBranchesEditor({ branches = [], onChange }) {
  const update = (i, patch) => onChange(branches.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const add = () => onChange([...branches, { id: `br${Date.now()}`, label: `Branch ${branches.length + 1}` }]);
  const remove = (i) => onChange(branches.filter((_, idx) => idx !== i));
  return (
    <div className="btn-editor">
      {branches.map((b, i) => (
        <div className="btn-editor-row" key={b.id}>
          <input value={b.label || ''} placeholder="Branch label" onChange={(e) => update(i, { label: e.target.value })} />
          <button className="icon-btn" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button className="btn ghost sm" onClick={add}>+ Add branch</button>
      <p className="field-hint">Each branch runs in parallel. Wire from each branch's output handle.</p>
    </div>
  );
}

function MetaEditor({ data, onChange }) {
  const meta = data.meta || {};
  return (
    <details className="meta-section">
      <summary className="meta-summary">⚙️ Advanced Settings (Custom ID, Tags, Group, Retry...)</summary>
      <div className="meta-fields">
        <Field label="Custom ID" hint="Unique identifier for external references (webhooks, API)">
          <input value={meta.customId || ''} onChange={(e) => set(data, onChange, 'meta', { ...meta, customId: e.target.value })} placeholder="my-node-id" />
        </Field>
        <Field label="Tags" hint="Comma-separated tags for filtering (e.g. onboarding, payment, admin)">
          <input value={meta.tags?.join(', ') || ''} onChange={(e) => set(data, onChange, 'meta', { ...meta, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} placeholder="tag1, tag2" />
        </Field>
        <Field label="Group" hint="Visual folder/group name for canvas organization">
          <input value={meta.group || ''} onChange={(e) => set(data, onChange, 'meta', { ...meta, group: e.target.value })} placeholder="onboarding" />
        </Field>
        <Field label="Description" hint="Documentation for this node">
          <textarea rows={2} value={meta.description || ''} onChange={(e) => set(data, onChange, 'meta', { ...meta, description: e.target.value })} placeholder="What this node does..." />
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={Boolean(meta.disabled)} onChange={(e) => set(data, onChange, 'meta', { ...meta, disabled: e.target.checked })} />
          Disabled (skip during execution)
        </label>
        <Field label="Retry Attempts" hint="Number of retry attempts on failure">
          <input type="number" min={0} max={10} value={meta.retry?.maxAttempts || 0} onChange={(e) => set(data, onChange, 'meta', { ...meta, retry: { ...meta.retry, maxAttempts: Number(e.target.value) } })} />
        </Field>
        <Field label="Retry Delay (ms)" hint="Delay between retries">
          <input type="number" min={0} value={meta.retry?.delayMs || 1000} onChange={(e) => set(data, onChange, 'meta', { ...meta, retry: { ...meta.retry, delayMs: Number(e.target.value) } })} />
        </Field>
        <Field label="Timeout (ms)" hint="Node execution timeout override">
          <input type="number" min={1000} value={meta.timeoutMs || 30000} onChange={(e) => set(data, onChange, 'meta', { ...meta, timeoutMs: Number(e.target.value) })} />
        </Field>
      </div>
    </details>
  );
}

export default function PropertiesPanel({ node, credentials, onChange, onDelete }) {
  if (!node) {
    return (
      <aside className="props-panel empty">
        <p className="props-empty-title">Nothing selected</p>
        <p className="props-empty-text">Click a node to edit it, or drag a new node from the palette on the left.</p>
        <div className="props-cheatsheet">
          <p className="props-empty-title">Template variables</p>
          <code>{'{{first_name}}'} {'{{username}}'} {'{{chat_id}}'} {'{{text}}'}</code>
          <p>…plus every variable you collect in Input, Set Variable, HTTP and AI nodes.</p>
        </div>
      </aside>
    );
  }
  // The actual node type is stored in node.data.nodeType (e.g., 'start', 'message', 'buttons', etc.)
  // while node.type is the React Flow custom node type ('tb')
  const nodeType = node.data?.nodeType || 'unknown';
  const def = NODE_DEFS[nodeType] || {};
  const d = node.data || {};

  return (
    <aside className="props-panel">
      <div className="props-head" style={{ '--node-color': def.color }}>
        <span className="props-icon">{def.icon}</span>
        <div>
          <div className="props-title">{def.label}</div>
          <div className="props-desc">{def.description}</div>
        </div>
      </div>

      <div className="props-body">
        {nodeType === 'start' && (
          <p className="field-hint">The flow starts here when a user sends <code>/start</code>, or messages a bot whose conversation has ended.</p>
        )}

        {nodeType === 'message' && (
          <>
            <Field label="Message text" hint="HTML tags like <b> and <i> are supported.">
              <textarea rows={5} value={d.text || ''} onChange={(e) => set(d, onChange, 'text', e.target.value)} placeholder="Hello {{first_name}}!" />
            </Field>
            <Field label="Photo URL (optional)" hint="If set, the message is sent as a photo with the text as caption.">
              <input value={d.photoUrl || ''} onChange={(e) => set(d, onChange, 'photoUrl', e.target.value)} placeholder="https://…/image.jpg" />
            </Field>
          </>
        )}

        {nodeType === 'buttons' && (
          <>
            <Field label="Question text">
              <textarea rows={3} value={d.text || ''} onChange={(e) => set(d, onChange, 'text', e.target.value)} />
            </Field>
            <Field label="Buttons">
              <ButtonsEditor data={d} onChange={onChange} />
            </Field>
            <Field label="Reminder text (optional)" hint="Sent when the user types instead of tapping a button.">
              <input value={d.nudgeText || ''} onChange={(e) => set(d, onChange, 'nudgeText', e.target.value)} placeholder="Please tap a button above ⬆️" />
            </Field>
          </>
        )}

        {nodeType === 'input' && (
          <>
            <Field label="Prompt">
              <textarea rows={3} value={d.prompt || ''} onChange={(e) => set(d, onChange, 'prompt', e.target.value)} />
            </Field>
            <Field label="Save answer to variable" hint="Use it later as {{variable}}.">
              <input value={d.variable || ''} onChange={(e) => set(d, onChange, 'variable', e.target.value.replace(/\s/g, '_'))} placeholder="answer" />
            </Field>
            <Field label="Validation">
              <select value={d.validation || 'any'} onChange={(e) => set(d, onChange, 'validation', e.target.value)}>
                <option value="any">Anything</option>
                <option value="number">Number</option>
                <option value="email">Email</option>
                <option value="regex">Regex</option>
              </select>
            </Field>
            {d.validation === 'regex' && (
              <Field label="Pattern">
                <input value={d.pattern || ''} onChange={(e) => set(d, onChange, 'pattern', e.target.value)} placeholder="^\d{4}$" />
              </Field>
            )}
            <Field label="Retry text (optional)" hint="Sent when validation fails. Users can type /cancel to bail out.">
              <input value={d.retryText || ''} onChange={(e) => set(d, onChange, 'retryText', e.target.value)} />
            </Field>
            <Field label="Cancel text (optional)" hint="Sent when the user types /cancel (or wire the /cancel handle).">
              <input value={d.cancelText || ''} onChange={(e) => set(d, onChange, 'cancelText', e.target.value)} />
            </Field>
          </>
        )}

        {nodeType === 'condition' && (
          <>
            <Field label="Left value" hint="Usually a variable, e.g. {{answer}}">
              <input value={d.left || ''} onChange={(e) => set(d, onChange, 'left', e.target.value)} />
            </Field>
            <Field label="Operator">
              <select value={d.op || 'eq'} onChange={(e) => set(d, onChange, 'op', e.target.value)}>
                {CONDITION_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            {!['exists', 'not_exists'].includes(d.op || 'eq') && (
              <Field label="Right value">
                <input value={d.right || ''} onChange={(e) => set(d, onChange, 'right', e.target.value)} />
              </Field>
            )}
            <p className="field-hint">Wire the <b>true</b> and <b>false</b> handles to different branches.</p>
          </>
        )}

        {nodeType === 'setvar' && (
          <>
            <Field label="Variable name">
              <input value={d.name || ''} onChange={(e) => set(d, onChange, 'name', e.target.value.replace(/\s/g, '_'))} />
            </Field>
            <Field label="Value" hint="Templates allowed, e.g. Order #{{order_id}}">
              <textarea rows={3} value={d.value || ''} onChange={(e) => set(d, onChange, 'value', e.target.value)} />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={Boolean(d.asJson)} onChange={(e) => set(d, onChange, 'asJson', e.target.checked)} />
              Parse value as JSON
            </label>
          </>
        )}

        {nodeType === 'http' && (
          <>
            <div className="row-2">
              <Field label="Method">
                <select value={d.method || 'GET'} onChange={(e) => set(d, onChange, 'method', e.target.value)}>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Timeout (ms)">
                <input type="number" min={1000} max={30000} value={d.timeoutMs || 15000} onChange={(e) => set(d, onChange, 'timeoutMs', Number(e.target.value))} />
              </Field>
            </div>
            <Field label="URL" hint="Templates allowed, e.g. https://api.example.com/users/{{user_id}}">
              <input value={d.url || ''} onChange={(e) => set(d, onChange, 'url', e.target.value)} placeholder="https://api.example.com/endpoint" />
            </Field>
            <Field label="Credential (optional)" hint="Adds Authorization / API key automatically.">
              <CredentialSelect credentials={credentials} value={d.credentialId} onChange={(v) => set(d, onChange, 'credentialId', v)} />
            </Field>
            <Field label="Headers">
              <HeadersEditor headers={d.headers || []} onChange={(v) => set(d, onChange, 'headers', v)} />
            </Field>
            {['POST', 'PUT', 'PATCH'].includes(d.method || 'GET') && (
              <>
                <Field label="Body type">
                  <select value={d.bodyType || 'json'} onChange={(e) => set(d, onChange, 'bodyType', e.target.value)}>
                    <option value="json">JSON</option>
                    <option value="form">Form (urlencoded)</option>
                  </select>
                </Field>
                <Field label="Body" hint={d.bodyType === 'form' ? 'key=value&other={{var}}' : '{"answer": "{{answer}}"}'}>
                  <textarea rows={4} value={d.body || ''} onChange={(e) => set(d, onChange, 'body', e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Save response to variable" hint="Stores {status, body} — access like {{api_result.body.name}}">
              <input value={d.saveAs || ''} onChange={(e) => set(d, onChange, 'saveAs', e.target.value.replace(/\s/g, '_'))} placeholder="api_result" />
            </Field>
            <p className="field-hint">Wire <b>✓ ok</b> for 2xx–3xx and <b>✗ error</b> for failures.</p>
          </>
        )}

        {nodeType === 'ai' && (
          <>
            <Field label="OpenAI credential">
              <CredentialSelect credentials={credentials} filterType="openai" value={d.credentialId} onChange={(v) => set(d, onChange, 'credentialId', v)} />
            </Field>
            <Field label="Model override (optional)">
              <input value={d.model || ''} onChange={(e) => set(d, onChange, 'model', e.target.value)} placeholder="gpt-4o-mini" />
            </Field>
            <Field label="System prompt (optional)">
              <textarea rows={3} value={d.system || ''} onChange={(e) => set(d, onChange, 'system', e.target.value)} placeholder="You are a helpful support agent…" />
            </Field>
            <Field label="Prompt" hint="{{text}} is the user's last message.">
              <textarea rows={4} value={d.prompt || ''} onChange={(e) => set(d, onChange, 'prompt', e.target.value)} />
            </Field>
            <Field label="Save reply to variable (optional)">
              <input value={d.saveAs || ''} onChange={(e) => set(d, onChange, 'saveAs', e.target.value.replace(/\s/g, '_'))} placeholder="ai_reply" />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={d.sendReply !== false} onChange={(e) => set(d, onChange, 'sendReply', e.target.checked)} />
              Send the AI reply to the user
            </label>
          </>
        )}

        {nodeType === 'delay' && (
          <Field label="Seconds" hint="1–600">
            <input type="number" min={1} max={600} value={d.seconds || 1} onChange={(e) => set(d, onChange, 'seconds', Number(e.target.value))} />
          </Field>
        )}

        {nodeType === 'end' && (
          <Field label="Goodbye text (optional)">
            <textarea rows={3} value={d.text || ''} onChange={(e) => set(d, onChange, 'text', e.target.value)} placeholder="Thanks for chatting! Send /start anytime to begin again." />
          </Field>
        )}

        {/* --- Advanced Logic Nodes --- */}
        {nodeType === 'loop' && (
          <>
            <Field label="Array Variable" hint="Variable containing the array to iterate over">
              <input value={d.arrayVar || ''} onChange={(e) => set(d, onChange, 'arrayVar', e.target.value.replace(/\s/g, '_'))} placeholder="items" />
            </Field>
            <Field label="Item Variable" hint="Variable name for each item in the loop">
              <input value={d.itemVar || ''} onChange={(e) => set(d, onChange, 'itemVar', e.target.value.replace(/\s/g, '_'))} placeholder="item" />
            </Field>
            <Field label="Index Variable (optional)" hint="Variable name for the loop index (0-based)">
              <input value={d.indexVar || ''} onChange={(e) => set(d, onChange, 'indexVar', e.target.value.replace(/\s/g, '_'))} placeholder="index" />
            </Field>
            <Field label="Max Iterations" hint="Safety limit to prevent infinite loops (0 = unlimited)">
              <input type="number" min={0} max={10000} value={d.iterations || 100} onChange={(e) => set(d, onChange, 'iterations', Number(e.target.value))} />
            </Field>
            <p className="field-hint">Wire the <b>loop body</b> output to the first node inside the loop. Connect the last node back to this loop node for the next iteration.</p>
          </>
        )}

        {nodeType === 'switch' && (
          <>
            <Field label="Switch Value" hint="Variable or expression to match against cases">
              <input value={d.value || ''} onChange={(e) => set(d, onChange, 'value', e.target.value)} placeholder="{{status}}" />
            </Field>
            <Field label="Cases">
              <SwitchCasesEditor cases={d.cases || []} onChange={(v) => set(d, onChange, 'cases', v)} />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={d.defaultCase !== false} onChange={(e) => set(d, onChange, 'defaultCase', e.target.checked)} />
              Include default case (handles unmatched values)
            </label>
            <p className="field-hint">Each case creates an output handle. Wire each to a different branch.</p>
          </>
        )}

        {nodeType === 'function' && (
          <>
            <Field label="Function Name" hint="Name for debugging and variable reference">
              <input value={d.name || ''} onChange={(e) => set(d, onChange, 'name', e.target.value.replace(/\s/g, '_'))} placeholder="myFunction" />
            </Field>
            <Field label="Parameters" hint="Comma-separated parameter names available in code">
              <input value={d.params?.join(', ') || ''} onChange={(e) => set(d, onChange, 'params', e.target.value.split(',').map(p => p.trim()).filter(Boolean))} placeholder="data, context" />
            </Field>
            <Field label="JavaScript Code" hint="Return a value to save. Available: params, vars (all variables), ctx (helpers).">
              <textarea rows={10} value={d.code || ''} onChange={(e) => set(d, onChange, 'code', e.target.value)} placeholder="// Return a value to set as output\nreturn { processed: true, data };" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} />
            </Field>
            <Field label="Save Result To" hint="Variable name to store the return value">
              <input value={d.saveAs || ''} onChange={(e) => set(d, onChange, 'saveAs', e.target.value.replace(/\s/g, '_'))} placeholder="fn_result" />
            </Field>
            <p className="field-hint"><b>Security:</b> Code runs in a sandboxed VM. No access to filesystem, network, or Node.js APIs. Available globals: vars, params, Math, JSON, Date, console.log.</p>
          </>
        )}

        {nodeType === 'parallel' && (
          <>
            <Field label="Branches">
              <ParallelBranchesEditor branches={d.branches || []} onChange={(v) => set(d, onChange, 'branches', v)} />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={d.waitForAll !== false} onChange={(e) => set(d, onChange, 'waitForAll', e.target.checked)} />
              Wait for all branches to complete
            </label>
            <Field label="Timeout (ms)" hint="Max time to wait for all branches">
              <input type="number" min={1000} max={120000} value={d.timeoutMs || 30000} onChange={(e) => set(d, onChange, 'timeoutMs', Number(e.target.value))} />
            </Field>
            <p className="field-hint">Each branch creates an output handle. Wire each branch to its starting node.</p>
          </>
        )}

        {/* --- Integration Nodes --- */}
        {nodeType === 'webhook' && (
          <>
            <Field label="Webhook Path" hint="Relative path for the webhook endpoint (templates allowed)">
              <input value={d.path || ''} onChange={(e) => set(d, onChange, 'path', e.target.value)} placeholder="/webhook/{{botId}}/custom" />
            </Field>
            <Field label="HTTP Method">
              <select value={d.method || 'POST'} onChange={(e) => set(d, onChange, 'method', e.target.value)}>
                {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Save Payload To" hint="Variable to store the incoming webhook data">
              <input value={d.saveAs || ''} onChange={(e) => set(d, onChange, 'saveAs', e.target.value.replace(/\s/g, '_'))} placeholder="webhook_data" />
            </Field>
            <Field label="Verify Secret (optional)" hint="HMAC secret for verifying webhook signatures">
              <input type="password" value={d.verifySecret || ''} onChange={(e) => set(d, onChange, 'verifySecret', e.target.value)} placeholder="secret" />
            </Field>
            <Field label="Response Body" hint="JSON response to send back">
              <textarea rows={3} value={JSON.stringify(d.response || { ok: true }, null, 2)} onChange={(e) => { try { set(d, onChange, 'response', JSON.parse(e.target.value)); } catch {} }} />
            </Field>
            <p className="field-hint">This node creates a public endpoint at <code>PUBLIC_BASE_URL/webhooks/telegram/&lt;botId&gt;/&lt;secret&gt;&lt;path&gt;</code>. Use it to trigger flows from external services.</p>
          </>
        )}

        {/* --- Observability Nodes --- */}
        {nodeType === 'log' && (
          <>
            <Field label="Log Level">
              <select value={d.level || 'info'} onChange={(e) => set(d, onChange, 'level', e.target.value)}>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </Field>
            <Field label="Message" hint="Log message (templates supported)">
              <input value={d.message || ''} onChange={(e) => set(d, onChange, 'message', e.target.value)} placeholder="Processing order {{order_id}}" />
            </Field>
            <Field label="Structured Data" hint="Key-value pairs to include in the log entry (templates supported)">
              <textarea rows={4} value={JSON.stringify(d.data || {}, null, 2)} onChange={(e) => { try { set(d, onChange, 'data', JSON.parse(e.target.value)); } catch {} }} placeholder='{ "orderId": "{{order_id}}", "amount": "{{total}}" }' style={{ fontFamily: 'monospace', fontSize: '0.85rem' }} />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={d.includeVars !== false} onChange={(e) => set(d, onChange, 'includeVars', e.target.checked)} />
              Include all flow variables in log
            </label>
          </>
        )}

        {/* --- Advanced Settings (Custom ID, Tags, Group, etc.) --- */}
        {!['start', 'end'].includes(nodeType) && <MetaEditor data={d} onChange={onChange} />}

        {!['start', 'end'].includes(nodeType) && (
          <button className="btn danger sm block" onClick={() => onDelete(node)}>Delete node</button>
        )}
      </div>
    </aside>
  );
}