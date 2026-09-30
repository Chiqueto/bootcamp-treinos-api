-- Task 2.1C — Hardening de Estado da Periodização

-- 1. PeriodizationPlan: conclusão exige ativação
-- Impede completedAt != null quando activatedAt == null
ALTER TABLE "PeriodizationPlan" ADD CONSTRAINT "PeriodizationPlan_completed_requires_activated_check" CHECK (
  "completedAt" IS NULL OR "activatedAt" IS NOT NULL
);

-- 2. Periodization: conclusão exige início
-- Impede completedAt != null quando startedAt == null
ALTER TABLE "Periodization" ADD CONSTRAINT "Periodization_completed_requires_started_check" CHECK (
  "completedAt" IS NULL OR "startedAt" IS NOT NULL
);

-- 3. Periodization: ativa exige startedAt
-- Impede isActive = true quando startedAt == null
ALTER TABLE "Periodization" ADD CONSTRAINT "Periodization_active_requires_started_check" CHECK (
  "isActive" = FALSE OR "startedAt" IS NOT NULL
);
