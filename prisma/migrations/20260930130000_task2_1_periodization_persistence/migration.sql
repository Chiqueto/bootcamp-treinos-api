-- 1. PRÉ-VALIDAÇÃO DE CONSISTÊNCIA
-- Garante que nenhum usuário possui múltiplos planos ativos antes de aplicar a restrição única
DO $$
DECLARE
  duplicate_active_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_active_count
  FROM (
    SELECT "userId"
    FROM "WorkoutPlan"
    WHERE "isActive" = TRUE
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) sub;

  IF duplicate_active_count > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Existem % usuários com múltiplos planos ativos ("isActive" = TRUE).', duplicate_active_count;
  END IF;
END $$;

-- 2. CRIAÇÃO DAS TABELAS
CREATE TABLE "Periodization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Periodization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PeriodizationPlan" (
    "id" TEXT NOT NULL,
    "periodizationId" TEXT NOT NULL,
    "workoutPlanId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "plannedStartDate" DATE,
    "plannedEndDate" DATE,
    "activatedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PeriodizationPlan_pkey" PRIMARY KEY ("id")
);

-- 3. CHAVES ESTRANGEIRAS
ALTER TABLE "Periodization" ADD CONSTRAINT "Periodization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PeriodizationPlan" ADD CONSTRAINT "PeriodizationPlan_periodizationId_fkey" FOREIGN KEY ("periodizationId") REFERENCES "Periodization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PeriodizationPlan" ADD CONSTRAINT "PeriodizationPlan_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. ÍNDICES CONVENCIONAIS E UNICIDADES
CREATE UNIQUE INDEX "PeriodizationPlan_workoutPlanId_key" ON "PeriodizationPlan"("workoutPlanId");

CREATE UNIQUE INDEX "PeriodizationPlan_periodizationId_order_key" ON "PeriodizationPlan"("periodizationId", "order");

CREATE INDEX "Periodization_userId_createdAt_idx" ON "Periodization"("userId", "createdAt");

-- 5. CHECK CONSTRAINTS
-- Periodization: concluída não pode permanecer ativa
ALTER TABLE "Periodization" ADD CONSTRAINT "Periodization_active_completed_check" CHECK (
  NOT ("isActive" = TRUE AND "completedAt" IS NOT NULL)
);

-- Periodization: completedAt >= startedAt quando ambos existirem
ALTER TABLE "Periodization" ADD CONSTRAINT "Periodization_timestamps_check" CHECK (
  "startedAt" IS NULL
  OR "completedAt" IS NULL
  OR "completedAt" >= "startedAt"
);

-- PeriodizationPlan: order > 0
ALTER TABLE "PeriodizationPlan" ADD CONSTRAINT "PeriodizationPlan_order_check" CHECK (
  "order" > 0
);

-- PeriodizationPlan: plannedEndDate >= plannedStartDate quando ambos existirem
ALTER TABLE "PeriodizationPlan" ADD CONSTRAINT "PeriodizationPlan_planned_dates_check" CHECK (
  "plannedStartDate" IS NULL
  OR "plannedEndDate" IS NULL
  OR "plannedEndDate" >= "plannedStartDate"
);

-- PeriodizationPlan: completedAt >= activatedAt quando ambos existirem
ALTER TABLE "PeriodizationPlan" ADD CONSTRAINT "PeriodizationPlan_timestamps_check" CHECK (
  "activatedAt" IS NULL
  OR "completedAt" IS NULL
  OR "completedAt" >= "activatedAt"
);

-- 6. ÍNDICES PARCIAIS POSTGRESQL
-- Um plano ativo por usuário
CREATE UNIQUE INDEX "WorkoutPlan_one_active_per_user"
ON "WorkoutPlan" ("userId")
WHERE "isActive" = TRUE;

-- Uma periodização ativa por usuário
CREATE UNIQUE INDEX "Periodization_one_active_per_user"
ON "Periodization" ("userId")
WHERE "isActive" = TRUE;

-- Um bloco aberto por periodização
CREATE UNIQUE INDEX "PeriodizationPlan_one_open_per_periodization"
ON "PeriodizationPlan" ("periodizationId")
WHERE "activatedAt" IS NOT NULL
AND "completedAt" IS NULL;
