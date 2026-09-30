import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  name?: string;
}

interface OutputDto {
  id: string;
  name: string;
  isActive: boolean;
  workoutDays: Array<{
    id: string;
    name: string;
    weekDay: WeekDay;
    isRest: boolean;
    estimatedDurationInSeconds: number;
    coverImageUrl: string | null;
    exercises: Array<{
      id: string;
      name: string;
      order: number;
      sets: number;
      reps: number;
      restTimeInSeconds: number;
      exerciseId: string | null;
    }>;
  }>;
}

export class DuplicateWorkoutPlan {
  async execute(dto: InputDto): Promise<OutputDto> {
    return await prisma.$transaction(async (tx) => {
      const original = await tx.workoutPlan.findUnique({
        where: { id: dto.workoutPlanId },
        include: {
          workoutDays: {
            include: {
              exercises: {
                orderBy: { order: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!original || original.userId !== dto.userId) {
        throw new NotFoundError("Workout plan not found");
      }

      const targetName =
        dto.name && dto.name.trim().length > 0
          ? dto.name.trim()
          : `${original.name} - Cópia`;

      const duplicatedPlan = await tx.workoutPlan.create({
        data: {
          id: crypto.randomUUID(),
          name: targetName,
          userId: dto.userId,
          isActive: false, // SEMPRE inativo na criação
          workoutDays: {
            create: original.workoutDays.map((day) => ({
              name: day.name,
              weekDay: day.weekDay,
              isRest: day.isRest,
              estimatedDurationInSeconds: day.estimatedDurationInSeconds,
              coverImageUrl: day.coverImageUrl,
              exercises: {
                create: day.exercises.map((ex) => ({
                  name: ex.name,
                  order: ex.order,
                  sets: ex.sets,
                  reps: ex.reps,
                  restTimeInSeconds: ex.restTimeInSeconds,
                  exerciseId: ex.exerciseId, // Preserva vínculo canônico sem duplicar Exercise
                })),
              },
            })),
          },
        },
        include: {
          workoutDays: {
            include: {
              exercises: {
                orderBy: { order: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return {
        id: duplicatedPlan.id,
        name: duplicatedPlan.name,
        isActive: duplicatedPlan.isActive,
        workoutDays: duplicatedPlan.workoutDays.map((day) => ({
          id: day.id,
          name: day.name,
          weekDay: day.weekDay,
          isRest: day.isRest,
          estimatedDurationInSeconds: day.estimatedDurationInSeconds,
          coverImageUrl: day.coverImageUrl,
          exercises: day.exercises.map((ex) => ({
            id: ex.id,
            name: ex.name,
            order: ex.order,
            sets: ex.sets,
            reps: ex.reps,
            restTimeInSeconds: ex.restTimeInSeconds,
            exerciseId: ex.exerciseId,
          })),
        })),
      };
    });
  }
}
