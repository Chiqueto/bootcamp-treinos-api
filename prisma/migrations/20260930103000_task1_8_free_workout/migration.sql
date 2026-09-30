-- DropForeignKey
ALTER TABLE "WorkoutSession" DROP CONSTRAINT IF EXISTS "WorkoutSession_workoutDayId_fkey";

-- AlterTable
ALTER TABLE "WorkoutSession" ALTER COLUMN "workoutDayId" DROP NOT NULL;

-- AddForeignKey with ON DELETE SET NULL
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_workoutDayId_fkey" FOREIGN KEY ("workoutDayId") REFERENCES "WorkoutDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
