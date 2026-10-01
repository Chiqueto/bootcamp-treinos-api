import { resolveCanonicalExerciseMap } from "../domain/canonical-exercise.js";
import {
  ActivePeriodizationError,
  ConflictError,
  NotFoundError,
} from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  name: string;
  activate?: boolean;
  workoutDays: Array<{
    name: string;
    weekDay: WeekDay;
    isRest: boolean;
    estimatedDurationInSeconds: number;
    coverImageUrl?: string | null;
    exercises: Array<{
      order: number;
      name: string;
      sets: number;
      warmupSets?: number;
      reps: number;
      restTimeInSeconds: number;
    }>;
  }>;
}

interface OutputDto {
  id: string;
  name: string;
  isActive: boolean;
  workoutDays: Array<{
    name: string;
    weekDay: WeekDay;
    isRest: boolean;
    estimatedDurationInSeconds: number;
    coverImageUrl: string | null;
    exercises: Array<{
      order: number;
      name: string;
      sets: number;
      warmupSets: number;
      reps: number;
      restTimeInSeconds: number;
    }>;
  }>;
}

export class CreateWorkoutPlan {
  async execute(dto: InputDto): Promise<OutputDto> {
    const shouldActivate = dto.activate ?? true;

    try {
      return await prisma.$transaction(async (tx) => {
        if (shouldActivate) {
          const activePeriodization = await tx.periodization.findFirst({
            where: {
              userId: dto.userId,
              isActive: true,
            },
          });

          if (activePeriodization) {
            throw new ActivePeriodizationError(
              "Existe uma periodização ativa. Crie o plano como inativo ou pause a periodização primeiro.",
            );
          }

          await tx.workoutPlan.updateMany({
            where: {
              userId: dto.userId,
              isActive: true,
            },
            data: {
              isActive: false,
            },
          });
        }

        const allExerciseNames = dto.workoutDays.flatMap((day) =>
          day.exercises.map((e) => e.name),
        );
        const canonicalExerciseMap = await resolveCanonicalExerciseMap({
          userId: dto.userId,
          names: allExerciseNames,
          tx,
        });

        const workoutPlan = await tx.workoutPlan.create({
          data: {
            id: crypto.randomUUID(),
            name: dto.name,
            userId: dto.userId,
            isActive: shouldActivate,
            workoutDays: {
              create: dto.workoutDays.map((workoutDay) => ({
                name: workoutDay.name,
                weekDay: workoutDay.weekDay,
                isRest: workoutDay.isRest,
                estimatedDurationInSeconds: workoutDay.estimatedDurationInSeconds,
                coverImageUrl: workoutDay.coverImageUrl ?? null,
                exercises: {
                  create: workoutDay.exercises.map((exercise) => ({
                    order: exercise.order,
                    name: exercise.name,
                    sets: exercise.sets,
                    warmupSets: exercise.warmupSets ?? 0,
                    reps: exercise.reps,
                    restTimeInSeconds: exercise.restTimeInSeconds,
                    exerciseId: canonicalExerciseMap.get(exercise.name) ?? null,
                  })),
                },
              })),
            },
          },
        });

      const result = await tx.workoutPlan.findFirst({
        where: {
          id: workoutPlan.id,
        },
        include: {
          workoutDays: {
            include: {
              exercises: true,
            },
          },
        },
      });

      if (!result) {
        throw new NotFoundError("Workout plan not found");
      }

        return {
          id: result.id,
          name: result.name,
          isActive: result.isActive,
          workoutDays: result.workoutDays.map((day) => ({
            name: day.name,
            weekDay: day.weekDay,
            isRest: day.isRest,
            estimatedDurationInSeconds: day.estimatedDurationInSeconds,
            coverImageUrl: day.coverImageUrl,
            exercises: day.exercises.map((exercise) => ({
              order: exercise.order,
              name: exercise.name,
              sets: exercise.sets,
              warmupSets: exercise.warmupSets,
              reps: exercise.reps,
              restTimeInSeconds: exercise.restTimeInSeconds,
            })),
          })),
        };
      }, {
        maxWait: 5000,
        timeout: 15000,
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
        throw new ConflictError("User already has an active workout plan");
      }

      throw error;
    }
  }
}
