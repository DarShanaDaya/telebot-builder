import { Router } from 'express';
import { db } from '../db/index.js';
import { verifyNowPaymentsSignature } from './nowpayments.js';
import { createEntitlementForPaidOrder } from './checkout.js';
import { getSubscriptionBotClient, issueEntitlementInvite } from './system-bot.js';

export function nowPaymentsWebhookRouter() {
  const r = Router();
  r.post('/nowpayments', async (req, res) => {
    const signature = req.get('x-nowpayments-sig');
    if (!verifyNowPaymentsSignature(req.body, signature)) return res.sendStatus(401);
    const paymentId = String(req.body?.payment_id || '');
    if (!paymentId) return res.sendStatus(400);
    try {
      const payment = await db.findSubscriptionPayment('nowpayments', paymentId);
      if (!payment) return res.sendStatus(200);
      const status = String(req.body.payment_status || 'unknown');
      const updated = await db.updateSubscriptionPayment(payment.id, {
        status,
        raw_event_json: JSON.stringify(req.body),
        updated_at: new Date().toISOString(),
      });
      if (status === 'finished') {
        const order = await db.getSubscriptionOrder(payment.order_id);
        if (order?.status === 'pending') await db.updateSubscriptionOrder(order.id, { status: 'paid', paid_at: new Date().toISOString() });
        if (order) {
          const entitlement = await db.getSubscriptionEntitlementByOrder(order.id) || await createEntitlementForPaidOrder({ ...order, status: 'pending' });
          const client = getSubscriptionBotClient();
          if (client && !['active', 'invite_issued'].includes(entitlement.status)) {
            await issueEntitlementInvite(order, entitlement, { chat: { id: order.telegram_user_id } }, client);
          }
        }
      }
      res.sendStatus(updated ? 200 : 500);
    } catch (error) {
      console.error('[nowpayments] webhook error:', error.message);
      res.sendStatus(500);
    }
  });
  return r;
}
