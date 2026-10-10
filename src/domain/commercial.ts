import type {
  AccountType,
  EntitlementKey,
  Plan,
  Subscription,
} from "../generated/prisma/client.js";

export class CommercialError extends Error {
  constructor(
    public code: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(code);
  }
}

export function assertSignupPlan(
  plan: Plan | null,
  accountType: AccountType,
): asserts plan is Plan {
  if (
    !plan ||
    !plan.isActive ||
    !plan.isPublic ||
    plan.audience !== accountType ||
    (accountType === "ATHLETE" &&
      (plan.code !== "ATHLETE_FREE" || plan.monthlyPriceInCents !== 0))
  ) {
    throw new CommercialError("INVALID_SIGNUP_PLAN");
  }
}

export function subscriptionGrantsAccess(
  subscription: Subscription,
  now: Date,
): boolean {
  if (subscription.status === "TRIALING") {
    return (
      subscription.trialEndsAt !== null &&
      subscription.trialEndsAt > now &&
      (subscription.trialStartedAt === null ||
        subscription.trialStartedAt <= now)
    );
  }
  return (
    subscription.status === "ACTIVE" &&
    (subscription.currentPeriodStart === null ||
      subscription.currentPeriodStart <= now) &&
    (subscription.currentPeriodEnd === null ||
      subscription.currentPeriodEnd > now)
  );
}

type EntitledContext = {
  entitlements: { key: EntitlementKey; limitValue: number | null }[];
};

export function hasEntitlement(
  context: EntitledContext,
  key: EntitlementKey,
): boolean {
  return context.entitlements.some((entry) => entry.key === key);
}

// undefined = not granted; null = granted without a quantitative limit.
export function getEntitlementLimit(
  context: EntitledContext,
  key: EntitlementKey,
) {
  return context.entitlements.find((entry) => entry.key === key)?.limitValue;
}
