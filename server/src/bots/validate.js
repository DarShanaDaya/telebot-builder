// Static analysis of a flow before publishing.
// Returns { errors: [], warnings: [] } — errors block publishing.

const NODE_LABELS = {
  start: 'Start',
  message: 'Message',
  buttons: 'Buttons',
  input: 'Input',
  condition: 'Condition',
  setvar: 'Set Variable',
  http: 'HTTP Request',
  ai: 'AI Reply',
  delay: 'Delay',
  end: 'End',
};

export function validateFlow(flow) {
  const errors = [];
  const warnings = [];
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];

  if (!nodes.length) {
    errors.push('The flow is empty — add a Start node to begin.');
    return { errors, warnings };
  }

  const starts = nodes.filter((n) => n.type === 'start');
  if (!starts.length) errors.push('Missing Start node — drag one from the palette.');
  if (starts.length > 1) warnings.push('Multiple Start nodes found — only the first one runs.');

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeNames = new Map();
  for (const node of nodes) {
    const nodeName = typeof node.data?.nodeName === 'string' ? node.data.nodeName.trim() : '';
    if (!nodeName) continue; // Legacy flows may opt in gradually.
    if (!/^[A-Za-z][\w-]*$/.test(nodeName)) {
      errors.push(`Node name "${nodeName}" must start with a letter and use only letters, numbers, underscores, or hyphens.`);
      continue;
    }
    if (nodeNames.has(nodeName)) {
      errors.push(`Node name "${nodeName}" is used more than once. Named-node references must be unique.`);
    } else {
      nodeNames.set(nodeName, node.id);
    }
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      errors.push('An edge points to a node that no longer exists.');
      break;
    }
  }

  const outgoing = (id, handle) => edges.filter((e) => e.source === id && (!handle || (e.sourceHandle || 'out') === handle));
  const label = (n) => NODE_LABELS[n.type] || n.type;

  // Reachability from the first start node.
  if (starts.length) {
    const visited = new Set();
    const queue = [starts[0].id];
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of edges.filter((x) => x.source === id)) queue.push(e.target);
    }
    const orphans = nodes.filter((n) => !visited.has(n.id));
    if (orphans.length) {
      warnings.push(`${orphans.length} node(s) are unreachable from Start: ${orphans.map((n) => label(n)).join(', ')}.`);
    }
  }

  for (const node of nodes) {
    const d = node.data || {};
    const at = label(node);
    switch (node.type) {
      case 'start':
        if (!outgoing(node.id).length) errors.push('Start node is not connected to anything.');
        break;
      case 'message':
        if (!d.text?.trim() && !d.photoUrl?.trim()) errors.push(`${at} node has no text or photo.`);
        break;
      case 'buttons': {
        const buttons = (d.buttons || []).filter((b) => b && b.label);
        if (!buttons.length) {
          errors.push(`${at} node has no buttons.`);
          break;
        }
        const buttonValueNames = new Set();
        for (const b of buttons) {
          if (!b.name?.trim()) {
            warnings.push(`Button "${b.label}" has no value name, so it cannot be used with a named-node reference.`);
          } else if (!/^[A-Za-z][\w-]*$/.test(b.name.trim())) {
            errors.push(`Button value name "${b.name}" must start with a letter and use only letters, numbers, underscores, or hyphens.`);
          } else if (buttonValueNames.has(b.name.trim())) {
            errors.push(`Button value name "${b.name}" is duplicated in the same Buttons node.`);
          } else {
            buttonValueNames.add(b.name.trim());
          }
          if (b.url?.trim()) continue;
          if (!outgoing(node.id, `btn-${b.id}`).length && !outgoing(node.id).length) {
            warnings.push(`Button "${b.label}" has no connection — pressing it ends the conversation.`);
          }
        }
        break;
      }
      case 'input':
        if (!d.variable?.trim()) errors.push(`${at} node needs a variable name to store the answer.`);
        break;
      case 'condition':
        if (!d.left?.trim()) errors.push(`${at} node needs a value on the left side.`);
        if (!outgoing(node.id, 'true').length && !outgoing(node.id, 'false').length) {
          warnings.push(`${at} node has no true/false connections.`);
        }
        break;
      case 'setvar':
        if (!d.name?.trim()) errors.push(`${at} node needs a variable name.`);
        break;
      case 'http':
        if (!d.url?.trim()) errors.push(`${at} node needs a URL.`);
        break;
      case 'ai':
        if (!d.credentialId) errors.push(`${at} node needs an OpenAI credential.`);
        else if (!d.prompt?.trim()) errors.push(`${at} node needs a prompt.`);
        break;
      case 'delay': {
        const s = Number(d.seconds);
        if (!Number.isFinite(s) || s < 1 || s > 600) errors.push(`${at} node must wait between 1 and 600 seconds.`);
        break;
      }
      default:
        if (!['end'].includes(node.type)) warnings.push(`Unknown node type "${node.type}".`);
    }
  }

  return { errors, warnings };
}
