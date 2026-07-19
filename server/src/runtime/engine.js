import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { EXECUTORS } from './actions.js';
import { resolveCredential } from '../credentials/service.js';
import { renderTemplate } from '../lib/template.js';

// ---------------------------------------------------------------------------
// Flow runtime engine. Transport-agnostic: both the long-polling manager and
// the webhook router feed Telegram updates through handleUpdate().
// Per-chat state (current node, variables, pending waits) lives in the
// sessions table so conversations survive restarts.
// ---------------------------------------------------------------------------

const MAX_STEPS = config.maxFlowStepsPerUpdate;

const SENSITIVE_LOG_KEY = /token|secret|password|authorization|api[-_]?key|credential/i;

function redactLogData(value, key = '') {
  if (SENSITIVE_LOG_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactLogData(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactLogData(childValue, childKey)]));
  }
  return value;
}

export function makeBotLogger(botId) {
  return (level, message, chatId = null, dataObj = null) => {
    const line = `[bot ${botId.slice(0, 8)}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level !== 'debug') console.log(line);
    db.addLog({
      bot_id: botId,
      chat_id: chatId == null ? null : String(chatId),
      level,
      message: String(message),
      data: dataObj ? JSON.stringify(redactLogData(dataObj)).slice(0, 4000) : null,
      created_at: new Date().toISOString(),
    }).catch((err) => console.error('[log] write failed:', err.message));
  };
}

function nextEdgeOf(flow, nodeId, handle = 'out') {
  const edge = (flow.edges || []).find(
    (e) => e.source === nodeId && (e.sourceHandle || 'out') === (handle || 'out')
  );
  return edge ? edge.target : null;
}

function startNodeOf(flow) {
  return (flow.nodes || []).find((n) => n.type === 'start') || null;
}

function safeJson(text, fallback = {}) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

const isReferenceName = (value) => /^[A-Za-z][\w-]*$/.test(String(value || ''));

function safeFailureCode(err, fallback = 'node_execution_failed') {
  const candidate = typeof err?.code === 'string' ? err.code : '';
  return /^[a-z][a-z0-9_-]{0,63}$/i.test(candidate) ? candidate.toLowerCase() : fallback;
}

function markFailed(session, nodeId, type, code) {
  session.status = 'failed';
  session.node_id = nodeId || null;
  session.pending = JSON.stringify({ type, nodeId: nodeId || null, code, at: new Date().toISOString() });
}

function recordNodeValue(vars, node, valueName, value, { replace = false, selected } = {}) {
  const nodeName = node?.data?.nodeName;
  if (!isReferenceName(nodeName) || !isReferenceName(valueName)) return false;
  const allNodeValues = vars._nodeValues && typeof vars._nodeValues === 'object' ? vars._nodeValues : {};
  const currentNodeValues = !replace && allNodeValues[nodeName] && typeof allNodeValues[nodeName] === 'object'
    ? allNodeValues[nodeName]
    : {};
  allNodeValues[nodeName] = {
    ...currentNodeValues,
    ...(selected ? { selected } : {}),
    [valueName]: value,
  };
  vars._nodeValues = allNodeValues;
  return true;
}

function buildCtx({ bot, client, log, chatId, from, flow, session, vars }) {
  // Live template context: a Proxy so nodes that set variables mid-run (Set
  // Variable plus a following Message, etc.) see each other's updates.
  const telegramFields = {
    chat_id: chatId,
    first_name: from.first_name || '',
    last_name: from.last_name || '',
    username: from.username || '',
    language: from.language_code || '',
  };
  const templateCtx = new Proxy(Object.create(null), {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in telegramFields) return telegramFields[prop];
      return vars[prop];
    },
    set(_t, prop, value) {
      vars[prop] = value;
      return true;
    },
  });
  return {
    bot,
    client,
    log: (level, msg, data) => log(level, msg, chatId, data),
    chatId,
    from,
    vars,
    flow,
    templateCtx,
    recordNodeValue: (node, valueName, value, options) => recordNodeValue(vars, node, valueName, value, options),
    nextEdge: (nodeId, handle) => nextEdgeOf(flow, nodeId, handle),
    resolveCredential: (id) => resolveCredential(bot.user_id, id),
    setWait: (type, nodeId) => {
      session.status = type === 'input' ? 'awaiting_input' : 'awaiting_callback';
      session.node_id = nodeId;
      session.pending = JSON.stringify({ type, nodeId, at: new Date().toISOString() });
    },
    finish: () => {
      session.status = 'ended';
      session.node_id = null;
      session.pending = null;
    },
    // Expose session for advanced nodes (loop, parallel)
    session,
  };
}

async function runFrom(ctx, session, nodeId) {
  let current = nodeId;
  let steps = 0;
  while (current) {
    if (++steps > MAX_STEPS) {
      ctx.log('error', `Flow exceeded ${MAX_STEPS} synchronous steps — possible infinite loop. Session paused.`);
      markFailed(session, current, 'step_limit', 'flow_step_limit');
      try {
        await ctx.client.sendMessage(ctx.chatId, 'This conversation reached a safety limit. Please send /start to try again.');
      } catch {
        // Keep the recoverable failed state if Telegram is unavailable.
      }
      return;
    }
    const node = (ctx.flow.nodes || []).find((n) => n.id === current);
    if (!node) {
      ctx.log('warn', `Flow references missing node "${current}". Session paused.`);
      session.status = 'idle';
      return;
    }
    const executor = EXECUTORS[node.type];
    if (!executor) {
      ctx.log('error', `Unsupported node type "${node.type}" at ${node.id}.`);
      markFailed(session, node.id, 'unsupported_node', 'unsupported_node_type');
      try {
        await ctx.client.sendMessage(ctx.chatId, 'This conversation uses an unsupported step. Please contact the bot owner.');
      } catch {
        // Preserve the failed state even when the transport is unavailable.
      }
      return;
    }
    session.node_id = node.id;
    try {
      const result = await executor(ctx, node);
      if (result?.wait || result?.end) return;
      current = result?.next || null;
    } catch (err) {
      const code = safeFailureCode(err);
      ctx.log('error', `Node ${node.type} failed (${code}).`);
      // Do not silently turn an execution failure into an idle conversation:
      // the next arbitrary user message must not restart and duplicate work.
      markFailed(session, node.id, 'error', code);
      try {
        await ctx.client.sendMessage(ctx.chatId, 'Sorry — something went wrong. Please send /start to try again.');
      } catch {
        // Preserve the failed state even when the transport is unavailable.
      }
      return;
    }
  }
  // Ran out of edges: conversation idles until the next /start or message.
  if (session.status !== 'ended') {
    session.status = 'idle';
    session.pending = null;
  }
}

async function persistSession(session, vars, from) {
  // Store loop and parallel state in variables for persistence
  const varsToSave = { ...vars };
  if (session.loopState) varsToSave._loopState = session.loopState;
  if (session.parallelState) varsToSave._parallelState = session.parallelState;
  
  await db.upsertSession({
    id: session.id,
    bot_id: session.bot_id,
    chat_id: session.chat_id,
    user_json: JSON.stringify(from || {}),
    node_id: session.node_id,
    status: session.status,
    variables: JSON.stringify(varsToSave),
    pending: session.pending,
    last_activity: new Date().toISOString(),
    created_at: session.created_at,
  });
}

function isSessionExpired(session) {
  const ttlMs = config.sessionTtlHours * 3600 * 1000;
  return Date.now() - new Date(session.last_activity).getTime() > ttlMs;
}

export async function handleUpdate({ bot, client, update, log }) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (!chatId) return;
  const from = msg?.from ?? cb?.from ?? {};

  const flow = bot.flow_published ? safeJson(bot.flow_published, null) : null;
  if (!flow?.nodes?.length) {
    log('warn', `Bot "${bot.name}" has no published flow — update ignored.`, chatId);
    if (cb) await client.answerCallbackQuery(cb.id);
    return;
  }

  // Load or create the chat session.
  let session = await db.getSession(bot.id, String(chatId));
  if (session && isSessionExpired(session)) session = null;
  const now = new Date().toISOString();
  if (!session) {
    session = {
      id: crypto.randomUUID(),
      bot_id: bot.id,
      chat_id: String(chatId),
      node_id: null,
      status: 'idle',
      pending: null,
      created_at: now,
    };
  }
  const vars = safeJson(session.variables, {});
  // Restore loop and parallel state from variables
  if (vars._loopState) session.loopState = vars._loopState;
  if (vars._parallelState) session.parallelState = vars._parallelState;
  // Clean up internal vars
  delete vars._loopState;
  delete vars._parallelState;
  if (msg?.text != null) vars.text = msg.text;
  const ctx = buildCtx({ bot, client, log, chatId: String(chatId), from, flow, session, vars });
  const pending = safeJson(session.pending, null);

  try {
    if (msg?.text === '/start') {
      const start = startNodeOf(flow);
      session.status = 'idle';
      session.pending = null;
      if (start) await runFrom(ctx, session, start.id);
    } else if (msg?.text === '/retry' && session.status === 'failed' && session.node_id) {
      const failedNodeId = session.node_id;
      session.status = 'idle';
      session.pending = null;
      await runFrom(ctx, session, failedNodeId);
    } else if (cb) {
      await client.answerCallbackQuery(cb.id);
      await handleCallback(ctx, session, vars, cb);
    } else if (session.status === 'awaiting_input' && msg) {
      await handleInput(ctx, session, vars, msg);
    } else if (session.status === 'awaiting_callback' && msg) {
      const node = (flow.nodes || []).find((n) => n.id === session.node_id);
      const nudge = node?.data?.nudgeText?.trim() || 'Please tap one of the buttons above ⬆️ (or send /start to restart)';
      await client.sendMessage(String(chatId), nudge);
    } else if (msg && (session.status === 'idle' || session.status === 'ended')) {
      // Idle or ended conversation: any new message restarts the flow.
      const start = startNodeOf(flow);
      if (start) {
        session.status = 'idle';
        session.pending = null;
        await runFrom(ctx, session, start.id);
      }
    } else if (msg && session.status === 'failed') {
      await client.sendMessage(String(chatId), 'This conversation is paused after an error. Send /retry to try the failed step again, or /start to restart.');
    }
  } catch (err) {
    log('error', `Update handling failed: ${err.message}`, chatId);
  } finally {
    await persistSession(session, vars, from);
  }
}

async function handleCallback(ctx, session, vars, cb) {
  const data = cb.data || '';
  const match = /^btn:([^:]+):(.+)$/.exec(data);
  if (!match) {
    ctx.log('warn', `Unknown callback payload "${data}".`);
    return;
  }
  const [, nodeId, buttonId] = match;
  const node = (ctx.flow.nodes || []).find((n) => n.id === nodeId);
  if (!node) {
    // Published flows can change while an old Telegram inline keyboard remains
    // visible. A missing node is a stale callback, never a reason to clear the
    // active wait or restart the conversation.
    ctx.log('warn', `Ignored callback for missing node "${nodeId}".`);
    return;
  }
  // A callback is valid only for the button node the current session is
  // waiting on. Telegram clients can send old inline keyboards after a flow
  // changes, so never allow callback payload data to choose an arbitrary node.
  if (session.status !== 'awaiting_callback' || session.node_id !== nodeId) {
    ctx.log('warn', `Ignored stale callback for node "${nodeId}".`);
    return;
  }
  const button = (node.data?.buttons || []).find((b) => b.id === buttonId && !b.url?.trim());
  if (!button) {
    ctx.log('warn', `Ignored unknown or link-button callback "${buttonId}" on node "${nodeId}".`);
    return;
  }
  const buttonLabel = button.label || '';
  vars.last_callback = data;
  // A button may display friendly text while forwarding a stable machine value
  // (for example, "Standard plan" -> "standard"). Existing flows without a
  // value continue to forward their label.
  const configuredValue = button?.value;
  const buttonValue = renderTemplate(
    configuredValue == null || configuredValue === '' ? buttonLabel : configuredValue,
    ctx.templateCtx
  );
  const saveAs = String(node.data?.saveAs || 'button_value').trim();
  ctx.log('info', `Button "${buttonLabel || buttonId}" pressed`);
  // Keep universal aliases as well as the node's configured variable. This
  // makes a choice available to every subsequent node, including old flows.
  vars.last_button = buttonLabel;
  vars.last_button_value = buttonValue;
  if (saveAs) vars[saveAs] = buttonValue;
  // A Buttons node represents one current selection. Replace its namespace so
  // values from a prior visit (for example, "standard") cannot survive a new
  // selection (for example, "premium").
  ctx.recordNodeValue(node, button.name, buttonValue, { replace: true, selected: button.name });
  session.status = 'idle';
  session.pending = null;
  const next = ctx.nextEdge(nodeId, `btn-${buttonId}`) || ctx.nextEdge(nodeId);
  await runFrom(ctx, session, next);
}

async function handleInput(ctx, session, vars, msg) {
  const node = (ctx.flow.nodes || []).find((n) => n.id === session.node_id);
  if (!node) {
    session.status = 'idle';
    session.pending = null;
    return;
  }
  const d = node.data || {};
  const text = (msg.text ?? '').trim();

  // Escape hatch: /cancel exits the wait and optionally follows a cancel edge.
  if (text === '/cancel') {
    session.status = 'idle';
    session.pending = null;
    ctx.log('info', 'Input cancelled by user.');
    const cancelNext = ctx.nextEdge(node.id, 'cancel');
    if (cancelNext) await runFrom(ctx, session, cancelNext);
    else if (d.cancelText) await ctx.client.sendMessage(ctx.chatId, d.cancelText);
    return;
  }

  let valid = true;
  if (d.validation === 'number') valid = text !== '' && !Number.isNaN(Number(text));
  else if (d.validation === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  else if (d.validation === 'regex' && d.pattern) {
    try {
      valid = new RegExp(d.pattern).test(text);
    } catch {
      valid = true;
    }
  }

  if (!valid) {
    const retry = d.retryText?.trim() || 'That doesn’t look right — please try again. (or /cancel)';
    await ctx.client.sendMessage(ctx.chatId, retry);
    return; // stay in awaiting_input state
  }

  const name = d.variable || 'input';
  const inputValue = d.validation === 'number' ? Number(text) : text;
  // Preserve both the input node's named value and universal aliases. The
  // same session variable object is used by runFrom, so all following nodes
  // on the selected branch can immediately template these values.
  vars[name] = inputValue;
  vars.last_input = inputValue;
  vars.last_input_value = inputValue;
  ctx.recordNodeValue(node, name, inputValue);
  ctx.log('info', `Captured input → {{${name}}}`);
  session.status = 'idle';
  session.pending = null;
  await runFrom(ctx, session, ctx.nextEdge(node.id) || null);
}
