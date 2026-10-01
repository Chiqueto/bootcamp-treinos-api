-- 1. CreateEnum
CREATE TYPE "WorkoutSessionOrigin" AS ENUM ('PLANNED', 'FREE');

-- 2. AlterTable: Add columns to WorkoutSession
ALTER TABLE "WorkoutSession" ADD COLUMN "origin" "WorkoutSessionOrigin";
ALTER TABLE "WorkoutSession" ADD COLUMN "workoutPlanId" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN "workoutPlanNameSnapshot" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN "workoutDayNameSnapshot" TEXT;

-- 3. Backfill origin for existing sessions
-- Sessions linked to a WorkoutDay are PLANNED
UPDATE "WorkoutSession"
SET "origin" = 'PLANNED'
WHERE "workoutDayId" IS NOT NULL;

-- Sessions without a WorkoutDay are FREE
UPDATE "WorkoutSession"
SET "origin" = 'FREE'
WHERE "workoutDayId" IS NULL;

-- 4. Backfill historical snapshots for planned sessions
UPDATE "WorkoutSession" ws
SET 
  "workoutPlanId" = wd."workoutPlanId",
  "workoutDayNameSnapshot" = wd."name",
  "workoutPlanNameSnapshot" = wp."name"
FROM "WorkoutDay" wd
JOIN "WorkoutPlan" wp ON wp."id" = wd."workoutPlanId"
WHERE ws."workoutDayId" = wd."id"
  AND ws."origin" = 'PLANNED';

-- 5. Enforce NOT NULL on origin
ALTER TABLE "WorkoutSession" ALTER COLUMN "origin" SET NOT NULL;

-- 6. Add Foreign Key for workoutPlanId with SetNull on delete
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Create Indexes
-- Timeline index (partial index for completed sessions with composite pagination)
CREATE INDEX "WorkoutSession_athleteId_completedAt_id_desc_idx"
ON "WorkoutSession" ("athleteId", "completedAt" DESC, "id" DESC)
WHERE "completedAt" IS NOT NULL;

-- Index on workoutPlanId in WorkoutSession
CREATE INDEX "WorkoutSession_workoutPlanId_idx" ON "WorkoutSession"("workoutPlanId");

-- Exercise longitudinal history index on SessionExercise
CREATE INDEX "SessionExercise_exerciseId_workoutSessionId_idx" ON "SessionExercise"("exerciseId", "workoutSessionId");

-- Sets analytical index on WorkoutSet
CREATE INDEX "WorkoutSet_sessionExerciseId_type_completedAt_idx" ON "WorkoutSet"("sessionExerciseId", "type", "completedAt");
