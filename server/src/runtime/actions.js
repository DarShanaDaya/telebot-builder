import axios from 'axios';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { renderTemplate, renderDeep, evaluateCondition } from '../lib/template.js';
import { config } from '../config.js';
import { db } from '../db/index.js';

// ---------------------------------------------------------------------------
// Node executors. Each executor receives the execution context and the node,
// performs its side effects, and returns one of:
//   { next: <nodeId>, handle }   continue the walk
//   { wait: true }               pause the session until the user responds
//   { end: true }                conversation finished
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || b === 2))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0) || a >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9')
      || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.') || normalized.startsWith('::ffff:169.254.');
  }
  return true;
}

function assertPublicAddress(address) {
  if (!config.allowPrivateHttpTargets && isPrivateIp(address)) {
    const err = new Error('HTTP target resolves to a blocked private or reserved network address.');
    err.code = 'blocked_http_target';
    throw err;
  }
}

async function assertSafeHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const err = new Error('HTTP node URL is invalid.');
    err.code = 'invalid_http_url';
    throw err;
  }
  if ((url.protocol !== 'https:' && (url.protocol !== 'http:' || !config.allowInsecureHttpTargets)) || url.username || url.password) {
    const err = new Error('HTTP nodes only support credential-free HTTPS URLs.');
    err.code = 'blocked_http_protocol';
    throw err;
  }
  if (!config.allowPrivateHttpTargets && ['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) {
    const err = new Error('HTTP target hostname is blocked.');
    err.code = 'blocked_http_target';
    throw err;
  }
  if (net.isIP(url.hostname)) {
    assertPublicAddress(url.hostname);
  } else if (!config.allowPrivateHttpTargets) {
    const records = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
    if (!records.length) throw new Error('HTTP target hostname did not resolve.');
    records.forEach((record) => assertPublicAddress(record.address));
  }
  return url;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, records) => {
    if (err) return callback(err);
    try {
      const compatible = records.filter((record) => !options?.family || record.family === options.family);
      const selected = compatible[0] || records[0];
      assertPublicAddress(selected.address);
      callback(null, selected.address, selected.family);
    } catch (lookupErr) {
      callback(lookupErr);
    }
  });
}

const safeHttpAgent = new http.Agent({ lookup: safeLookup });
const safeHttpsAgent = new https.Agent({ lookup: safeLookup });

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
  ctx.recordNodeValue(node, d.name, value);
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
    // Do not allow a public URL to redirect into a private network. The
    // custom lookup revalidates DNS at connection time to resist rebinding.
    maxRedirects: 0,
    maxContentLength: 1024 * 1024,
    maxBodyLength: 1024 * 1024,
    proxy: false,
    httpAgent: safeHttpAgent,
    httpsAgent: safeHttpsAgent,
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
  try {
    await assertSafeHttpUrl(request.url);
  } catch (err) {
    ctx.log('error', `HTTP node ${node.id} blocked (${err.code || 'invalid_http_target'}).`);
    if (d.saveAs) {
      ctx.vars[d.saveAs] = { status: 0, error: err.code || 'invalid_http_target' };
      ctx.recordNodeValue(node, d.saveAs, ctx.vars[d.saveAs]);
    }
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
  ctx.log('info', `HTTP ${request.method} ${request.url}`);
  try {
    const resp = await axios(request);
    if (d.saveAs) {
      ctx.vars[d.saveAs] = { status: resp.status, body: resp.data };
      ctx.recordNodeValue(node, d.saveAs, ctx.vars[d.saveAs]);
    }
    if (resp.status < 200 || resp.status >= 300) {
      ctx.log('warn', `HTTP ${request.method} ${request.url} → ${resp.status}`);
      return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id, 'success') || ctx.nextEdge(node.id) };
    }
    return { next: ctx.nextEdge(node.id, 'success') || ctx.nextEdge(node.id) };
  } catch (err) {
    ctx.log('error', `HTTP request failed: ${err.message}`);
    if (d.saveAs) {
      ctx.vars[d.saveAs] = { status: 0, error: err.message };
      ctx.recordNodeValue(node, d.saveAs, ctx.vars[d.saveAs]);
    }
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
  messages.push({ role: 'user', content: renderTemplate(d.prompt || '{{text}}', tctx) });
  await ctx.client.sendChatAction(ctx.chatId);
  try {
    const { data: resp } = await axios.post(
      `${baseUrl}/v1/chat/completions`,
      { model, messages, temperature: d.temperature ?? 0.7, max_tokens: d.maxTokens ?? 600 },
      { headers: { Authorization: `Bearer ${credential.data.apiKey}` }, timeout: 45000 }
    );
    const reply = resp.choices?.[0]?.message?.content?.trim() || '';
    if (d.saveAs) {
      ctx.vars[d.saveAs] = reply;
      ctx.recordNodeValue(node, d.saveAs, reply);
    }
    if (d.sendReply !== false) await ctx.client.sendMessage(ctx.chatId, reply || '(empty response)');
    return { next: ctx.nextEdge(node.id, 'out') || ctx.nextEdge(node.id) };
  } catch (err) {
    ctx.log('error', `AI request failed: ${err.response?.data?.error?.message || err.message}`);
    if (d.saveAs) {
      ctx.vars[d.saveAs] = '';
      ctx.recordNodeValue(node, d.saveAs, '');
    }
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

// --- Advanced Logic Nodes ---

async function execLoop(ctx, node) {
  const d = node.data || {};
  const arrayVar = d.arrayVar || 'items';
  const itemVar = d.itemVar || 'item';
  const indexVar = d.indexVar || 'index';
  // `0` is intentionally the editor's "unlimited" option. A platform-level
  // execution step guard still prevents an unbounded request from running.
  const configuredIterations = Number(d.iterations);
  const maxIterations = Number.isFinite(configuredIterations) ? Math.max(0, configuredIterations) : 100;

  // Get the array from variables
  const array = ctx.vars[arrayVar];
  if (!Array.isArray(array)) {
    ctx.log('warn', `Loop node ${node.id}: variable "${arrayVar}" is not an array. Skipping loop.`);
    return { next: ctx.nextEdge(node.id, 'done') };
  }

  // Check if we're in the middle of a loop (stored in session)
  const session = ctx.session;
  const loopState = session.loopState?.[node.id] || { index: 0 };
  
  // If we have a loop state and it's not the first iteration, we're returning from the loop body
  if (loopState.index > 0) {
    // Continue to next iteration
    loopState.index++;
  } else {
    // First iteration
    loopState.index = 0;
  }

  if (loopState.index >= array.length || (maxIterations > 0 && loopState.index >= maxIterations)) {
    // Loop complete
    delete session.loopState?.[node.id];
    return { next: ctx.nextEdge(node.id, 'done') };
  }

  // Set loop variables for this iteration
  ctx.vars[itemVar] = array[loopState.index];
  if (indexVar) ctx.vars[indexVar] = loopState.index;
  
  // Store loop state
  if (!session.loopState) session.loopState = {};
  session.loopState[node.id] = loopState;

  ctx.log('info', `Loop ${node.id}: iteration ${loopState.index + 1}/${maxIterations > 0 ? Math.min(array.length, maxIterations) : array.length}`);
  
  // Continue to loop body (iterate handle)
  return { next: ctx.nextEdge(node.id, 'iterate') };
}

async function execSwitch(ctx, node) {
  const d = node.data || {};
  const value = renderTemplate(d.value ?? '', ctx.templateCtx);
  const cases = d.cases || [];
  
  // Find matching case
  let matchedCase = null;
  let matchedIndex = -1;
  for (let i = 0; i < cases.length; i++) {
    const caseValue = renderTemplate(cases[i].value ?? '', ctx.templateCtx);
    if (String(caseValue) === String(value)) {
      matchedCase = cases[i];
      matchedIndex = i;
      break;
    }
  }

  if (matchedCase) {
    ctx.log('info', `Switch ${node.id}: "${value}" matched case ${matchedIndex} (${matchedCase.label || matchedCase.value})`);
    return { next: ctx.nextEdge(node.id, `case-${matchedIndex}`) };
  }

  // Default case
  if (d.defaultCase !== false) {
    ctx.log('info', `Switch ${node.id}: "${value}" → default case`);
    return { next: ctx.nextEdge(node.id, 'default') };
  }

  ctx.log('warn', `Switch ${node.id}: "${value}" matched no case and no default.`);
  return { next: ctx.nextEdge(node.id) };
}

async function execFunction(ctx, node) {
  // Intentionally unavailable until an isolated code-runner service exists.
  // Never execute flow-authored JavaScript inside the API/runtime process.
  ctx.log('error', `Function node ${node.id} is disabled until isolated code execution is available.`);
  return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
}

async function execParallel(ctx, node) {
  if (!config.allowExperimentalParallelNodes) {
    ctx.log('error', `Parallel node ${node.id} is disabled until durable branch orchestration is available.`);
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
  const d = node.data || {};
  const branches = d.branches || [];
  const waitForAll = d.waitForAll !== false;
  const timeoutMs = Math.min(Number(d.timeoutMs) || 30000, 120000);

  if (!branches.length) {
    ctx.log('warn', `Parallel node ${node.id} has no branches.`);
    return { next: ctx.nextEdge(node.id) };
  }

  // For now, we'll execute branches sequentially but track them
  // Full parallel execution would require major engine changes
  // This implementation runs each branch and collects results
  
  const results = [];
  const startTime = Date.now();

  for (const branch of branches) {
    if (Date.now() - startTime > timeoutMs) {
      ctx.log('warn', `Parallel node ${node.id}: timeout reached`);
      break;
    }
    
    const nextNodeId = ctx.nextEdge(node.id, `branch-${branch.id}`);
    if (nextNodeId) {
      // We can't easily run sub-flows in the current architecture
      // For now, log and continue
      ctx.log('info', `Parallel branch ${branch.label || branch.id} would start at ${nextNodeId}`);
      results.push({ branchId: branch.id, status: 'started', nextNode: nextNodeId });
    }
  }

  // Store parallel state for potential continuation
  if (!ctx.session.parallelState) ctx.session.parallelState = {};
  ctx.session.parallelState[node.id] = { branches: results, waitForAll, startTime };

  ctx.log('info', `Parallel ${node.id}: ${branches.length} branches initiated`);
  
  // Continue to first branch or next node
  const firstBranch = branches[0];
  if (firstBranch) {
    const nextNodeId = ctx.nextEdge(node.id, `branch-${firstBranch.id}`);
    if (nextNodeId) return { next: nextNodeId };
  }
  
  return { next: ctx.nextEdge(node.id) };
}

async function execWebhook(ctx, node) {
  if (!config.allowExperimentalWebhookNodes) {
    ctx.log('error', `Webhook node ${node.id} is disabled until external webhook routing is available.`);
    return { next: ctx.nextEdge(node.id, 'error') || ctx.nextEdge(node.id) };
  }
  const d = node.data || {};
  // This node is primarily a trigger entry point
  // When a webhook hits the endpoint, it creates/resumes a session at this node
  // The actual webhook handling is done in the routes layer
  ctx.log('info', `Webhook trigger ${node.id} activated`);
  
  // Save webhook payload if configured
  if (d.saveAs && ctx.webhookData) {
    ctx.vars[d.saveAs] = ctx.webhookData;
    ctx.recordNodeValue(node, d.saveAs, ctx.webhookData);
  }
  
  // Continue to next node
  return { next: ctx.nextEdge(node.id, 'triggered') };
}

async function execLog(ctx, node) {
  const d = node.data || {};
  const level = d.level || 'info';
  const message = renderTemplate(d.message || 'Log entry', ctx.templateCtx);
  
  // Prepare structured data
  let logData = { ...d.data };
  
  // Render templates in data
  for (const [key, value] of Object.entries(logData)) {
    if (typeof value === 'string') {
      logData[key] = renderTemplate(value, ctx.templateCtx);
    }
  }
  
  // Include all variables if requested
  if (d.includeVars !== false) {
    logData._vars = { ...ctx.vars };
  }
  
  // Add context
  logData._nodeId = node.id;
  logData._chatId = ctx.chatId;
  logData._timestamp = new Date().toISOString();
  
  ctx.log(level, message, logData);
  
  return { next: ctx.nextEdge(node.id) };
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
  // Advanced Logic
  loop: execLoop,
  switch: execSwitch,
  function: execFunction,
  parallel: execParallel,
  // Integration
  webhook: execWebhook,
  // Observability
  log: execLog,
};