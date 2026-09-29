-- CreateEnum
CREATE TYPE "SetType" AS ENUM ('WARMUP', 'WORKING');

-- AlterTable
ALTER TABLE "WorkoutExercise" ADD COLUMN     "exerciseId" TEXT;

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "athleteId" TEXT;

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionExercise" (
    "id" TEXT NOT NULL,
    "workoutSessionId" TEXT NOT NULL,
    "sourceWorkoutExerciseId" TEXT,
    "exerciseId" TEXT,
    "exerciseNameSnapshot" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "plannedSets" INTEGER,
    "plannedReps" INTEGER,
    "plannedRestTimeInSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SessionExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" TEXT NOT NULL,
    "sessionExerciseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "SetType" NOT NULL DEFAULT 'WORKING',
    "weightInGrams" INTEGER,
    "reps" INTEGER,
    "rir" INTEGER,
    "durationInSeconds" INTEGER,
    "notes" TEXT,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exercise_ownerUserId_name_idx" ON "Exercise"("ownerUserId", "name");

-- CreateIndex
CREATE INDEX "SessionExercise_workoutSessionId_order_idx" ON "SessionExercise"("workoutSessionId", "order");

-- CreateIndex
CREATE INDEX "SessionExercise_exerciseId_idx" ON "SessionExercise"("exerciseId");

-- CreateIndex
CREATE INDEX "WorkoutSet_sessionExerciseId_order_idx" ON "WorkoutSet"("sessionExerciseId", "order");

-- CreateIndex
CREATE INDEX "WorkoutExercise_exerciseId_idx" ON "WorkoutExercise"("exerciseId");

-- CreateIndex
CREATE INDEX "WorkoutSession_athleteId_startedAt_idx" ON "WorkoutSession"("athleteId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkoutSession_athleteId_completedAt_idx" ON "WorkoutSession"("athleteId", "completedAt");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExercise" ADD CONSTRAINT "SessionExercise_workoutSessionId_fkey" FOREIGN KEY ("workoutSessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExercise" ADD CONSTRAINT "SessionExercise_sourceWorkoutExerciseId_fkey" FOREIGN KEY ("sourceWorkoutExerciseId") REFERENCES "WorkoutExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExercise" ADD CONSTRAINT "SessionExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_sessionExerciseId_fkey" FOREIGN KEY ("sessionExerciseId") REFERENCES "SessionExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
