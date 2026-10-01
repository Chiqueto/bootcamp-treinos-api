-- AlterTable
ALTER TABLE "WorkoutExercise" ADD COLUMN "warmupSets" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SessionExercise" ADD COLUMN "plannedWarmupSets" INTEGER;
