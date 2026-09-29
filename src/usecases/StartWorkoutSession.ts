import {
  ConflictError,
  NotFoundError,
  WorkoutPlanNotActiveError,
} from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
}

interface OutputDto {
  userWorkoutSessionId: string;
  exercises: Array<{
    id: string;
    sourceWorkoutExerciseId: string | null;
    exerciseId: string | null;
    exerciseNameSnapshot: string;
    order: number;
    plannedSets: number | null;
    plannedReps: number | null;
    plannedRestTimeInSeconds: number | null;
  }>;
}

export class StartWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    try {
      return await prisma.$transaction(async (tx) => {
        const workoutPlan = await tx.workoutPlan.findUnique({
          where: { id: dto.workoutPlanId },
        });

        if (!workoutPlan) {
          throw new NotFoundError("Workout plan not found");
        }

        if (workoutPlan.userId !== dto.userId) {
          throw new NotFoundError("Workout plan not found");
        }

        if (!workoutPlan.isActive) {
          throw new WorkoutPlanNotActiveError("Workout plan is not active");
        }

        const workoutDay = await tx.workoutDay.findFirst({
          where: { id: dto.workoutDayId, workoutPlanId: dto.workoutPlanId },
          include: {
            exercises: {
              orderBy: { order: "asc" },
            },
          },
        });

        if (!workoutDay) {
          throw new NotFoundError("Workout day not found");
        }

        const activeSession = await tx.workoutSession.findFirst({
          where: {
            athleteId: dto.userId,
            completedAt: null,
          },
        });

        if (activeSession) {
          throw new ConflictError("There is already a workout session in progress");
        }

        const session = await tx.workoutSession.create({
          data: {
            id: crypto.randomUUID(),
            workoutDayId: dto.workoutDayId,
            athleteId: dto.userId,
            startedAt: new Date(),
          },
        });

        const createdExercises: OutputDto["exercises"] = [];

        for (const exercise of workoutDay.exercises) {
          const created = await tx.sessionExercise.create({
            data: {
              id: crypto.randomUUID(),
              workoutSessionId: session.id,
              sourceWorkoutExerciseId: exercise.id,
              exerciseId: exercise.exerciseId ?? null,
              exerciseNameSnapshot: exercise.name,
              order: exercise.order,
              plannedSets: exercise.sets,
              plannedReps: exercise.reps,
              plannedRestTimeInSeconds: exercise.restTimeInSeconds,
            },
          });

          createdExercises.push({
            id: created.id,
            sourceWorkoutExerciseId: created.sourceWorkoutExerciseId,
            exerciseId: created.exerciseId,
            exerciseNameSnapshot: created.exerciseNameSnapshot,
            order: created.order,
            plannedSets: created.plannedSets,
            plannedReps: created.plannedReps,
            plannedRestTimeInSeconds: created.plannedRestTimeInSeconds,
          });
        }

        return {
          userWorkoutSessionId: session.id,
          exercises: createdExercises,
        };
      });
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002") ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2002")
      ) {
        throw new ConflictError("There is already a workout session in progress");
      }

      throw error;
    }
  }
}

