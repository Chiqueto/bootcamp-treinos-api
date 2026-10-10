import { createHash, randomBytes } from "node:crypto";

import { assertSignupPlan } from "../domain/commercial.js";
import type { AccountType } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

export function hashSignupToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export class CreateSignupIntent {
  async execute({
    accountType,
    planCode,
  }: {
    accountType: AccountType;
    planCode: string;
  }) {
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    assertSignupPlan(plan, accountType);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    await prisma.signupIntent.create({
      data: {
        tokenHash: hashSignupToken(token),
        accountType,
        planId: plan.id,
        expiresAt,
      },
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }
}
