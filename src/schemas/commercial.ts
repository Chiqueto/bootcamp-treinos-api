import z from "zod";

import {
  AccountType,
  BillingProvider,
  EntitlementKey,
  SubscriptionStatus,
  SystemRole,
} from "../generated/prisma/enums.js";
import { IsoTimestamp } from "./iso-timestamp.js";

export const SignupIntentBodySchema = z.strictObject({
  accountType: z.enum(AccountType),
  planCode: z.string().min(1).max(80),
});
export const CompleteSignupBodySchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const CompleteSignupResponseSchema = z.object({
  accountType: z.enum(AccountType),
  accountSetupCompletedAt: IsoTimestamp,
});
export const PublicPlansQuerySchema = z.strictObject({
  audience: z.enum(["ATHLETE", "COACH"]),
});
export const PublicPlanSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  monthlyPriceInCents: z.number().int().nonnegative(),
  currency: z.string(),
  entitlements: z.array(
    z.object({
      entitlement: z.enum(EntitlementKey),
      limitValue: z.number().int().nullable(),
    }),
  ),
});
export const SignupIntentResponseSchema = z.object({
  token: z.string(),
  expiresAt: IsoTimestamp,
});
export const CommercialContextSchema = z.object({
  accountType: z.enum(AccountType),
  systemRole: z.enum(SystemRole),
  accountSetupCompletedAt: IsoTimestamp.nullable(),
  plan: z.object({ code: z.string(), name: z.string() }).nullable(),
  subscription: z
    .object({
      status: z.enum(SubscriptionStatus),
      billingProvider: z.enum(BillingProvider),
      trialEndsAt: IsoTimestamp.nullable(),
      currentPeriodEnd: IsoTimestamp.nullable(),
      priceInCentsSnapshot: z.number().int(),
      currencySnapshot: z.string(),
    })
    .nullable(),
  entitlements: z.array(
    z.object({
      key: z.enum(EntitlementKey),
      limitValue: z.number().int().nullable(),
    }),
  ),
});
