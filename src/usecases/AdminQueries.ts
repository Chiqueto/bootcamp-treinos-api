import type z from "zod";

import { adminBoundary, adminPage } from "../domain/admin-cursor.js";
import { identityDTO, planDTO, subscriptionDTO } from "../domain/admin-dto.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AdminError, assertAdminUser } from "../lib/require-admin.js";
import { AdminAuditPage, AdminAuditQuery, AdminSubscriptionsQuery, AdminUsersQuery } from "../schemas/admin.js";
import { GetCommercialContext } from "./GetCommercialContext.js";

const identity = { id: true, name: true, email: true, image: true, accountType: true, systemRole: true, accountSetupCompletedAt: true, createdAt: true } satisfies Prisma.UserSelect;
const userSelect = { ...identity, subscription: { include: { plan: { select: { id: true, code: true, name: true } } } } } satisfies Prisma.UserSelect;
type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
function userDTO(u: SelectedUser) {
  return { ...identityDTO(u), plan: u.subscription?.plan ?? null, subscription: u.subscription ? subscriptionDTO(u.subscription, Boolean(u.accountSetupCompletedAt)) : null };
}
function search(q?: string): Prisma.UserWhereInput {
  return q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {};
}
const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];

export class AdminQueries {
  async overview(adminUserId: string) {
    await assertAdminUser(prisma, adminUserId);
    const now = new Date();
    const pending: Prisma.UserWhereInput = { accountType: "COACH", subscription: { is: { status: "PENDING" } } };
    const [totalUsers, totalAthletes, totalCoaches, pendingCoachSubscriptions, activeManualSubscriptions, activeTrials, expiredTrials, pendingUsers] = await prisma.$transaction([
      prisma.user.count(), prisma.user.count({ where: { accountType: "ATHLETE" } }), prisma.user.count({ where: { accountType: "COACH" } }),
      prisma.user.count({ where: pending }),
      prisma.subscription.count({ where: { billingProvider: "MANUAL", status: "ACTIVE", user: { accountSetupCompletedAt: { not: null } }, AND: [{ OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: now } }] }, { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] }] } }),
      prisma.subscription.count({ where: { status: "TRIALING", user: { accountSetupCompletedAt: { not: null } }, trialEndsAt: { gt: now }, OR: [{ trialStartedAt: null }, { trialStartedAt: { lte: now } }] } }),
      prisma.subscription.count({ where: { status: "TRIALING", OR: [{ trialEndsAt: { lte: now } }, { trialEndsAt: null }] } }),
      prisma.user.findMany({ where: pending, orderBy: order, take: 5, select: userSelect }),
    ]);
    return { totalUsers, totalAthletes, totalCoaches, pendingCoachSubscriptions, activeManualSubscriptions, activeTrials, expiredTrials, pendingCoaches: pendingUsers.map(userDTO) };
  }
  async users(adminUserId: string, input: z.input<typeof AdminUsersQuery>) {
    await assertAdminUser(prisma, adminUserId);
    const q = AdminUsersQuery.parse(input);
    const rows = await prisma.user.findMany({ where: { AND: [search(q.q), adminBoundary("users", q.cursor)], accountType: q.accountType,
      ...(q.subscriptionStatus || q.planCode ? { subscription: { is: { status: q.subscriptionStatus, plan: q.planCode ? { code: q.planCode } : undefined } } } : {}) },
      orderBy: order, take: q.limit + 1, select: userSelect });
    const page = adminPage("users", rows, q.limit);
    return { ...page, items: page.items.map(userDTO) };
  }
  async user(adminUserId: string, userId: string) {
    await assertAdminUser(prisma, adminUserId);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!u) throw new AdminError("USER_NOT_FOUND", 404);
    return { ...userDTO(u), commercialContext: await new GetCommercialContext().execute({ userId }) };
  }
  async plans(adminUserId: string) {
    await assertAdminUser(prisma, adminUserId);
    return (await prisma.plan.findMany({ include: { entitlements: { orderBy: { entitlement: "asc" } } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] })).map(planDTO);
  }
  async plan(adminUserId: string, planId: string) {
    await assertAdminUser(prisma, adminUserId);
    const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { entitlements: { orderBy: { entitlement: "asc" } } } });
    if (!plan) throw new AdminError("PLAN_NOT_FOUND", 404);
    return planDTO(plan);
  }
  async subscriptions(adminUserId: string, input: z.input<typeof AdminSubscriptionsQuery>) {
    await assertAdminUser(prisma, adminUserId);
    const q = AdminSubscriptionsQuery.parse(input);
    const rows = await prisma.subscription.findMany({ where: { ...adminBoundary("subscriptions", q.cursor), status: q.status, billingProvider: q.billingProvider,
      plan: q.planCode ? { code: q.planCode } : undefined, user: { ...search(q.q), accountType: q.accountType } },
      include: { user: { select: identity }, plan: { select: { id: true, code: true, name: true } } }, orderBy: order, take: q.limit + 1 });
    const page = adminPage("subscriptions", rows, q.limit);
    return { ...page, items: page.items.map(s => ({ ...subscriptionDTO(s, Boolean(s.user.accountSetupCompletedAt)), user: identityDTO(s.user), plan: s.plan })) };
  }
  async audit(adminUserId: string, input: z.input<typeof AdminAuditQuery>) {
    await assertAdminUser(prisma, adminUserId);
    const q = AdminAuditQuery.parse(input);
    const rows = await prisma.adminAuditLog.findMany({ where: { ...adminBoundary("audit", q.cursor), action: q.action, adminUserId: q.adminUserId, targetUserId: q.targetUserId, entityType: q.entityType },
      include: { admin: { select: { id: true, name: true } }, targetUser: { select: { id: true, name: true } } }, orderBy: order, take: q.limit + 1 });
    const page = adminPage("audit", rows, q.limit);
    return AdminAuditPage.parse({ ...page, items: page.items.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })) });
  }
}
