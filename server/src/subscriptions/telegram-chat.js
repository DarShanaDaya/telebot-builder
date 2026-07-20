import { TelegramError } from '../lib/telegram.js';

// The subscription bot must be an administrator with only the rights required
// by the selected access policy. This module contains no HTTP or database code
// so it can be exercised independently and reused by API/bot runtimes.
export const REQUIRED_ADMIN_RIGHTS = Object.freeze([
  'can_invite_users',
]);

export const ACCESS_ADMIN_RIGHTS = Object.freeze([
  'can_invite_users',
  'can_restrict_members',
]);

const isAdmin = (member) => member?.status === 'administrator' || member?.status === 'creator';

export function assertManagedChat(chat, member, { requireAccessRemoval = true } = {}) {
  if (!chat || !['channel', 'supergroup', 'group'].includes(chat.type)) {
    throw new Error('Only Telegram channels, groups, and supergroups can be managed.');
  }
  if (!isAdmin(member)) {
    throw new Error('The connecting Telegram user must be a chat administrator.');
  }
  if (requireAccessRemoval && member.status !== 'creator' && member.can_restrict_members !== true) {
    throw new Error('The connecting administrator must be allowed to restrict members.');
  }
  return true;
}

export function assertBotPermissions(botMember, { requireAccessRemoval = true } = {}) {
  if (!isAdmin(botMember)) {
    throw new Error('The subscription bot must be an administrator in the chat.');
  }
  if (botMember.status !== 'creator' && botMember.can_invite_users !== true) {
    throw new Error('The subscription bot needs permission to invite users.');
  }
  if (requireAccessRemoval && botMember.status !== 'creator' && botMember.can_restrict_members !== true) {
    throw new Error('The subscription bot needs permission to restrict or remove members.');
  }
  return true;
}

export async function verifyManagedChat(client, { chatId, telegramUserId, requireAccessRemoval = true } = {}) {
  if (chatId === undefined || chatId === null || String(chatId).trim() === '') {
    throw new Error('A Telegram chat ID is required.');
  }
  if (telegramUserId === undefined || telegramUserId === null) {
    throw new Error('A Telegram user ID is required.');
  }

  const [chat, creatorMember, me] = await Promise.all([
    client.getChat(chatId),
    client.getChatMember(chatId, telegramUserId),
    client.getMe(),
  ]);
  assertManagedChat(chat, creatorMember, { requireAccessRemoval });

  const botMember = await client.getChatMember(chat.id, me.id);
  assertBotPermissions(botMember, { requireAccessRemoval });

  return {
    chat,
    creatorMember,
    bot: me,
    botMember,
    permissions: {
      can_invite_users: botMember.status === 'creator' || botMember.can_invite_users === true,
      can_restrict_members: botMember.status === 'creator' || botMember.can_restrict_members === true,
    },
  };
}

export function telegramErrorMessage(error) {
  if (error instanceof TelegramError) return error.message;
  return error?.message || 'Telegram chat verification failed.';
}
