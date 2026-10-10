BEGIN;
-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ATHLETE', 'COACH');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PlanAudience" AS ENUM ('ATHLETE', 'COACH', 'INTERNAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('NONE', 'MANUAL', 'ASAAS');

-- CreateEnum
CREATE TYPE "EntitlementKey" AS ENUM ('COACH_DASHBOARD', 'MANAGE_ATHLETES', 'ASSIGN_WORKOUTS', 'VIEW_ATHLETE_HISTORY', 'ADVANCED_STATS', 'AI_CHAT', 'AI_PLAN_GENERATION', 'SOURCE_LIBRARY');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "accountSetupCompletedAt" TIMESTAMPTZ,
ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'ATHLETE',
ADD COLUMN     "systemRole" "SystemRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" "PlanAudience" NOT NULL,
    "monthlyPriceInCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "entitlement" "EntitlementKey" NOT NULL,
    "limitValue" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "billingProvider" "BillingProvider" NOT NULL DEFAULT 'NONE',
    "priceInCentsSnapshot" INTEGER NOT NULL,
    "currencySnapshot" TEXT NOT NULL,
    "externalSubscriptionId" TEXT,
    "trialStartedAt" TIMESTAMPTZ,
    "trialEndsAt" TIMESTAMPTZ,
    "currentPeriodStart" TIMESTAMPTZ,
    "currentPeriodEnd" TIMESTAMPTZ,
    "canceledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupIntent" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "planId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlement_planId_entitlement_key" ON "PlanEntitlement"("planId", "entitlement");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_billingProvider_externalSubscriptionId_key" ON "Subscription"("billingProvider", "externalSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_userId_provider_key" ON "BillingCustomer"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_provider_externalCustomerId_key" ON "BillingCustomer"("provider", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "SignupIntent_tokenHash_key" ON "SignupIntent"("tokenHash");

-- CreateIndex
CREATE INDEX "SignupIntent_expiresAt_idx" ON "SignupIntent"("expiresAt");

-- AddForeignKey
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupIntent" ADD CONSTRAINT "SignupIntent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Plan" ADD CONSTRAINT "Plan_price_nonnegative" CHECK ("monthlyPriceInCents" >= 0);
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_limit_nonnegative" CHECK ("limitValue" IS NULL OR "limitValue" >= 0);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_price_nonnegative" CHECK ("priceInCentsSnapshot" >= 0);
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_external_provider" CHECK ("provider" <> 'NONE');
-- Insert-only bootstrap: an existing plan and its entitlements are never overwritten.
WITH inserted AS (
 INSERT INTO "Plan" ("id", "code", "name", "description", "audience", "monthlyPriceInCents", "currency", "isPublic", "isActive", "sortOrder", "updatedAt")
 VALUES
 ('commercial-athlete-free', 'ATHLETE_FREE', 'Atleta Grátis', 'Treinos individuais sem mensalidade.', 'ATHLETE', 0, 'BRL', true, true, 0, NOW()),
 ('commercial-coach', 'COACH', 'Coach', 'Planejamento e acompanhamento de até 5 atletas. Liberação manual nesta fase.', 'COACH', 3990, 'BRL', true, true, 10, NOW()),
 ('commercial-coach-ai', 'COACH_AI', 'Coach + AI', 'Até 15 atletas e recursos de IA. Liberação manual nesta fase.', 'COACH', 7990, 'BRL', true, true, 20, NOW()),
 ('commercial-internal', 'INTERNAL', 'Internal', 'Uso interno, atribuição exclusivamente confiável.', 'INTERNAL', 0, 'BRL', false, true, 100, NOW())
 ON CONFLICT ("code") DO NOTHING RETURNING "id", "code"
)
INSERT INTO "PlanEntitlement" ("id", "planId", "entitlement", "limitValue")
SELECT p."id" || '-' || e.key, p."id", e.key::"EntitlementKey",
 CASE WHEN e.key = 'MANAGE_ATHLETES' THEN CASE p."code" WHEN 'COACH' THEN 5 WHEN 'COACH_AI' THEN 15 ELSE NULL END ELSE NULL END
FROM inserted p CROSS JOIN (VALUES ('COACH_DASHBOARD'), ('MANAGE_ATHLETES'), ('ASSIGN_WORKOUTS'), ('VIEW_ATHLETE_HISTORY'), ('ADVANCED_STATS'), ('AI_CHAT'), ('AI_PLAN_GENERATION'), ('SOURCE_LIBRARY')) e(key)
WHERE p."code" IN ('COACH', 'COACH_AI', 'INTERNAL')
 AND (p."code" <> 'COACH' OR e.key NOT IN ('AI_CHAT', 'AI_PLAN_GENERATION', 'SOURCE_LIBRARY'))
ON CONFLICT ("planId", "entitlement") DO NOTHING;
-- Only users present at migration time are initialized. Future OAuth users retain NULL.
UPDATE "user" SET "accountSetupCompletedAt" = NOW() WHERE "accountSetupCompletedAt" IS NULL;
INSERT INTO "Subscription" ("id", "userId", "planId", "status", "billingProvider", "priceInCentsSnapshot", "currencySnapshot", "updatedAt")
SELECT 'legacy-' || u."id", u."id", p."id", 'ACTIVE', 'NONE', 0, 'BRL', NOW()
FROM "user" u CROSS JOIN "Plan" p WHERE p."code" = 'ATHLETE_FREE'
ON CONFLICT ("userId") DO NOTHING;
COMMIT;
