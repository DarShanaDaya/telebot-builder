import axios from 'axios';

export class TelegramError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
  }
}

// Thin wrapper around the Telegram Bot HTTP API. Used for both long-polling
// and webhook deployments so the runtime engine has a single consistent API.
export class TelegramClient {
  constructor(token) {
    this.token = token;
    this.http = axios.create({
      baseURL: `https://api.telegram.org/bot${token}`,
      timeout: 45000,
    });
  }

  async call(method, params = {}) {
    try {
      const { data } = await this.http.post(method, params);
      if (!data.ok) throw new TelegramError(data.description || 'Telegram API error', data.error_code);
      return data.result;
    } catch (err) {
      if (err instanceof TelegramError) throw err;
      const desc = err.response?.data?.description;
      const code = err.response?.data?.error_code;
      throw new TelegramError(desc || err.message, code);
    }
  }

  getMe() {
    return this.call('getMe');
  }

  getUpdates(offset, timeoutSec = 30, allowedUpdates = ['message', 'callback_query']) {
    return this.call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: allowedUpdates });
  }

  getChat(chatId) {
    return this.call('getChat', { chat_id: chatId });
  }

  getChatMember(chatId, userId) {
    return this.call('getChatMember', { chat_id: chatId, user_id: userId });
  }

  getChatAdministrators(chatId) {
    return this.call('getChatAdministrators', { chat_id: chatId });
  }

  createChatInviteLink(chatId, extra = {}) {
    return this.call('createChatInviteLink', { chat_id: chatId, ...extra });
  }

  revokeChatInviteLink(chatId, inviteLink) {
    return this.call('revokeChatInviteLink', { chat_id: chatId, invite_link: inviteLink });
  }

  banChatMember(chatId, userId, extra = {}) {
    return this.call('banChatMember', { chat_id: chatId, user_id: userId, ...extra });
  }

  unbanChatMember(chatId, userId, onlyIfBanned = true) {
    return this.call('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: onlyIfBanned });
  }

  approveChatJoinRequest(chatId, userId) {
    return this.call('approveChatJoinRequest', { chat_id: chatId, user_id: userId });
  }

  declineChatJoinRequest(chatId, userId) {
    return this.call('declineChatJoinRequest', { chat_id: chatId, user_id: userId });
  }

  // Sends a message; transparently retries without parse_mode when Telegram
  // rejects the HTML markup so a flow never dies because of a stray "<".
  async sendMessage(chatId, text, extra = {}) {
    const payload = { chat_id: chatId, text: String(text ?? '').slice(0, 4096) || '…', ...extra };
    try {
      return await this.call('sendMessage', { parse_mode: 'HTML', disable_web_page_preview: true, ...payload });
    } catch (err) {
      if (/can't parse entities|parse entities/i.test(err.message)) {
        return this.call('sendMessage', payload);
      }
      throw err;
    }
  }

  async sendPhoto(chatId, photo, extra = {}) {
    const payload = { chat_id: chatId, photo, ...extra };
    if (extra.caption) {
      try {
        return await this.call('sendPhoto', { ...payload, parse_mode: 'HTML' });
      } catch (err) {
        if (/can't parse entities|parse entities/i.test(err.message)) return this.call('sendPhoto', payload);
        throw err;
      }
    }
    return this.call('sendPhoto', payload);
  }

  sendChatAction(chatId, action = 'typing') {
    return this.call('sendChatAction', { chat_id: chatId, action }).catch(() => {});
  }

  answerCallbackQuery(id, text) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});
  }

  sendInvoice(chatId, invoice) {
    return this.call('sendInvoice', { chat_id: chatId, ...invoice });
  }

  answerPreCheckoutQuery(queryId, ok, errorMessage) {
    return this.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: queryId,
      ok,
      ...(ok ? {} : { error_message: errorMessage || 'Payment could not be verified.' }),
    });
  }

  refundStarPayment(userId, telegramPaymentChargeId) {
    return this.call('refundStarPayment', {
      user_id: userId,
      telegram_payment_charge_id: telegramPaymentChargeId,
    });
  }

  setWebhook(url, allowedUpdates = ['message', 'callback_query']) {
    return this.call('setWebhook', { url, allowed_updates: allowedUpdates, drop_pending_updates: true });
  }

  deleteWebhook() {
    return this.call('deleteWebhook', { drop_pending_updates: true }).catch(() => {});
  }
}

// Long-polling loop with backoff. Stops itself when the token is revoked (401)
// or when `stop()` is called.
export class Poller {
  constructor(client, onUpdate, log = () => {}, allowedUpdates = ['message', 'callback_query']) {
    this.client = client;
    this.onUpdate = onUpdate;
    this.log = log;
    this.allowedUpdates = allowedUpdates;
    this.running = false;
    this.offset = 0;
  }

  async start() {
    this.running = true;
    try {
      await this.client.deleteWebhook();
      // Skip backlog so redeploying a bot doesn't replay old conversations.
      const backlog = await this.client.getUpdates(undefined, 0, this.allowedUpdates);
      if (backlog.length) this.offset = backlog[backlog.length - 1].update_id + 1;
    } catch (err) {
      this.log('warn', `Could not reset update stream: ${err.message}`);
      if (err.code === 401) {
        this.running = false;
        this.log('error', 'Bot token is invalid or revoked. Bot stopped.');
        return;
      }
    }
    this.#loop();
  }

  async #loop() {
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset, 30, this.allowedUpdates);
        for (const update of updates) {
          this.offset = update.update_id + 1;
          Promise.resolve()
            .then(() => this.onUpdate(update))
            .catch((err) => this.log('error', `Update handler error: ${err.message}`));
        }
      } catch (err) {
        if (!this.running) break;
        this.log('error', `Polling error: ${err.message}`);
        if (err.code === 401) {
          this.running = false;
          this.log('error', 'Bot token is invalid or revoked. Bot stopped.');
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  stop() {
    this.running = false;
  }
}
