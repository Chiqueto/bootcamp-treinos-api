import {
  CommercialError,
  subscriptionGrantsAccess,
} from "../domain/commercial.js";
import { prisma } from "../lib/db.js";

export class GetCommercialContext {
  async execute({ userId, now = new Date() }: { userId: string; now?: Date }) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscription: {
          include: { plan: { include: { entitlements: true } } },
        },
      },
    });
    if (!user) throw new CommercialError("USER_NOT_FOUND", 404);
    const subscription = user.subscription;
    const plan = subscription?.plan;
    const granted =
      user.accountSetupCompletedAt !== null &&
      subscription &&
      plan &&
      subscriptionGrantsAccess(subscription, now);
    return {
      accountType: user.accountType,
      systemRole: user.systemRole,
      accountSetupCompletedAt:
        user.accountSetupCompletedAt?.toISOString() ?? null,
      plan: plan ? { code: plan.code, name: plan.name } : null,
      subscription: subscription
        ? {
            status: subscription.status,
            billingProvider: subscription.billingProvider,
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            currentPeriodEnd:
              subscription.currentPeriodEnd?.toISOString() ?? null,
            priceInCentsSnapshot: subscription.priceInCentsSnapshot,
            currencySnapshot: subscription.currencySnapshot,
          }
        : null,
      entitlements: granted
        ? plan.entitlements.map((e) => ({
            key: e.entitlement,
            limitValue: e.limitValue,
          }))
        : [],
    };
  }
}
