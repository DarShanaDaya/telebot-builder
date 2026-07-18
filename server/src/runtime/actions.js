import axios from 'axios';
import { renderTemplate, renderDeep, evaluateCondition } from '../lib/template.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Node executors. Each executor receives the execution context and the node,
// performs its side effects, and returns one of:
//   { next: <nodeId>, handle }   continue the walk
//   { wait: true }               pause the session until the user responds
//   { end: true }                conversation finished
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function execStart(ctx, node) {
  return { next: ctx.nextEdge(node.id) };
}

async function execMessage(ctx, node) {
  const d = node.data || {};
  const text = renderTemplate(d.text || '', ctx.templateCtx);
  if (d.photoUrl && d.photoUrl.trim()) {
    const photo = renderTemplate(d.photoUrl, ctx.templateCtx);
    await ctx.client.sendPhoto(ctx.chatId, photo, { caption: text || undefined });
  } else {
    await ctx.client.sendMessage(ctx.chatId, text || '…');
  }
  return { next: ctx.nextEdge(node.id) };
}

async function execButtons(ctx, node) {
  const d = node.data || {};
  const buttons = Array.isArray(d.buttons) ? d.buttons.filter((b) => b && b.label) : [];
  if (!buttons.length) {
    ctx.log('warn', `Buttons node ${node.id} has no buttons — skipping.`);
    return { next: ctx.nextEdge(node.id) };
  }
  const keyboard = buttons.map((b) => {
    const btn = { text: b.label };
    if (b.url && b.url.trim()) btn.url = renderTemplate(b.url, ctx.templateCtx);
    else btn.callback_data = `btn:${node.id}:${b.id}`;
    return [btn];
  });
  const text = renderTemplate(d.text || 'Choose an option:', ctx.templateCtx);
  await ctx.client.sendMessage(ctx.chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  ctx.setWait('callback', node.id);
  return { wait: true };
}

async function execInput(ctx, node) {
  const d = node.data || {};
  const prompt = renderTemplate(d.prompt || 'Please enter a value:', ctx.templateCtx);
  await ctx.client.sendMessage(ctx.chatId, prompt);
  ctx.setWait('input', node.id);
  return { wait: true };
}

async function execCondition(ctx, node) {
  const d = node.data || {};
  const result = evaluateCondition(
    { left: d.left ?? '', op: d.op || 'eq', right: d.right ?? '' },
    ctx.templateCtx
  );
  ctx.log('info', `Condition "${d.left} ${d.op} ${d.right}" → ${result}`);
  return { next: ctx.nextEdge(node.id, result ? 'true' : 'false') };
}

async function execSetVar(ctx, node) {
  const d = node.data || {};
  if (!d.name) {
    ctx.log('warn', `Set Variable node ${node.id} is missing a variable name.`);
    return { next: ctx.nextEdge(node.id) };
  }
  let value = renderTemplate(d.value ?? '', ctx.templateCtx);
  if (d.asJson) {
    try {
      value = JSON.parse(value);
    } catch {
      /* keep the raw string */
    }
  }
  ctx.vars[d.name] = value;
  return { next: ctx.nextEdge(node.id) };
}

// Injects the referenced credential into an outgoing HTTP request.
function applyCredential(credential, request) {
  if (!credential) return;
  const { type, data } = credential;
  if (type === 'bearer' && data.token) {
    request.headers.Authorization = `Bearer ${data.token}`;
  } else if (type === 'basic' && data.username) {
    request.headers.Authorization = `Basic ${Buffer.from(`${data.username}:${data.password || ''}`).toString('base64')}`;
  } else if (type === 'apikey' && data.key) {
    if (data.headerName) request.headers[data.headerName] = data.key;
    else if (data.queryParam) {
      const url = new URL(request.url);
      url.searchParams.set(data.queryParam, data.key);
      request.url = url.toString();
    } else {
      request.headers['X-API-Key'] = data.key;
    }
  }
}

async function execHttp(ctx, node) {
  const d = node.data || {};
  const tctx = ctx.templateCtx;
  const request = {
    method: (d.method || 'GET').toUpperCase(),
    url: renderTemplate(d.url || '', tctx),
    headers: {},
    timeout: Math.min(Number(d.timeoutMs) || 15000, config.maxHttpTimeoutMs),
    validateStatus: () => true,
  };
  for (const h of d.headers || []) {
    if (h && h.key) request.headers[h.key] = renderTemplate(h.value ?? '', tctx);
  }
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    let contentType = d.bodyType || 'json';
    if (contentType === 'json') {
      request.headers['Content-Type'] = request.headers['Content-Type'] || 'application/json';
      const raw = renderTemplate(d.body || '', tctx);
      try {
        request.data = raw ? JSON.parse(raw) : {};
      } catch {
        request.data = raw;
        request.headers['Content-Type'] = 'text/plain';
      }
    } else {
      request.headers['Content-Type'] = request.headers['Content-Type'] || 'application/x-www-form-urlencoded';
      request.data = renderTemplate(d.body || '', tctx);
    }
  }
  try {
    const credential = await ctx.resolveCredential(d.credentialId);
    applyCredential(credential, request);
  } catch (err) {
    ctx.log('warn', `Credential lookup failed: ${err.message}`);
  }
  if (!request.url) {
    ctx.log('error', `HTTP node ${node.id} has no URL.`);
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
  ctx.log('info', `HTTP ${request.method} ${request.url}`);
  try {
    const resp = await axios(request);
    if (d.saveAs) {
      ctx.vars[d.saveAs] = { status: resp.status, body: resp.data };
    }
    if (resp.status >= 400) {
      ctx.log('warn', `HTTP ${request.method} ${request.url} → ${resp.status}`);
      return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id, 'success') || ctx.nextEdge(node.id) };
    }
    return { next: ctx.nextEdge(node.id, 'success') || ctx.nextEdge(node.id) };
  } catch (err) {
    ctx.log('error', `HTTP request failed: ${err.message}`);
    if (d.saveAs) ctx.vars[d.saveAs] = { status: 0, error: err.message };
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
}

async function execAi(ctx, node) {
  const d = node.data || {};
  const tctx = ctx.templateCtx;
  const credential = await ctx.resolveCredential(d.credentialId).catch(() => null);
  if (!credential || credential.type !== 'openai') {
    ctx.log('error', `AI node ${node.id} has no valid OpenAI credential.`);
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
  const baseUrl = (credential.data.baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  const model = d.model || credential.data.model || 'gpt-4o-mini';
  const messages = [];
  if (d.system) messages.push({ role: 'system', content: renderTemplate(d.system, tctx) });

  let userPrompt = renderTemplate(d.prompt || '{{text}}', tctx);
  if (d.knowledgeBase && d.knowledgeBase.trim()) {
    const kb = renderTemplate(d.knowledgeBase, tctx);
    const fmt = (d.kbFormat || 'markdown').toLowerCase();
    let kbBlock = '';
    if (fmt === 'json') {
      kbBlock = `\n\n--- KNOWLEDGE BASE (JSON) ---\n${kb}\n--- END KB ---`;
    } else if (fmt === 'plain') {
      kbBlock = `\n\n--- KNOWLEDGE BASE ---\n${kb}\n--- END KB ---`;
    } else if (fmt === 'custom') {
      kbBlock = `\n\n[KNOWLEDGE BASE]\n${kb}\n[/KNOWLEDGE BASE]`;
    } else {
      // markdown (default) or trusted
      kbBlock = `\n\n--- KNOWLEDGE BASE ---\n${kb}\n--- END KB ---`;
    }
    userPrompt = `${userPrompt}${kbBlock}`;
  }

  messages.push({ role: 'user', content: userPrompt });
  await ctx.client.sendChatAction(ctx.chatId);
  try {
    const { data: resp } = await axios.post(
      `${baseUrl}/v1/chat/completions`,
      { model, messages, temperature: d.temperature ?? 0.7, max_tokens: d.maxTokens ?? 600 },
      { headers: { Authorization: `Bearer ${credential.data.apiKey}` }, timeout: 45000 }
    );
    const reply = resp.choices?.[0]?.message?.content?.trim() || '';
    if (d.saveAs) ctx.vars[d.saveAs] = reply;
    if (d.sendReply !== false) await ctx.client.sendMessage(ctx.chatId, reply || '(empty response)');
    return { next: ctx.nextEdge(node.id, 'out') || ctx.nextEdge(node.id) };
  } catch (err) {
    ctx.log('error', `AI request failed: ${err.response?.data?.error?.message || err.message}`);
    if (d.saveAs) ctx.vars[d.saveAs] = '';
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
}

async function execDelay(ctx, node) {
  const seconds = Math.max(0, Math.min(Number(node.data?.seconds) || 1, config.maxDelaySeconds));
  await sleep(seconds * 1000);
  return { next: ctx.nextEdge(node.id) };
}

async function execEnd(ctx, node) {
  const text = node.data?.text?.trim();
  if (text) await ctx.client.sendMessage(ctx.chatId, renderTemplate(text, ctx.templateCtx));
  ctx.finish();
  return { end: true };
}

export const EXECUTORS = {
  start: execStart,
  message: execMessage,
  buttons: execButtons,
  input: execInput,
  condition: execCondition,
  setvar: execSetVar,
  http: execHttp,
  ai: execAi,
  delay: execDelay,
  end: execEnd,
};
