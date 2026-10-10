import type { Plan, PlanEntitlement, Subscription, User } from "../generated/prisma/client.js";
import { subscriptionGrantsAccess } from "./commercial.js";

export function planDTO(p: Plan & { entitlements: PlanEntitlement[] }) {
  return { id: p.id, code: p.code, name: p.name, description: p.description, audience: p.audience,
    monthlyPriceInCents: p.monthlyPriceInCents, currency: p.currency, isActive: p.isActive,
    isPublic: p.isPublic, sortOrder: p.sortOrder,
    entitlements: p.entitlements.map(e => ({ entitlement: e.entitlement, limitValue: e.limitValue })) };
}
// Allowlisted snapshots: never OAuth, headers, cookies, SignupIntent or external billing tokens.
export function subscriptionDTO(s: Subscription, setupComplete: boolean, now = new Date()) {
  return { id: s.id, planId: s.planId, status: s.status, billingProvider: s.billingProvider,
    priceInCentsSnapshot: s.priceInCentsSnapshot, currencySnapshot: s.currencySnapshot,
    trialStartedAt: s.trialStartedAt?.toISOString() ?? null, trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
    currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null, currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    canceledAt: s.canceledAt?.toISOString() ?? null, updatedAt: s.updatedAt.toISOString(),
    accessActive: setupComplete && subscriptionGrantsAccess(s, now),
    trialExpired: s.status === "TRIALING" && (s.trialEndsAt === null || s.trialEndsAt <= now) };
}
export function identityDTO(u: Pick<User, "id" | "name" | "email" | "image" | "accountType" | "systemRole" | "accountSetupCompletedAt" | "createdAt">) {
  return { id: u.id, name: u.name, email: u.email, image: u.image, accountType: u.accountType,
    systemRole: u.systemRole, accountSetupCompletedAt: u.accountSetupCompletedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString() };
}
