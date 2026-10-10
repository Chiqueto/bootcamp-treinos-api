import type z from "zod";

import { planDTO } from "../domain/admin-dto.js";
import { prisma } from "../lib/db.js";
import { AdminError, assertAdminUser } from "../lib/require-admin.js";
import { AdminEntitlementsBody, AdminPlanPatch } from "../schemas/admin.js";

export class ManageAdminPlan {
  async update(adminUserId: string, planId: string, input: z.input<typeof AdminPlanPatch>) {
    const data = AdminPlanPatch.parse(input);
    return prisma.$transaction(async tx => {
      await assertAdminUser(tx, adminUserId);
      await tx.$queryRaw`SELECT id FROM "Plan" WHERE id = ${planId} FOR UPDATE`;
      const before = await tx.plan.findUnique({ where: { id: planId }, include: { entitlements: true } });
      if (!before) throw new AdminError("PLAN_NOT_FOUND", 404);
      // INTERNAL must remain outside the public catalogue.
      if (before.audience === "INTERNAL" && data.isPublic === true) throw new AdminError("INTERNAL_PLAN_PRIVATE");
      const after = await tx.plan.update({ where: { id: planId }, data, include: { entitlements: true } });
      await tx.adminAuditLog.create({ data: { adminUserId, action: "PLAN_UPDATED", entityType: "PLAN", entityId: planId,
        before: planDTO(before), after: planDTO(after) } });
      return planDTO(after);
    });
  }
  async entitlements(adminUserId: string, planId: string, input: z.input<typeof AdminEntitlementsBody>) {
    const data = AdminEntitlementsBody.parse(input);
    return prisma.$transaction(async tx => {
      await assertAdminUser(tx, adminUserId);
      await tx.$queryRaw`SELECT id FROM "Plan" WHERE id = ${planId} FOR UPDATE`;
      const before = await tx.plan.findUnique({ where: { id: planId }, include: { entitlements: true } });
      if (!before) throw new AdminError("PLAN_NOT_FOUND", 404);
      await tx.planEntitlement.deleteMany({ where: { planId } });
      if (data.entitlements.length) await tx.planEntitlement.createMany({ data: data.entitlements.map(e => ({ ...e, planId })) });
      const after = await tx.plan.findUniqueOrThrow({ where: { id: planId }, include: { entitlements: true } });
      await tx.adminAuditLog.create({ data: { adminUserId, action: "PLAN_ENTITLEMENTS_UPDATED", entityType: "PLAN", entityId: planId,
        before: planDTO(before), after: planDTO(after) } });
      return planDTO(after);
    });
  }
}
