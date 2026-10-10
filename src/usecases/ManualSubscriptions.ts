import { subscriptionDTO } from "../domain/admin-dto.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AdminError, assertAdminUser } from "../lib/require-admin.js";
import { AdminAssignmentBody, AdminExtendBody, AdminTrialBody } from "../schemas/admin.js";

type ActorTarget = { adminUserId: string; userId: string };
type Operation = "trial" | "extend" | "activate" | "change" | "cancel";
const actions = { trial: "SUBSCRIPTION_TRIAL_GRANTED", extend: "SUBSCRIPTION_TRIAL_EXTENDED", activate: "SUBSCRIPTION_ACTIVATED", change: "SUBSCRIPTION_PLAN_CHANGED", cancel: "SUBSCRIPTION_CANCELED" } as const;

async function mutate({ adminUserId, userId }: ActorTarget, operation: Operation, input: { planId?: string; trialEndsAt?: string }) {
  return prisma.$transaction(async tx => {
    await assertAdminUser(tx, adminUserId);
    // Same lock order as signup. Also serializes the missing-subscription case.
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AdminError("USER_NOT_FOUND", 404);
    const before = await tx.subscription.findUnique({ where: { userId } });
    if (before?.billingProvider === "ASAAS") throw new AdminError("EXTERNAL_BILLING_MANAGED", 409);
    if (!user.accountSetupCompletedAt) throw new AdminError("ACCOUNT_SETUP_REQUIRED", 409);
    const now = new Date();
    let patch: Prisma.SubscriptionUncheckedUpdateInput = {};
    let assignment: { planId: string; priceInCentsSnapshot: number; currencySnapshot: string } | undefined;
    if (operation === "trial" || operation === "activate" || operation === "change") {
      const planId = input.planId!;
      await tx.$queryRaw`SELECT id FROM "Plan" WHERE id = ${planId} FOR SHARE`;
      const plan = await tx.plan.findUnique({ where: { id: planId } });
      if (!plan || !plan.isActive || plan.audience === "INTERNAL" || plan.audience !== user.accountType) throw new AdminError("PLAN_NOT_ELIGIBLE");
      assignment = { planId: plan.id, priceInCentsSnapshot: plan.monthlyPriceInCents, currencySnapshot: plan.currency };
      patch = { ...assignment };
    }
    if (operation === "trial" || operation === "extend") {
      const end = new Date(input.trialEndsAt!);
      if (!Number.isFinite(end.getTime()) || end <= now) throw new AdminError("INVALID_TRIAL_END");
      if (operation === "extend") {
        if (!before || before.billingProvider !== "MANUAL" || !["TRIALING", "EXPIRED"].includes(before.status) || !before.trialStartedAt) throw new AdminError("TRIAL_NOT_EXTENDABLE", 409);
        if (before.trialEndsAt && end <= before.trialEndsAt) throw new AdminError("TRIAL_MUST_BE_EXTENDED");
      }
      patch = { ...patch, status: "TRIALING", billingProvider: "MANUAL", trialStartedAt: operation === "trial" ? now : before!.trialStartedAt,
        trialEndsAt: end, currentPeriodStart: null, currentPeriodEnd: null, canceledAt: null };
    }
    if (operation === "activate") {
      // Preserve prior trial dates as history; ACTIVE access uses period fields, not trial dates.
      patch = { ...patch, billingProvider: "MANUAL", status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: null, canceledAt: null };
    }
    if (operation === "change") {
      if (!before || before.billingProvider !== "MANUAL") throw new AdminError("MANUAL_SUBSCRIPTION_REQUIRED", 409);
      // Changing a plan does not activate canceled/expired access or extend a trial.
    }
    if (operation === "cancel") {
      if (!before || before.billingProvider !== "MANUAL") throw new AdminError("MANUAL_SUBSCRIPTION_REQUIRED", 409);
      if (before.status === "CANCELED") throw new AdminError("SUBSCRIPTION_ALREADY_CANCELED", 409);
      patch = { status: "CANCELED", canceledAt: now };
    }
    const after = before
      ? await tx.subscription.update({ where: { userId }, data: patch })
      : await tx.subscription.create({ data: { userId, ...assignment!, billingProvider: "MANUAL", status: operation === "trial" ? "TRIALING" : "ACTIVE",
          trialStartedAt: operation === "trial" ? now : null, trialEndsAt: operation === "trial" ? new Date(input.trialEndsAt!) : null,
          currentPeriodStart: operation === "activate" ? now : null } });
    await tx.adminAuditLog.create({ data: {
      adminUserId, targetUserId: userId, action: actions[operation], entityType: "SUBSCRIPTION", entityId: after.id,
      before: before ? subscriptionDTO(before, true, now) : Prisma.JsonNull, after: subscriptionDTO(after, true, now),
    } });
    return subscriptionDTO(after, true, now);
  });
}
export class GrantManualTrial {
  execute(input: ActorTarget & { planId: string; trialEndsAt: string }) { return mutate(input, "trial", AdminTrialBody.parse({ planId: input.planId, trialEndsAt: input.trialEndsAt })); }
}
export class ExtendManualTrial {
  execute(input: ActorTarget & { trialEndsAt: string }) { return mutate(input, "extend", AdminExtendBody.parse({ trialEndsAt: input.trialEndsAt })); }
}
export class ActivateManualSubscription {
  execute(input: ActorTarget & { planId: string }) { return mutate(input, "activate", AdminAssignmentBody.parse({ planId: input.planId })); }
}
export class ChangeManualSubscriptionPlan {
  execute(input: ActorTarget & { planId: string }) { return mutate(input, "change", AdminAssignmentBody.parse({ planId: input.planId })); }
}
export class CancelManualSubscription {
  execute(input: ActorTarget) { return mutate(input, "cancel", {}); }
}
