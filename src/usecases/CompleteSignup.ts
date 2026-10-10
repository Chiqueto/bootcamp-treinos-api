import { assertSignupPlan, CommercialError } from "../domain/commercial.js";
import { prisma } from "../lib/db.js";
import { hashSignupToken } from "./CreateSignupIntent.js";

export class CompleteSignup {
  async execute({ userId, token }: { userId: string; token: string }) {
    return prisma.$transaction(async (tx) => {
      // Serialize competing intents for the same user, then competing users for the same intent.
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new CommercialError("USER_NOT_FOUND", 404);
      if (user.accountSetupCompletedAt)
        throw new CommercialError("ACCOUNT_ALREADY_INITIALIZED", 409);
      const tokenHash = hashSignupToken(token);
      await tx.$queryRaw`SELECT id FROM "SignupIntent" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const intent = await tx.signupIntent.findUnique({ where: { tokenHash } });
      if (!intent) throw new CommercialError("INVALID_SIGNUP_INTENT");
      if (intent.consumedAt)
        throw new CommercialError("SIGNUP_INTENT_CONSUMED", 409);
      const now = new Date();
      if (intent.expiresAt <= now)
        throw new CommercialError("SIGNUP_INTENT_EXPIRED");
      // Lock price/publication metadata through subscription creation.
      await tx.$queryRaw`SELECT id FROM "Plan" WHERE id = ${intent.planId} FOR SHARE`;
      const plan = await tx.plan.findUnique({ where: { id: intent.planId } });
      assertSignupPlan(plan, intent.accountType);
      await tx.subscription.create({
        data: {
          userId,
          planId: plan.id,
          status: intent.accountType === "ATHLETE" ? "ACTIVE" : "PENDING",
          billingProvider: "NONE",
          priceInCentsSnapshot: plan.monthlyPriceInCents,
          currencySnapshot: plan.currency,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { accountType: intent.accountType, accountSetupCompletedAt: now },
      });
      await tx.signupIntent.update({
        where: { id: intent.id },
        data: { consumedAt: now },
      });
      return {
        accountType: intent.accountType,
        accountSetupCompletedAt: now.toISOString(),
      };
    });
  }
}
