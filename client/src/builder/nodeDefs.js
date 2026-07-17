// Shared metadata for every node type: palette, custom node rendering,
// property panels and client-side summaries all read from this table.

export const NODE_DEFS = {
  start: {
    type: 'start',
    label: 'Start',
    icon: '▶️',
    color: '#22c55e',
    description: 'Entry point — runs on /start and new conversations.',
  },
  message: {
    type: 'message',
    label: 'Message',
    icon: '💬',
    color: '#2AABEE',
    description: 'Send a text message (HTML ok, {{variables}} supported) or a photo.',
  },
  buttons: {
    type: 'buttons',
    label: 'Buttons',
    icon: '🔘',
    color: '#a855f7',
    description: 'Message with inline buttons. Each button gets its own output handle.',
  },
  input: {
    type: 'input',
    label: 'Collect Input',
    icon: '⌨️',
    color: '#f59e0b',
    description: 'Ask a question and store the answer in a variable.',
  },
  condition: {
    type: 'condition',
    label: 'Condition',
    icon: '🔀',
    color: '#ec4899',
    description: 'Branch the flow with true/false logic on variables.',
  },
  setvar: {
    type: 'setvar',
    label: 'Set Variable',
    icon: '⚙️',
    color: '#64748b',
    description: 'Set or transform a variable (templates allowed).',
  },
  http: {
    type: 'http',
    label: 'HTTP Request',
    icon: '🌐',
    color: '#06b6d4',
    description: 'Call an external API, optionally with stored credentials.',
  },
  ai: {
    type: 'ai',
    label: 'AI Reply',
    icon: '🤖',
    color: '#10b981',
    description: 'Generate a reply with OpenAI (uses an OpenAI credential).',
  },
  delay: {
    type: 'delay',
    label: 'Delay',
    icon: '⏱️',
    color: '#78716c',
    description: 'Wait a few seconds before continuing.',
  },
  end: {
    type: 'end',
    label: 'End',
    icon: '🏁',
    color: '#ef4444',
    description: 'Finish the conversation (optional goodbye text).',
  },
};

export const PALETTE = ['start', 'message', 'buttons', 'input', 'condition', 'setvar', 'http', 'ai', 'delay', 'end'];

export const CONDITION_OPS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'doesn’t contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'gte', label: '≥ (greater or equal)' },
  { value: 'lte', label: '≤ (less or equal)' },
  { value: 'exists', label: 'is set (not empty)' },
  { value: 'not_exists', label: 'is empty' },
  { value: 'regex', label: 'matches regex' },
];

const trim = (s, n = 46) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

export function summarize(node) {
  const d = node.data || {};
  switch (node.type) {
    case 'start':
      return 'Entry point';
    case 'message':
      return trim(d.text) || (d.photoUrl ? '📷 photo message' : 'Empty message');
    case 'buttons': {
      const labels = (d.buttons || []).filter((b) => b.label).map((b) => b.label);
      return labels.length ? labels.join(' · ') : 'No buttons yet';
    }
    case 'input':
      return d.variable ? `→ {{${d.variable}}}${d.validation && d.validation !== 'any' ? ` (${d.validation})` : ''}` : 'No variable set';
    case 'condition':
      return `${trim(d.left, 18) || '?'} ${CONDITION_OPS.find((o) => o.value === d.op)?.label || d.op || '='} ${trim(d.right, 18)}`;
    case 'setvar':
      return d.name ? `{{${d.name}}} = ${trim(d.value, 20)}` : 'No variable set';
    case 'http':
      return `${d.method || 'GET'} ${trim(d.url, 32)}` || 'No URL set';
    case 'ai':
      return trim(d.prompt, 40) || 'Prompt not set';
    case 'delay':
      return `wait ${d.seconds || 1}s`;
    case 'end':
      return d.text ? `“${trim(d.text, 32)}”` : 'End conversation';
    default:
      return '';
  }
}

// Default data when a node is dropped on the canvas.
export function defaultData(type) {
  switch (type) {
    case 'message':
      return { text: 'Hello {{first_name}} 👋', photoUrl: '' };
    case 'buttons':
      return { text: 'What would you like to do?', nudgeText: '', buttons: [{ id: `b${Date.now().toString(36)}`, label: 'Option 1', url: '' }] };
    case 'input':
      return { prompt: 'Please type your answer:', variable: 'answer', validation: 'any', pattern: '', retryText: '', cancelText: '' };
    case 'condition':
      return { left: '{{answer}}', op: 'eq', right: 'yes' };
    case 'setvar':
      return { name: 'my_var', value: '', asJson: false };
    case 'http':
      return { method: 'GET', url: '', headers: [], body: '', bodyType: 'json', timeoutMs: 15000, saveAs: 'api_result', credentialId: '' };
    case 'ai':
      return { credentialId: '', model: '', system: '', prompt: '{{text}}', temperature: 0.7, maxTokens: 600, saveAs: '', sendReply: true };
    case 'delay':
      return { seconds: 2 };
    case 'end':
      return { text: '' };
    default:
      return {};
  }
}
