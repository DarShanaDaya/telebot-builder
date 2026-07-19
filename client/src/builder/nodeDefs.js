// Shared metadata for every node type: palette, custom node rendering,
// property panels and client-side summaries all read from this table.

export const NODE_DEFS = {
  // --- Core Nodes ---
  start: {
    type: 'start',
    label: 'Start',
    icon: '▶️',
    color: '#22c55e',
    category: 'core',
    description: 'Entry point — runs on /start and new conversations.',
  },
  message: {
    type: 'message',
    label: 'Message',
    icon: '💬',
    color: '#2AABEE',
    category: 'core',
    description: 'Send a text message (HTML ok, {{variables}} supported) or a photo.',
  },
  buttons: {
    type: 'buttons',
    label: 'Buttons',
    icon: '🔘',
    color: '#a855f7',
    category: 'core',
    description: 'Message with inline buttons. Each button gets its own output handle.',
  },
  input: {
    type: 'input',
    label: 'Collect Input',
    icon: '⌨️',
    color: '#f59e0b',
    category: 'core',
    description: 'Ask a question and store the answer in a variable.',
  },
  condition: {
    type: 'condition',
    label: 'Condition',
    icon: '🔀',
    color: '#ec4899',
    category: 'core',
    description: 'Branch the flow with true/false logic on variables.',
  },
  setvar: {
    type: 'setvar',
    label: 'Set Variable',
    icon: '⚙️',
    color: '#64748b',
    category: 'core',
    description: 'Set or transform a variable (templates allowed).',
  },
  delay: {
    type: 'delay',
    label: 'Delay',
    icon: '⏱️',
    color: '#78716c',
    category: 'core',
    description: 'Wait a few seconds before continuing.',
  },
  end: {
    type: 'end',
    label: 'End',
    icon: '🏁',
    color: '#ef4444',
    category: 'core',
    description: 'Finish the conversation (optional goodbye text).',
  },

  // --- Advanced Logic Nodes ---
  loop: {
    type: 'loop',
    label: 'Loop',
    icon: '🔄',
    color: '#8b5cf6',
    category: 'logic',
    description: 'Iterate over an array variable. Each iteration runs the loop body.',
  },
  switch: {
    type: 'switch',
    label: 'Switch / Router',
    icon: '🧭',
    color: '#06b6d4',
    category: 'logic',
    description: 'Route to different branches based on a variable value (multi-way branch).',
  },
  function: {
    type: 'function',
    label: 'Function / Code',
    icon: '📝',
    color: '#f59e0b',
    category: 'logic',
    description: 'Run custom JavaScript code with access to variables. Returns a value.',
  },
  parallel: {
    type: 'parallel',
    label: 'Parallel / Fork',
    icon: '⚡',
    color: '#ec4899',
    category: 'logic',
    description: 'Run multiple branches concurrently. Wait for all to complete.',
  },

  // --- Integration Nodes ---
  http: {
    type: 'http',
    label: 'HTTP Request',
    icon: '🌐',
    color: '#06b6d4',
    category: 'integration',
    description: 'Call an external API, optionally with stored credentials.',
  },
  ai: {
    type: 'ai',
    label: 'AI Reply',
    icon: '🤖',
    color: '#10b981',
    category: 'integration',
    description: 'Generate a reply with OpenAI (uses an OpenAI credential).',
  },
  webhook: {
    type: 'webhook',
    label: 'Webhook Trigger',
    icon: '📥',
    color: '#14b8a6',
    category: 'integration',
    description: 'Receive external HTTP events to trigger or resume a flow.',
  },

  // --- Observability Nodes ---
  log: {
    type: 'log',
    label: 'Log / Debug',
    icon: '📋',
    color: '#64748b',
    category: 'observability',
    description: 'Write structured logs with variables for debugging and analytics.',
  },

  // --- Bot-Specific Nodes ---
  // These will be dynamically loaded based on bot type
};

export const NODE_CATEGORIES = [
  { id: 'core', label: 'Core', icon: '🧱', color: '#22c55e', order: 0 },
  { id: 'logic', label: 'Logic', icon: '🧠', color: '#8b5cf6', order: 1 },
  { id: 'integration', label: 'Integration', icon: '🔗', color: '#06b6d4', order: 2 },
  { id: 'observability', label: 'Observability', icon: '📊', color: '#64748b', order: 3 },
];

export const PALETTE = [
  'start', 'message', 'buttons', 'input', 'condition', 'setvar', 'delay', 'end',
  'loop', 'switch',
  'http', 'ai',
  'log',
];

export const CONDITION_OPS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'gte', label: '≥ (greater or equal)' },
  { value: 'lte', label: '≤ (less or equal)' },
  { value: 'exists', label: 'is set (not empty)' },
  { value: 'not_exists', label: 'is empty' },
  { value: 'regex', label: 'matches regex' },
  { value: 'in', label: 'in (array)' },
  { value: 'not_in', label: 'not in (array)' },
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
    case 'loop':
      return `for each {{${d.arrayVar || 'items'}}} as {{${d.itemVar || 'item'}}} → ${d.iterations ? `${d.iterations} max` : 'unlimited'}`;
    case 'switch':
      return d.cases?.length ? `${d.cases.map(c => `${c.value}→`).join(' ')}default` : 'No cases defined';
    case 'function':
      return d.name ? `fn ${d.name}(${d.params?.join(', ') || ''})` : 'Anonymous function';
    case 'parallel':
      return `${(d.branches || []).length} branches`;
    case 'webhook':
      return d.path ? `POST ${d.path}` : 'No path set';
    case 'log':
      return d.level ? `[${d.level}] ${trim(d.message, 30)}` : 'Log entry';
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
      return {
        text: 'What would you like to do?',
        nudgeText: '',
        // The selected non-link button is available to following nodes as
        // {{button_value}} by default. Each option may use a value different
        // from the label the user sees.
        saveAs: 'button_value',
        buttons: [{ id: `b${Date.now().toString(36)}`, name: 'option_1', label: 'Option 1', value: 'Option 1', url: '' }],
      };
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

    // --- Advanced Logic ---
    case 'loop':
      return {
        arrayVar: 'items',
        itemVar: 'item',
        indexVar: 'index',
        iterations: 100, // max iterations safety
        body: [], // will be handled by connecting nodes in the flow
      };
    case 'switch':
      return {
        value: '{{status}}',
        cases: [
          { value: 'success', label: 'Success' },
          { value: 'error', label: 'Error' },
        ],
        defaultCase: true,
      };
    case 'function':
      return {
        name: 'myFunction',
        params: ['data'],
        code: '// Return a value to set as output\nreturn { processed: true, data };',
        saveAs: 'fn_result',
      };
    case 'parallel':
      return {
        branches: [
          { id: `br${Date.now()}`, label: 'Branch 1' },
          { id: `br${Date.now()}_2`, label: 'Branch 2' },
        ],
        waitForAll: true,
        timeoutMs: 30000,
      };

    // --- Integration ---
    case 'webhook':
      return {
        path: '/webhook/{{botId}}/custom',
        method: 'POST',
        saveAs: 'webhook_data',
        verifySecret: '',
        response: { status: 200, body: { ok: true } },
      };

    // --- Observability ---
    case 'log':
      return {
        level: 'info', // debug, info, warn, error
        message: 'Flow reached checkpoint',
        data: {}, // key-value pairs to log
        includeVars: true,
      };

    default:
      return {};
  }
}

// Node metadata schema for custom properties
export const NODE_META_SCHEMA = {
  // Custom identifier for referencing this node in code/webhooks
  customId: { type: 'string', placeholder: 'my-custom-id', description: 'Unique ID for external references' },
  // Tags for filtering/searching
  tags: { type: 'array', items: { type: 'string' }, placeholder: 'tag1, tag2', description: 'Comma-separated tags' },
  // Group/folder for visual organization
  group: { type: 'string', placeholder: 'onboarding', description: 'Visual group/folder name' },
  // Description for documentation
  description: { type: 'string', placeholder: 'What this node does...', description: 'Node documentation' },
  // Disabled state (skip during execution)
  disabled: { type: 'boolean', default: false, description: 'Skip this node during execution' },
  // Retry configuration
  retry: { type: 'object', properties: { maxAttempts: { type: 'number', default: 3 }, delayMs: { type: 'number', default: 1000 } }, description: 'Retry on failure' },
  // Timeout override
  timeoutMs: { type: 'number', default: 30000, description: 'Node execution timeout (ms)' },
};