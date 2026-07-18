import { NODE_DEFS, CONDITION_OPS } from '../builder/nodeDefs';

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
  const nodeType = node.data?.nodeType || node.type;
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

            <Field label="Knowledge Base (optional)" hint="Paste custom data in markdown, json or plain text. AI will reference it.">
              <textarea rows={6} value={d.knowledgeBase || ''} onChange={(e) => set(d, onChange, 'knowledgeBase', e.target.value)} placeholder={`# FAQ\n- Q: ...\n- A: ...`} />
            </Field>
            <Field label="KB Format">
              <select value={d.kbFormat || 'markdown'} onChange={(e) => set(d, onChange, 'kbFormat', e.target.value)}>
                <option value="markdown">Markdown</option>
                <option value="json">JSON</option>
                <option value="plain">Plain Text</option>
                <option value="custom">Custom / Trusted</option>
              </select>
            </Field>
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

        {!['start', 'end'].includes(nodeType) && (
          <button className="btn danger sm block" onClick={() => onDelete(node)}>Delete node</button>
        )}
      </div>
    </aside>
  );
}
