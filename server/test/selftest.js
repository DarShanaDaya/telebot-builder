// End-to-end self test: boots the API on an ephemeral port against a temp
// SQLite database, walks the REST endpoints, then drives the flow engine with
// simulated Telegram updates via a mock Telegram client.
//
//   npm test --prefix server
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telebot-test-'));
// The integration HTTP node intentionally calls the local test API. Production
// defaults deny private-network egress; this is an explicit test-only opt-in.
process.env.ALLOW_PRIVATE_HTTP_TARGETS = 'true';
process.env.ALLOW_INSECURE_HTTP_TARGETS = 'true';

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : `  → ${extra}`}`);
};

// ---- imports (after env is set) -------------------------------------------
const { encryptString, decryptString, maskSecrets } = await import('../src/lib/crypto.js');
const { renderTemplate, evaluateCondition } = await import('../src/lib/template.js');
const { boundedPositiveInteger } = await import('../src/config.js');
const { db } = await import('../src/db/index.js');
const { buildApp } = await import('../src/index.js');
const { handleUpdate, makeBotLogger } = await import('../src/runtime/engine.js');
const { isPrivateIp } = await import('../src/runtime/actions.js');
const { TelegramClient } = await import('../src/lib/telegram.js');
const { verifyManagedChat, assertBotPermissions } = await import('../src/subscriptions/telegram-chat.js');
const { handleSubscriptionBotUpdate } = await import('../src/subscriptions/system-bot.js');
const { processSubscriptionJobs } = await import('../src/subscriptions/expiry-worker.js');
const { verifyNowPaymentsSignature } = await import('../src/subscriptions/nowpayments.js');

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
  check('step guard config rejects invalid values',
    boundedPositiveInteger('abc', 500, { min: 1, max: 5000 }) === 500
    && boundedPositiveInteger('Infinity', 500, { min: 1, max: 5000 }) === 500
    && boundedPositiveInteger('0', 500, { min: 1, max: 5000 }) === 500
    && boundedPositiveInteger('501', 500, { min: 1, max: 5000 }) === 501);
  check('HTTP egress identifies private and reserved targets',
    isPrivateIp('127.0.0.1') && isPrivateIp('10.0.0.1') && isPrivateIp('169.254.169.254')
    && isPrivateIp('192.168.1.1') && isPrivateIp('::1') && !isPrivateIp('8.8.8.8'));
  const nowPaymentPayload = { payment_id: 42, payment_status: 'finished', nested: { z: 2, a: 1 } };
  const crypto = await import('node:crypto');
  const signature = crypto.createHmac('sha512', 'ipn-secret').update(JSON.stringify({ nested: { a: 1, z: 2 }, payment_id: 42, payment_status: 'finished' })).digest('hex');
  check('NOWPayments IPN signature verification', verifyNowPaymentsSignature(nowPaymentPayload, signature, 'ipn-secret') && !verifyNowPaymentsSignature(nowPaymentPayload, 'bad', 'ipn-secret'));
}

// ---- Telegram subscription chat verification -------------------------------
console.log('\n■ subscription Telegram permissions');
{
  const calls = [];
  const telegram = new TelegramClient('test-token');
  telegram.call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getChat') return { id: '-1001', type: 'supergroup', title: 'Premium' };
    if (method === 'getMe') return { id: 9001, username: 'system_bot' };
    if (method === 'getChatMember' && String(params.user_id) === '777') {
      return { user: { id: 777 }, status: 'creator' };
    }
    if (method === 'getChatMember' && String(params.user_id) === '9001') {
      return { user: { id: 9001 }, status: 'administrator', can_invite_users: true, can_restrict_members: true };
    }
    throw new Error(`Unexpected Telegram method ${method}`);
  };
  const verified = await verifyManagedChat(telegram, { chatId: '-1001', telegramUserId: '777' });
  check('managed chat verification checks creator and bot permissions',
    verified.chat.id === '-1001' && verified.permissions.can_invite_users && verified.permissions.can_restrict_members);
  check('Telegram chat verification calls the expected Bot API methods',
    calls.map((call) => call.method).join(',') === 'getChat,getChatMember,getMe,getChatMember');
  let rejected = false;
  try {
    assertBotPermissions({ status: 'administrator', can_invite_users: true, can_restrict_members: false });
  } catch {
    rejected = true;
  }
  check('permission verifier rejects a bot without removal rights', rejected);
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

  const connectionResponse = await api('POST', '/api/subscriptions/connections', {}, token);
  check('subscription connection code is created', connectionResponse.status === 201
    && connectionResponse.json.code.length >= 16 && connectionResponse.json.expires_at);
  const connectionMessage = [];
  const connectionClient = { sendMessage: async (chatId, text) => connectionMessage.push({ chatId, text }) };
  const connectionUpdate = {
    update_id: 900,
    message: { chat: { id: 777, type: 'private' }, from: { id: 777 }, text: `/connect ${connectionResponse.json.code}` },
  };
  check('system bot consumes connection code and confirms linking',
    await handleSubscriptionBotUpdate(connectionUpdate, connectionClient) === true
    && connectionMessage[0]?.text.includes('Telegram account linked'));
  const chatWithoutBot = await api('POST', '/api/subscriptions/chats', { telegram_chat_id: '-1001' }, token);
  check('chat linking requires configured subscription bot', chatWithoutBot.status === 503);

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

  // Exercise portable credential requirements: the exporter must replace the
  // internal ID with a logical name/type reference and the importer must map it
  // back only to a credential owned by the destination account.
  flow.nodes.find((n) => n.id === 'msg-welcome').data.credentialId = cred.json.credential.id;
  const saved = await api('PUT', `/api/bots/${botId}/flow`, { flow }, token);
  check('save draft flow', saved.status === 200);

  const exported = await api('GET', `/api/bots/${botId}/flow/export`, null, token);
  check('flow export is portable and secret-free', exported.status === 200
    && exported.json.kind === 'telebot-builder/flow-export'
    && exported.json.schemaVersion === 1
    && exported.json.requirements.credentials.length === 1
    && !JSON.stringify(exported.json).includes('TEST-TOKEN')
    && !JSON.stringify(exported.json).includes(cred.json.credential.id));
  const missingCredentialArchive = structuredClone(exported.json);
  missingCredentialArchive.requirements.credentials[0].name = 'Missing credential';
  const missingCredentialImport = await api('POST', `/api/bots/${botId}/flow/import`, { archive: missingCredentialArchive }, token);
  check('flow import rejects missing credential mappings', missingCredentialImport.status === 422);
  const duplicateCredential = await api('POST', '/api/credentials', { name: 'OpenAI', type: 'openai', data: { apiKey: 'sk-test-duplicate-1234567890' } }, token);
  const credentialRef = exported.json.requirements.credentials[0].ref;
  const ambiguousImport = await api('POST', `/api/bots/${botId}/flow/import`, { archive: exported.json }, token);
  check('flow import rejects ambiguous credential mappings', ambiguousImport.status === 422);
  const previewImport = await api('POST', `/api/bots/${botId}/flow/import`, { archive: exported.json, credentialMap: { [credentialRef]: cred.json.credential.id }, dryRun: true }, token);
  check('flow import preflight validates without saving', previewImport.status === 200 && previewImport.json.dryRun === true && previewImport.json.flow.nodes.length === flow.nodes.length);
  const imported = await api('POST', `/api/bots/${botId}/flow/import`, { archive: exported.json, credentialMap: { [credentialRef]: cred.json.credential.id } }, token);
  check('flow import restores a validated draft', duplicateCredential.status === 201 && imported.status === 200 && imported.json.flow.nodes.length === flow.nodes.length);

  const val = await api('POST', `/api/bots/${botId}/flow/validate`, { flow }, token);
  check('flow validates clean', val.status === 200 && val.json.errors.length === 0, JSON.stringify(val.json.errors));

  const pub = await api('POST', `/api/bots/${botId}/flow/publish`, { flow }, token);
  check('publish flow', pub.status === 200, JSON.stringify(pub.json));

  const broken = await api('POST', `/api/bots/${botId}/flow/publish`, { flow: { nodes: [], edges: [] } }, token);
  check('publish rejects empty flow', broken.status === 422);

  const invalidReferenceFlow = structuredClone(flow);
  invalidReferenceFlow.nodes.find((n) => n.id === 'input-1').data.variable = 'invalid.name';
  const invalidReference = await api('POST', `/api/bots/${botId}/flow/publish`, { flow: invalidReferenceFlow }, token);
  check('publish rejects invalid named-value identifiers', invalidReference.status === 422);

  const unsupportedNodeFlow = structuredClone(flow);
  unsupportedNodeFlow.nodes.push({ id: 'unknown-1', type: 'future_node', position: { x: 0, y: 0 }, data: {} });
  unsupportedNodeFlow.edges.push({ id: 'e-unknown', source: 'msg-small', target: 'unknown-1' });
  const unsupportedNode = await api('POST', `/api/bots/${botId}/flow/publish`, { flow: unsupportedNodeFlow }, token);
  check('publish rejects unsupported node types', unsupportedNode.status === 422);

  const malformedFlow = await api('POST', `/api/bots/${botId}/flow/validate`, { flow: { nodes: [null], edges: [] } }, token);
  check('validation reports malformed flow JSON without a server error', malformedFlow.status === 200 && malformedFlow.json.errors.length > 0);

  // Ownership isolation
  const reg2 = await api('POST', '/api/auth/register', { email: 'eve@example.com', password: 'password123' });
  const stolen = await api('GET', `/api/bots/${botId}`, null, reg2.json.token);
  check('other users cannot see the bot', stolen.status === 404);

  botRow = await db.getBot(botId);
  check('processed update claim de-duplicates delivery IDs',
    await db.claimUpdate(botId, 'test-update-1') === true && await db.claimUpdate(botId, 'test-update-1') === false);

  // Subscription repository vertical slice: rows are tenant-owned, plan terms
  // are snapshotted onto orders, and payment/entitlement records are linked.
  const owner = await db.findUserByEmail('ada@example.com');
  const now = new Date().toISOString();
  const subscriptionChat = await db.createSubscriptionChat({
    id: 'sub-chat-1', user_id: owner.id, telegram_chat_id: '-100123', chat_type: 'supergroup',
    title: 'Premium', username: null, permissions_json: JSON.stringify({ can_invite_users: true }),
    created_at: now, updated_at: now,
  });
  const plan = await db.createSubscriptionPlan({
    id: 'sub-plan-1', chat_id: subscriptionChat.id, name: '30 days', description: 'Access',
    duration_value: 30, duration_unit: 'days', is_lifetime: false, price_stars: 500,
    currency: 'XTR', created_at: now, updated_at: now,
  });
  const order = await db.createSubscriptionOrder({
    id: 'sub-order-1', user_id: owner.id, plan_id: plan.id, chat_id: subscriptionChat.id,
    telegram_user_id: '777', status: 'pending', invoice_payload: 'sub-order-1-payload',
    plan_name_snapshot: plan.name, duration_value_snapshot: plan.duration_value,
    duration_unit_snapshot: plan.duration_unit, is_lifetime_snapshot: false,
    price_snapshot: plan.price_stars, currency_snapshot: plan.currency, created_at: now,
  });
  const payment = await db.createSubscriptionPayment({
    id: 'sub-payment-1', order_id: order.id, provider: 'telegram_stars',
    provider_payment_id: 'charge-1', provider_event_id: 'event-1', status: 'paid',
    amount: 500, currency: 'XTR', charge_id: 'charge-1', raw_event_json: '{}',
    created_at: now, updated_at: now,
  });
  const entitlement = await db.createSubscriptionEntitlement({
    id: 'sub-entitlement-1', order_id: order.id, chat_id: subscriptionChat.id,
    telegram_user_id: '777', status: 'active', starts_at: now, expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: now, updated_at: now,
  });
  check('subscription repository creates linked chat, plan, order, payment and entitlement',
    subscriptionChat.id === 'sub-chat-1' && plan.price_stars === 500
    && order.price_snapshot === 500 && payment.provider_payment_id === 'charge-1'
    && entitlement.order_id === order.id);
  check('subscription order payload lookup works',
    (await db.getSubscriptionOrderByPayload('sub-order-1-payload')).id === order.id);
  check('subscription payment lookup works',
    (await db.findSubscriptionPayment('telegram_stars', 'charge-1')).id === payment.id);
  check('subscription tenant listing is scoped',
    (await db.listSubscriptionChats('missing-user')).length === 0);
  check('subscription ownership lookups reject another tenant',
    await db.getSubscriptionChatForUser(subscriptionChat.id, 'missing-user') === null
    && await db.getSubscriptionPlanForUser(plan.id, 'missing-user') === null
    && await db.getSubscriptionOrderForUser(order.id, 'missing-user') === null
    && await db.getSubscriptionEntitlementForUser(entitlement.id, 'missing-user') === null);

  const planApi = await api('POST', `/api/subscriptions/chats/${subscriptionChat.id}/plans`, {
    name: 'Lifetime', description: 'Permanent access', is_lifetime: true, price_stars: 1000, price_fiat_amount: 25, price_fiat_currency: 'USD', crypto_currency: 'usdttrc20',
  }, token);
  check('plan API creates lifetime plan', planApi.status === 201
    && planApi.json.plan.is_lifetime === true && planApi.json.plan.duration_value === null
    && planApi.json.plan.price_fiat_amount === 25 && planApi.json.plan.crypto_currency === 'usdttrc20');
  const invalidPlanApi = await api('POST', `/api/subscriptions/chats/${subscriptionChat.id}/plans`, {
    name: 'Broken', price_stars: 100, duration_value: 30,
  }, token);
  check('plan API rejects missing duration unit', invalidPlanApi.status === 400);
  const plansApi = await api('GET', `/api/subscriptions/chats/${subscriptionChat.id}/plans`, null, token);
  check('plan API lists tenant plans', plansApi.status === 200 && plansApi.json.plans.length === 2);
  const deactivated = await api('DELETE', `/api/subscriptions/plans/${planApi.json.plan.id}`, null, token);
  check('plan deletion deactivates instead of deleting history', deactivated.status === 200 && deactivated.json.plan.active === false);
  const entitlementApi = await api('GET', `/api/subscriptions/chats/${subscriptionChat.id}/entitlements`, null, token);
  check('entitlement API lists tenant subscriptions', entitlementApi.status === 200 && entitlementApi.json.entitlements.length === 1);
  const manualGrantUnavailable = await api('POST', `/api/subscriptions/chats/${subscriptionChat.id}/grant`, { plan_id: plan.id, telegram_user_id: '888' }, token);
  check('manual grant requires configured subscription bot', manualGrantUnavailable.status === 503);
  const paymentApi = await api('GET', '/api/subscriptions/payments', null, token);
  check('payment API lists tenant payments', paymentApi.status === 200 && paymentApi.json.payments.length === 1);

  const invoiceCalls = [];
  const paymentClient = {
    sendInvoice: async (chatId, invoice) => { invoiceCalls.push({ method: 'sendInvoice', chatId, invoice }); return {}; },
    answerPreCheckoutQuery: async (...args) => { invoiceCalls.push({ method: 'pre_checkout', args }); },
    createChatInviteLink: async (chatId, extra) => { invoiceCalls.push({ method: 'invite', chatId, extra }); return { invite_link: 'https://t.me/+one-time-test' }; },
    banChatMember: async (chatId, userId) => { invoiceCalls.push({ method: 'ban', chatId, userId }); },
    unbanChatMember: async (chatId, userId) => { invoiceCalls.push({ method: 'unban', chatId, userId }); },
    revokeChatInviteLink: async (chatId, inviteLink) => { invoiceCalls.push({ method: 'revoke', chatId, inviteLink }); },
    sendMessage: async (chatId, text) => { invoiceCalls.push({ method: 'message', chatId, text }); },
  };
  await handleSubscriptionBotUpdate({ message: { chat: { id: 777, type: 'private' }, from: { id: 777 }, text: '/buy sub-plan-1' } }, paymentClient);
  const invoice = invoiceCalls.find((call) => call.method === 'sendInvoice')?.invoice;
  check('Stars checkout creates a pending invoice', invoice?.currency === 'XTR' && invoice?.prices?.[0]?.amount === 500);
  await handleSubscriptionBotUpdate({ pre_checkout_query: {
    id: 'pre-1', from: { id: 777 }, invoice_payload: invoice.payload, currency: 'XTR', total_amount: 500,
  } }, paymentClient);
  check('Stars pre-checkout is answered', invoiceCalls.some((call) => call.method === 'pre_checkout' && call.args[1] === true));
  const successful = { message: {
    chat: { id: 777, type: 'private' }, from: { id: 777 },
    successful_payment: { invoice_payload: invoice.payload, currency: 'XTR', total_amount: 500, telegram_payment_charge_id: 'stars-charge-1' },
  } };
  await handleSubscriptionBotUpdate(successful, paymentClient);
  const paidOrder = await db.getSubscriptionOrderByPayload(invoice.payload);
  const paidEntitlement = await db.getSubscriptionEntitlementByOrder(paidOrder.id);
  check('successful Stars payment creates an entitlement and invite',
    paidOrder.status === 'paid' && paidEntitlement.status === 'invite_issued'
    && invoiceCalls.some((call) => call.method === 'invite'));
  const issuedInvite = await db.getSubscriptionInviteLinkByUrl('https://t.me/+one-time-test');
  await handleSubscriptionBotUpdate({ chat_member: {
    chat: { id: '-100123' }, from: { id: 777 },
    invite_link: { invite_link: issuedInvite.invite_link },
    new_chat_member: { status: 'member', user: { id: 777 } },
  } }, paymentClient);
  const activeEntitlement = await db.getSubscriptionEntitlement(paidEntitlement.id);
  check('membership update activates the entitlement and consumes invite',
    activeEntitlement.status === 'active' && issuedInvite && (await db.getSubscriptionInviteLinkByUrl(issuedInvite.invite_link)).status === 'used');
  await handleSubscriptionBotUpdate({ message: { chat: { id: 777, type: 'private' }, from: { id: 777 }, text: '/status' } }, paymentClient);
  check('system bot status command reports active subscriptions', invoiceCalls.some((call) => call.method === 'message' && call.text.includes('Your subscriptions')));
  await handleSubscriptionBotUpdate(successful, paymentClient);
  check('duplicate successful payment does not issue a second invite', invoiceCalls.filter((call) => call.method === 'invite').length === 1);
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  await db.updateSubscriptionEntitlement(paidEntitlement.id, { status: 'active', expires_at: expiredAt, updated_at: expiredAt });
  await db.upsertSubscriptionJob({ id: 'expire-job-1', job_type: 'expire', entity_id: paidEntitlement.id, run_at: expiredAt, created_at: expiredAt });
  await processSubscriptionJobs(paymentClient);
  const expiredEntitlement = await db.getSubscriptionEntitlement(paidEntitlement.id);
  check('expiry worker removes expired member and marks entitlement expired',
    expiredEntitlement.status === 'expired'
    && invoiceCalls.some((call) => call.method === 'ban')
    && invoiceCalls.some((call) => call.method === 'unban'));
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

  // A stale keyboard tap must not override a newer input wait.
  await run(cb(555, 'btn:btns-1:b', 31));
  session = await db.getSession(botRow.id, '555');
  check('stale callback cannot advance an input wait', session.status === 'awaiting_input' && session.node_id === 'input-1');

  // A keyboard from a pre-publish flow can reference a node that no longer
  // exists. It must be ignored without clearing the active wait.
  await run(cb(555, 'btn:removed-node:old-button', 32));
  session = await db.getSession(botRow.id, '555');
  check('missing-node callback cannot clear an active wait', session.status === 'awaiting_input' && session.node_id === 'input-1');

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
  await run(cb(557, 'btn:btns-1:a', 23));
  session = await db.getSession(botRow.id, '557');
  const currentPlan = JSON.parse(session.variables)._nodeValues?.plan || {};
  check('revisiting buttons replaces stale named choice values', currentPlan.collect === 'collect_number' && currentPlan.selected === 'collect' && !('goodbye' in currentPlan));

  // Logs were written and redact credential-shaped fields before persistence.
  log('info', 'redaction probe', 557, { apiKey: 'secret-key', nested: { token: 'secret-token', ok: true } });
  await Promise.resolve();
  const logs = await db.listLogs(botRow.id, { limit: 500 });
  check('engine wrote bot logs', logs.length > 5);
  check('logs contain button press + condition evaluation',
    logs.some((l) => l.message.includes('Button')) && logs.some((l) => l.message.includes('Condition')));
  const redactionLog = logs.find((l) => l.message === 'redaction probe');
  check('logs redact nested credential-shaped fields', redactionLog && !redactionLog.data.includes('secret-key') && !redactionLog.data.includes('secret-token') && redactionLog.data.includes('[REDACTED]'));

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
