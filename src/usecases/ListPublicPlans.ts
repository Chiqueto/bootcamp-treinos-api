import { prisma } from "../lib/db.js";

export class ListPublicPlans {
  async execute({ audience }: { audience: "ATHLETE" | "COACH" }) {
    return prisma.plan.findMany({
      where: { audience, isPublic: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        code: true,
        name: true,
        description: true,
        monthlyPriceInCents: true,
        currency: true,
        entitlements: {
          select: { entitlement: true, limitValue: true },
          orderBy: { entitlement: "asc" },
        },
      },
    });
  }
}
