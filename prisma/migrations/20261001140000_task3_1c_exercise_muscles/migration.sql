-- CreateEnum
CREATE TYPE "MuscleGroup" AS ENUM ('CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'FOREARMS', 'QUADRICEPS', 'HAMSTRINGS', 'GLUTES', 'ADDUCTORS', 'HIP_ABDUCTORS', 'CALVES', 'CORE');

-- CreateEnum
CREATE TYPE "MuscleRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateTable
CREATE TABLE "ExerciseMuscle" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "muscleGroup" "MuscleGroup" NOT NULL,
    "role" "MuscleRole" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseMuscle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseMuscle_exerciseId_muscleGroup_key" ON "ExerciseMuscle"("exerciseId", "muscleGroup");

-- CreateIndex
CREATE INDEX "ExerciseMuscle_muscleGroup_role_idx" ON "ExerciseMuscle"("muscleGroup", "role");

-- AddForeignKey
ALTER TABLE "ExerciseMuscle" ADD CONSTRAINT "ExerciseMuscle_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
