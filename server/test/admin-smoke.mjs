// Standalone smoke test for the admin console + platform main subscription.
// Boots the API on an ephemeral port against a temp SQLite database.
//   node server/test/admin-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telebot-admin-'));
process.env.ADMIN_EMAILS = 'admin@example.com';

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond ? '' : `  → ${extra}`}`);
};

const { buildApp } = await import('../src/index.js');
const app = buildApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

const api = async (method, pathName, body, token) => {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

console.log('\n■ admin bootstrap & access control');
{
  const adminReg = await api('POST', '/api/auth/register', { email: 'admin@example.com', password: 'password123', name: 'Admin' });
  check('admin registers', adminReg.status === 201 && adminReg.json.token);
  const adminToken = adminReg.json.token;
  check('admin flag set from ADMIN_EMAILS', adminReg.json.user.is_admin === true);
  const me = await api('GET', '/api/auth/me', null, adminToken);
  check('me reflects admin role', me.json.user.is_admin === true);

  const userReg = await api('POST', '/api/auth/register', { email: 'user@example.com', password: 'password123', name: 'User' });
  const userToken = userReg.json.token;
  check('normal user is not admin', userReg.json.user.is_admin === false);

  const blocked = await api('GET', '/api/admin/users', null, userToken);
  check('non-admin blocked from admin API', blocked.status === 403);

  const anon = await api('GET', '/api/admin/users');
  check('unauthenticated admin API rejected', anon.status === 401);
}

console.log('\n■ admin user management');
let adminToken, userToken, user2Token;
{
  const adminLogin = await api('POST', '/api/auth/login', { email: 'admin@example.com', password: 'password123' });
  adminToken = adminLogin.json.token;
  const userReg = await api('POST', '/api/auth/register', { email: 'user2@example.com', password: 'password123', name: 'User2' });
  userToken = userReg.json.token;
  const user3 = await api('POST', '/api/auth/register', { email: 'user3@example.com', password: 'password123', name: 'User3' });
  user2Token = user3.json.token;

  const list = await api('GET', '/api/admin/users', null, adminToken);
  check('admin lists all users with counts', list.status === 200 && list.json.users.length >= 3
    && typeof list.json.users[0].counts.bots === 'number');

  const target = list.json.users.find((u) => u.email === 'user2@example.com');
  const promote = await api('PATCH', `/api/admin/users/${target.id}`, { is_admin: true }, adminToken);
  check('admin can promote a user', promote.status === 200 && promote.json.user.is_admin === true);
  const selfDemote = await api('PATCH', `/api/admin/users/${(await api('GET', '/api/auth/me', null, adminToken)).json.user.id}`, { is_admin: false }, adminToken);
  check('admin cannot remove own admin role', selfDemote.status === 403);

  const delSelf = await api('DELETE', `/api/admin/users/${(await api('GET', '/api/auth/me', null, adminToken)).json.user.id}`, null, adminToken);
  check('admin cannot delete own account', delSelf.status === 403);
}

console.log('\n■ admin bot management & cascade delete');
{
  const created = await api('POST', '/api/bots', { name: 'User Bot', token: '123456:TEST-TOKEN-OFFLINE', mode: 'polling', skipValidation: true }, userToken);
  const botId = created.json.bot.id;

  const allBots = await api('GET', '/api/admin/bots', null, adminToken);
  check('admin lists all bots with owner email', allBots.status === 200
    && allBots.json.bots.some((b) => b.id === botId && b.owner_email === 'user2@example.com'));

  const detail = await api('GET', `/api/admin/bots/${botId}`, null, adminToken);
  check('admin can view a user bot detail', detail.status === 200 && detail.json.bot.name === 'User Bot');

  const edit = await api('PATCH', `/api/admin/bots/${botId}`, { name: 'Renamed' }, adminToken);
  check('admin can edit a user bot', edit.status === 200 && edit.json.bot.name === 'Renamed');

  // Cascade: deleting the user removes their bot.
  const target = (await api('GET', '/api/admin/users', null, adminToken)).json.users.find((u) => u.email === 'user2@example.com');
  const del = await api('DELETE', `/api/admin/users/${target.id}`, null, adminToken);
  check('admin deletes a user (cascade)', del.status === 200);
  const afterBots = await api('GET', '/api/admin/bots', null, adminToken);
  check('deleted user bot is gone', !afterBots.json.bots.some((b) => b.id === botId));
  const stolen = await api('GET', `/api/bots/${botId}`, null, user2Token);
  check('deleted bot no longer accessible', stolen.status === 404);
}

console.log('\n■ platform main subscription (admin config + user read)');
{
  const put = await api('PUT', '/api/admin/subscriptions/main', {
    name: 'Platform Pro', description: 'Full access', duration_value: 30, duration_unit: 'days',
    price_stars: 750, price_fiat_amount: 12, price_fiat_currency: 'USD', crypto_currency: 'usdttrc20', is_lifetime: false, enabled: true,
  }, adminToken);
  check('admin configures main subscription', put.status === 200 && put.json.subscription.enabled === true
    && put.json.subscription.price_stars === 750);

  const getAdmin = await api('GET', '/api/admin/subscriptions/main', null, adminToken);
  check('admin reads main subscription', getAdmin.status === 200 && getAdmin.json.subscription.id === 'main');

  const userReads = await api('GET', '/api/subscriptions/main', null, user2Token);
  check('users see the enabled main subscription', userReads.status === 200 && userReads.json.subscription?.name === 'Platform Pro');

  const disabled = await api('PUT', '/api/admin/subscriptions/main', {
    name: 'Platform Pro', duration_value: 30, duration_unit: 'days', price_stars: 750, enabled: false,
  }, adminToken);
  check('admin can disable the main subscription', disabled.status === 200 && disabled.json.subscription.enabled === false);
  const userReadsOff = await api('GET', '/api/subscriptions/main', null, user2Token);
  check('disabled main subscription hidden from users', userReadsOff.json.subscription === null);
}

console.log('\n■ admin credentials & subscription chat views');
{
  const cred = await api('POST', '/api/credentials', { name: 'OpenAI', type: 'openai', data: { apiKey: 'sk-test-abc1234567890', model: 'gpt-4o-mini' } }, user2Token);
  const allCreds = await api('GET', '/api/admin/credentials', null, adminToken);
  check('admin lists all credentials (masked, owner shown)',
    allCreds.status === 200 && allCreds.json.credentials.some((c) => c.id === cred.json.credential.id && c.owner_email === 'user3@example.com')
    && !JSON.stringify(allCreds.json).includes('sk-test-abc'));

  const delCred = await api('DELETE', `/api/admin/credentials/${cred.json.credential.id}`, null, adminToken);
  check('admin deletes a credential', delCred.status === 200);
  const afterCreds = await api('GET', '/api/admin/credentials', null, adminToken);
  check('deleted credential is gone', !afterCreds.json.credentials.some((c) => c.id === cred.json.credential.id));

  const subs = await api('GET', '/api/admin/subscriptions', null, adminToken);
  check('admin lists subscription chats', subs.status === 200 && Array.isArray(subs.json.chats));
}

server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(60)}\n${results.length - failed.length}/${results.length} admin checks passed`);
if (failed.length) process.exit(1);
console.log('All admin checks passed ✅');
process.exit(0);
