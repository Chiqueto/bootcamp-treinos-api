import z from "zod";

import { AccountType, AdminAuditAction, BillingProvider, EntitlementKey, PlanAudience, SubscriptionStatus, SystemRole } from "../generated/prisma/enums.js";
import { CommercialContextSchema } from "./commercial.js";
import { IsoTimestamp, OffsetIsoTimestamp } from "./iso-timestamp.js";

const id = z.string().min(1).max(200);
const date = IsoTimestamp.nullable();
export const AdminUserParams = z.strictObject({ userId: id });
export const AdminPlanParams = z.strictObject({ planId: id });
const pagination = { cursor: z.string().min(1).max(1000).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) };
const filters = { q: z.string().trim().max(120).optional(), accountType: z.enum(AccountType).optional(), planCode: z.string().max(80).optional() };
export const AdminUsersQuery = z.strictObject({ ...pagination, ...filters, subscriptionStatus: z.enum(SubscriptionStatus).optional() });
export const AdminSubscriptionsQuery = z.strictObject({ ...pagination, ...filters, status: z.enum(SubscriptionStatus).optional(), billingProvider: z.enum(BillingProvider).optional() });
export const AdminAuditQuery = z.strictObject({ ...pagination, action: z.enum(AdminAuditAction).optional(), adminUserId: id.optional(), targetUserId: id.optional(), entityType: z.enum(["PLAN", "SUBSCRIPTION"]).optional() });
export const AdminEntitlement = z.strictObject({ entitlement: z.enum(EntitlementKey), limitValue: z.number().int().min(0).max(2147483647).nullable() });
export const AdminEntitlementsBody = z.strictObject({ entitlements: z.array(AdminEntitlement).max(8).refine(v => new Set(v.map(e => e.entitlement)).size === v.length, "Duplicate entitlements") });
export const AdminPlanPatch = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(), description: z.string().max(1000).nullable().optional(),
  monthlyPriceInCents: z.number().int().min(0).max(2147483647).optional(), isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(2147483647).optional(),
}).refine(v => Object.keys(v).length > 0);
export const AdminTrialBody = z.strictObject({ planId: id, trialEndsAt: OffsetIsoTimestamp });
export const AdminAssignmentBody = z.strictObject({ planId: id });
export const AdminExtendBody = z.strictObject({ trialEndsAt: OffsetIsoTimestamp });
export const AdminCancelBody = z.strictObject({});
export const AdminIdentity = z.object({ id, name: z.string(), email: z.string(), image: z.string().nullable(), accountType: z.enum(AccountType), systemRole: z.enum(SystemRole), accountSetupCompletedAt: date, createdAt: IsoTimestamp });
export const AdminSubscription = z.object({
  id, planId: id, status: z.enum(SubscriptionStatus), billingProvider: z.enum(BillingProvider),
  priceInCentsSnapshot: z.number().int(), currencySnapshot: z.string(), trialStartedAt: date, trialEndsAt: date,
  currentPeriodStart: date, currentPeriodEnd: date, canceledAt: date, updatedAt: IsoTimestamp,
  accessActive: z.boolean(), trialExpired: z.boolean(),
});
export const AdminPlan = z.object({ id, code: z.string(), name: z.string(), description: z.string().nullable(), audience: z.enum(PlanAudience),
  monthlyPriceInCents: z.number().int(), currency: z.string(), isPublic: z.boolean(), isActive: z.boolean(), sortOrder: z.number().int(), entitlements: z.array(AdminEntitlement) });
const planSummary = z.object({ id, code: z.string(), name: z.string() });
export const AdminUser = AdminIdentity.extend({ plan: planSummary.nullable(), subscription: AdminSubscription.nullable() });
export const AdminUserDetail = AdminUser.extend({ commercialContext: CommercialContextSchema });
export const AdminSubscriptionItem = AdminSubscription.extend({ user: AdminIdentity, plan: planSummary });
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable(), hasMore: z.boolean() });
export const AdminUsersPage = page(AdminUser);
export const AdminSubscriptionsPage = page(AdminSubscriptionItem);
const auditSnapshot = z.record(z.string(), z.unknown()).nullable();
export const AdminAuditItem = z.object({ id, adminUserId: id, action: z.enum(AdminAuditAction), targetUserId: id.nullable(),
  entityType: z.string(), entityId: id.nullable(), before: auditSnapshot, after: auditSnapshot, metadata: auditSnapshot,
  createdAt: IsoTimestamp, admin: z.object({ id, name: z.string() }), targetUser: z.object({ id, name: z.string() }).nullable() });
export const AdminAuditPage = page(AdminAuditItem);
export const AdminOverview = z.object({ totalUsers: z.number().int(), totalAthletes: z.number().int(), totalCoaches: z.number().int(),
  pendingCoachSubscriptions: z.number().int(), activeManualSubscriptions: z.number().int(), activeTrials: z.number().int(),
  expiredTrials: z.number().int(), pendingCoaches: z.array(AdminUser) });
