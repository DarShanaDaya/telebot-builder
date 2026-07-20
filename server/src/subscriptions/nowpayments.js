import crypto from 'node:crypto';
import axios from 'axios';
import { config } from '../config.js';

const api = axios.create({ baseURL: 'https://api.nowpayments.io/v1', timeout: 20_000 });

export function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function verifyNowPaymentsSignature(payload, signature, secret = config.nowPaymentsIpnSecret) {
  if (!secret || !signature || !payload) return false;
  const body = JSON.stringify(sortObject(payload));
  const expected = crypto.createHmac('sha512', secret).update(body).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createNowPaymentsPayment({ orderId, amount, priceCurrency = 'USD', payCurrency = 'usdttrc20', description }) {
  if (!config.nowPaymentsApiKey) throw new Error('NOWPayments is not configured.');
  const { data } = await api.post('/payment', {
    price_amount: amount,
    price_currency: priceCurrency.toLowerCase(),
    pay_currency: payCurrency.toLowerCase(),
    order_id: orderId,
    order_description: description,
    ...(config.nowPaymentsIpnUrl ? { ipn_callback_url: config.nowPaymentsIpnUrl } : {}),
  }, { headers: { 'x-api-key': config.nowPaymentsApiKey } });
  return data;
}

export async function getNowPaymentsPayment(paymentId) {
  if (!config.nowPaymentsApiKey) throw new Error('NOWPayments is not configured.');
  const { data } = await api.get(`/payment/${encodeURIComponent(paymentId)}`, { headers: { 'x-api-key': config.nowPaymentsApiKey } });
  return data;
}
