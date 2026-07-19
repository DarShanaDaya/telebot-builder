// End-to-end self test: boots the API on an ephemeral port against a temp
// SQLite database, walks the REST endpoints, then drives the flow engine with
// simulated Telegram updates via a mock Telegram client.
//
//   npm test --prefix server
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telebot-test-'));

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : `  → ${extra}`}`);
};

// ---- imports (after env is set) -------------------------------------------
const { encryptString, decryptString, maskSecrets } = await import('../src/lib/crypto.js');
const { renderTemplate, evaluateCondition } = await import('../src/lib/template.js');
const { db } = await import('../src/db/index.js');
const { buildApp } = await import('../src/index.js');
const { handleUpdate, makeBotLogger } = await import('../src/runtime/engine.js');

// ---- unit: crypto + templating ---------------------------------------------
console.log('\n■ crypto & templating');
{
  const enc = encryptString('123:secret-token');
  check('encrypt/decrypt roundtrip', decryptString(enc) === '123:secret-token');
  check('ciphertext is opaque', !enc.includes('secret'));
  const masked = maskSecrets({ apiKey: 'sk-abcdefghijklmnop' });
  check('masking shows only last 4', masked.apiKey.endsWith('mnop') && !masked.apiKey.includes('abcd'));
  check('template renders nested paths', renderTemplate('Hi {{first_name}}, total={{h.body.ok}}', { first_name: 'Ada', h: { body: { ok: true } } }) === 'Hi Ada, total=true');
  check('triple-brace node reference renders namespaced value', renderTemplate('{{{plan.standard}}}', { _nodeValues: { plan: { standard: 'standard' } } }) === 'standard');
  check('condition gt', evaluateCondition({ left: '{{num}}', op: 'gt', right: '10' }, { num: 15 }) === true);
  check('condition contains', evaluateCondition({ left: 'hello world', op: 'contains', right: 'WORLD' }, {}) === true);
}

// ---- API + engine -----------------------------------------------------------
const app = buildApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

const api = async (method, pathName, body, token) => {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

let botRow;
let flow;

console.log('\n■ REST API');
{
  const health = await api('GET', '/api/health');
  check('health check', health.status === 200 && health.json.ok);

  const reg = await api('POST', '/api/auth/register', { email: 'ada@example.com', password: 'password123', name: 'Ada' });
  check('register', reg.status === 201 && reg.json.token);
  const token = reg.json.token;

  const badLogin = await api('POST', '/api/auth/login', { email: 'ada@example.com', password: 'wrong' });
  check('login rejects bad password', badLogin.status === 401);

  const me = await api('GET', '/api/auth/me', null, token);
  check('me', me.status === 200 && me.json.user.email === 'ada@example.com');

  const cred = await api('POST', '/api/credentials', { name: 'OpenAI', type: 'openai', data: { apiKey: 'sk-test-1234567890', model: 'gpt-4o-mini' } }, token);
  check('create credential', cred.status === 201);
  check('credential secrets masked', cred.json.credential.masked.apiKey.includes('••') && cred.json.credential.masked.apiKey.endsWith('7890'));

  const credList = await api('GET', '/api/credentials', null, token);
  check('list credentials', credList.status === 200 && credList.json.credentials.length === 1);

  // Offline environment: skip live Telegram validation.
  const created = await api('POST', '/api/bots', { name: 'Test Bot', token: '123456:TEST-TOKEN-OFFLINE', mode: 'polling', skipValidation: true }, token);
  check('create bot', created.status === 201, JSON.stringify(created.json));
  const botId = created.json.bot.id;
  check('bot token never exposed', !JSON.stringify(created.json.bot).includes('TEST-TOKEN'));

  // Build a flow exercising every executor type in one conversation.
  flow = {
    nodes: [
      { id: 'start-1', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'msg-welcome', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Welcome {{first_name}}!' } },
      { id: 'btns-1', type: 'buttons', position: { x: 0, y: 0 }, data: { nodeName: 'plan', text: 'Pick one:', saveAs: 'choice', buttons: [{ id: 'a', name: 'collect', label: 'Give number', value: 'collect_number' }, { id: 'b', name: 'goodbye', label: 'Bye', value: 'goodbye' }] } },
      { id: 'input-1', type: 'input', position: { x: 0, y: 0 }, data: { nodeName: 'amount', prompt: 'Enter a number', variable: 'num', validation: 'number', retryText: 'Numbers only!' } },
      { id: 'cond-1', type: 'condition', position: { x: 0, y: 0 }, data: { left: '{{num}}', op: 'gt', right: '10' } },
      { id: 'http-1', type: 'http', position: { x: 0, y: 0 }, data: { method: 'GET', url: `${BASE}/api/health`, saveAs: 'h' } },
      { id: 'set-1', type: 'setvar', position: { x: 0, y: 0 }, data: { name: 'verdict', value: 'big {{num}}' } },
      { id: 'msg-big', type: 'message', position: { x: 0, y: 0 }, data: { text: '{{verdict}} — choice={{{plan.collect}}} input={{{amount.num}}} api ok={{h.body.ok}} status={{h.status}}' } },
      { id: 'msg-small', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Small: {{num}}' } },
      { id: 'end-1', type: 'end', position: { x: 0, y: 0 }, data: { text: 'Bye {{first_name}}!' } },
    ],
    edges: [
      { id: 'e1', source: 'start-1', target: 'msg-welcome' },
      { id: 'e2', source: 'msg-welcome', target: 'btns-1' },
      { id: 'e3', source: 'btns-1', sourceHandle: 'btn-a', target: 'input-1' },
      { id: 'e4', source: 'btns-1', sourceHandle: 'btn-b', target: 'end-1' },
      { id: 'e5', source: 'input-1', target: 'cond-1' },
      { id: 'e6', source: 'cond-1', sourceHandle: 'true', target: 'http-1' },
      { id: 'e7', source: 'cond-1', sourceHandle: 'false', target: 'msg-small' },
      { id: 'e8', source: 'http-1', sourceHandle: 'success', target: 'set-1' },
      { id: 'e9', source: 'set-1', target: 'msg-big' },
      { id: 'e10', source: 'msg-big', target: 'end-1' },
      { id: 'e11', source: 'msg-small', target: 'end-1' },
    ],
  };

  const saved = await api('PUT', `/api/bots/${botId}/flow`, { flow }, token);
  check('save draft flow', saved.status === 200);

  const val = await api('POST', `/api/bots/${botId}/flow/validate`, { flow }, token);
  check('flow validates clean', val.status === 200 && val.json.errors.length === 0, JSON.stringify(val.json.errors));

  const pub = await api('POST', `/api/bots/${botId}/flow/publish`, { flow }, token);
  check('publish flow', pub.status === 200, JSON.stringify(pub.json));

  const broken = await api('POST', `/api/bots/${botId}/flow/publish`, { flow: { nodes: [], edges: [] } }, token);
  check('publish rejects empty flow', broken.status === 422);

  // Ownership isolation
  const reg2 = await api('POST', '/api/auth/register', { email: 'eve@example.com', password: 'password123' });
  const stolen = await api('GET', `/api/bots/${botId}`, null, reg2.json.token);
  check('other users cannot see the bot', stolen.status === 404);

  botRow = await db.getBot(botId);
}

// ---- engine walk-through with a mock Telegram client ------------------------
console.log('\n■ flow engine (mock transport)');
{
  const sent = [];
  const mock = {
    sendMessage: async (chatId, text, extra = {}) => { sent.push({ kind: 'message', chatId: String(chatId), text: String(text), extra }); },
    sendPhoto: async (chatId, photo, extra = {}) => { sent.push({ kind: 'photo', chatId: String(chatId), photo, extra }); },
    sendChatAction: async () => {},
    answerCallbackQuery: async () => {},
  };
  const log = makeBotLogger(botRow.id);
  const run = (update) => handleUpdate({ bot: botRow, client: mock, update, log });
  const msg = (chatId, text, updateId) => ({
    update_id: updateId,
    message: { message_id: updateId, chat: { id: chatId, type: 'private' }, from: { id: 1, first_name: 'Ada', username: 'ada' }, text, date: Date.now() / 1000 },
  });
  const cb = (chatId, data, updateId) => ({
    update_id: updateId,
    callback_query: { id: `cb${updateId}`, from: { id: 1, first_name: 'Ada', username: 'ada' }, message: { message_id: updateId - 1, chat: { id: chatId } }, data },
  });

  // Happy path: big number, HTTP node, variables, end.
  await run(msg(555, '/start', 1));
  const welcome = sent.filter((s) => s.text === 'Welcome Ada!');
  const buttons = sent.find((s) => s.text === 'Pick one:');
  check('on /start sends welcome + buttons', welcome.length === 1 && Boolean(buttons));
  const keyboard = buttons?.extra?.reply_markup?.inline_keyboard;
  check('inline keyboard has 2 buttons', keyboard?.length === 2 && keyboard[0][0].callback_data === 'btn:btns-1:a' && keyboard[0][0].text === 'Give number');

  let session = await db.getSession(botRow.id, '555');
  check('session waits for callback', session.status === 'awaiting_callback' && session.node_id === 'btns-1');

  const beforeCount = sent.length;
  await run(msg(555, 'hello?', 2));
  check('typing while awaiting buttons nudges', sent.length > beforeCount && sent[sent.length - 1].text.includes('buttons above'));

  await run(cb(555, 'btn:btns-1:a', 3));
  session = await db.getSession(botRow.id, '555');
  check('button routes to input prompt', session.status === 'awaiting_input' && sent[sent.length - 1].text === 'Enter a number');

  await run(msg(555, 'not-a-number', 4));
  check('invalid input retries', sent[sent.length - 1].text === 'Numbers only!');
  session = await db.getSession(botRow.id, '555');
  check('still awaiting input after retry', session.status === 'awaiting_input');

  await run(msg(555, '15', 5));
  session = await db.getSession(botRow.id, '555');
  const vars = JSON.parse(session.variables);
  const bigMsg = sent.find((s) => s.text.includes('api ok=true'));
  check('condition routed to HTTP node', Boolean(bigMsg));
  check('http result saved to variable', vars.h?.status === 200 && vars.h?.body?.ok === true, JSON.stringify(vars.h));
  check('setvar composed template', vars.verdict === 'big 15');
  check('button value and accepted input persist for following nodes',
    vars.choice === 'collect_number' && vars.last_button === 'Give number' && vars.last_button_value === 'collect_number' && vars.last_input === 15);
  check('message templates resolve forwarded values',
    bigMsg?.text.includes('big 15') && bigMsg?.text.includes('choice=collect_number') && bigMsg?.text.includes('input=15') && bigMsg?.text.includes('status=200'));
  check('session ended after end node', session.status === 'ended' && sent[sent.length - 1].text === 'Bye Ada!');

  // Small-number branch.
  await run(msg(556, '/start', 10));
  await run(cb(556, 'btn:btns-1:a', 11));
  await run(msg(556, '4', 12));
  session = await db.getSession(botRow.id, '556');
  check('false branch skips HTTP node', sent.some((s) => s.text === 'Small: 4') && session.status === 'ended');

  // "Bye" button goes straight to end node.
  await run(msg(557, '/start', 20));
  await run(cb(557, 'btn:btns-1:b', 21));
  session = await db.getSession(botRow.id, '557');
  check('bye button ends conversation', session.status === 'ended');

  // Restart after end.
  const before = sent.length;
  await run(msg(557, 'knock knock', 22));
  check('new message restarts finished session', sent.slice(before).some((s) => s.text === 'Welcome Ada!'));

  // Logs were written.
  const logs = await db.listLogs(botRow.id, { limit: 500 });
  check('engine wrote bot logs', logs.length > 5);
  check('logs contain button press + condition evaluation',
    logs.some((l) => l.message.includes('Button')) && logs.some((l) => l.message.includes('Condition')));

  // Sessions API surface.
  const token2 = (await api('POST', '/api/auth/login', { email: 'ada@example.com', password: 'password123' })).json.token;
  const sessions = await api('GET', `/api/bots/${botRow.id}/sessions`, null, token2);
  check('sessions API lists chats', sessions.status === 200 && sessions.json.sessions.length === 3);
  const cleared = await api('DELETE', `/api/bots/${botRow.id}/sessions/555`, null, token2);
  check('session reset works', cleared.status === 200 && (await db.getSession(botRow.id, '555')) === null);
}

// ---- summary -----------------------------------------------------------------
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  process.exit(1);
}
console.log('All checks passed ✅');
process.exit(0);
