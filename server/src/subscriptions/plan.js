import { z } from 'zod';

const durationUnit = z.enum(['days', 'weeks', 'months']);
const planObject = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(''),
  duration_value: z.number().int().min(1).max(3650).optional(),
  duration_unit: durationUnit.optional(),
  is_lifetime: z.boolean().optional().default(false),
  price_stars: z.number().int().min(1).max(10000),
  price_fiat_amount: z.number().positive().max(1_000_000).optional(),
  price_fiat_currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional().default('USD'),
  crypto_currency: z.string().trim().regex(/^[A-Za-z0-9_-]{2,32}$/).transform((value) => value.toLowerCase()).optional().default('usdttrc20'),
});

export const createPlanSchema = planObject.superRefine((value, ctx) => {
  if (value.is_lifetime && (value.duration_value !== undefined || value.duration_unit !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Lifetime plans must not specify a duration.', path: ['is_lifetime'] });
  }
  if (!value.is_lifetime && (value.duration_value === undefined || value.duration_unit === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A duration is required unless this is a lifetime plan.', path: ['duration_value'] });
  }
});

export const updatePlanSchema = planObject.partial().superRefine((value, ctx) => {
  if (value.is_lifetime === true && (value.duration_value !== undefined || value.duration_unit !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Lifetime plans must not specify a duration.', path: ['is_lifetime'] });
  }
  if (value.duration_value !== undefined && value.duration_unit === undefined && value.is_lifetime !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration_unit is required when changing duration_value.', path: ['duration_unit'] });
  }
  if (value.duration_unit !== undefined && value.duration_value === undefined && value.is_lifetime !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration_value is required when changing duration_unit.', path: ['duration_value'] });
  }
});

export function publicEntitlement(entitlement) {
  return {
    id: entitlement.id,
    order_id: entitlement.order_id,
    chat_id: entitlement.chat_id,
    telegram_user_id: entitlement.telegram_user_id,
    status: entitlement.status,
    starts_at: entitlement.starts_at,
    expires_at: entitlement.expires_at,
    joined_at: entitlement.joined_at,
    removed_at: entitlement.removed_at,
    created_at: entitlement.created_at,
    updated_at: entitlement.updated_at,
  };
}

export function publicPlan(plan) {
  return {
    id: plan.id,
    chat_id: plan.chat_id,
    name: plan.name,
    description: plan.description || '',
    duration_value: plan.duration_value,
    duration_unit: plan.duration_unit,
    is_lifetime: Boolean(plan.is_lifetime),
    price_stars: plan.price_stars,
    price_fiat_amount: plan.price_fiat_amount,
    price_fiat_currency: plan.price_fiat_currency,
    crypto_currency: plan.crypto_currency,
    currency: plan.currency,
    active: Boolean(plan.active),
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };
}
