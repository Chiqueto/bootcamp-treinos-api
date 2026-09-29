-- 1. BACKFILL DE WorkoutSession.athleteId
UPDATE "WorkoutSession"
SET "athleteId" = wp."userId"
FROM "WorkoutDay" wd
JOIN "WorkoutPlan" wp ON wd."workoutPlanId" = wp."id"
WHERE "WorkoutSession"."workoutDayId" = wd."id"
  AND "WorkoutSession"."athleteId" IS NULL;

-- 1.1 Validação: Abortar se houver qualquer sessão órfã (sem athleteId)
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count 
  FROM "WorkoutSession" 
  WHERE "athleteId" IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Abortando: Existem % sessões sem proprietário identificável (athleteId IS NULL).', orphan_count;
  END IF;
END $$;

-- 1.2 Validação: Abortar se houver atletas com múltiplas sessões abertas simultaneamente
DO $$
DECLARE
  duplicate_active_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_active_count
  FROM (
    SELECT "athleteId"
    FROM "WorkoutSession"
    WHERE "completedAt" IS NULL
    GROUP BY "athleteId"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_active_count > 0 THEN
    RAISE EXCEPTION 'Abortando: Existem % atletas com múltiplas sessões abertas simultaneamente (completedAt IS NULL).', duplicate_active_count;
  END IF;
END $$;

-- 1.3 Tornar athleteId obrigatório (NOT NULL)
ALTER TABLE "WorkoutSession" ALTER COLUMN "athleteId" SET NOT NULL;

-- 1.4 Adicionar índice parcial único: máximo de uma sessão aberta por atleta
CREATE UNIQUE INDEX "WorkoutSession_one_active_per_athlete"
ON "WorkoutSession" ("athleteId")
WHERE "completedAt" IS NULL;

-- 2. BACKFILL DE Exercise (apenas personalizados, vinculados a wp.userId)
INSERT INTO "Exercise" ("id", "name", "ownerUserId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  sub.canonical_name,
  sub.user_id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (wp."userId", LOWER(TRIM(we."name")))
    wp."userId" AS user_id,
    TRIM(we."name") AS canonical_name,
    LOWER(TRIM(we."name")) AS lower_name
  FROM "WorkoutExercise" we
  JOIN "WorkoutDay" wd ON we."workoutDayId" = wd."id"
  JOIN "WorkoutPlan" wp ON wd."workoutPlanId" = wp."id"
  WHERE we."name" IS NOT NULL AND TRIM(we."name") <> ''
  ORDER BY wp."userId", LOWER(TRIM(we."name")), we."createdAt" ASC
) sub
WHERE NOT EXISTS (
  SELECT 1 FROM "Exercise" e
  WHERE e."ownerUserId" = sub.user_id
    AND LOWER(TRIM(e."name")) = sub.lower_name
);

-- Vincular WorkoutExercise.exerciseId ao Exercise.id correspondente do dono do plano
UPDATE "WorkoutExercise"
SET "exerciseId" = e."id"
FROM "WorkoutDay" wd,
     "WorkoutPlan" wp,
     "Exercise" e
WHERE "WorkoutExercise"."workoutDayId" = wd."id"
  AND wd."workoutPlanId" = wp."id"
  AND e."ownerUserId" = wp."userId"
  AND LOWER(TRIM(e."name")) = LOWER(TRIM("WorkoutExercise"."name"))
  AND "WorkoutExercise"."exerciseId" IS NULL;

-- 3. CONSTRAINTS DE WorkoutSet
ALTER TABLE "WorkoutSet"
  ADD CONSTRAINT "WorkoutSet_weightInGrams_check" CHECK ("weightInGrams" IS NULL OR "weightInGrams" >= 0),
  ADD CONSTRAINT "WorkoutSet_reps_check" CHECK ("reps" IS NULL OR "reps" >= 0),
  ADD CONSTRAINT "WorkoutSet_rir_check" CHECK ("rir" IS NULL OR ("rir" >= 0 AND "rir" <= 10)),
  ADD CONSTRAINT "WorkoutSet_durationInSeconds_check" CHECK ("durationInSeconds" IS NULL OR "durationInSeconds" >= 0);
