import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
}

interface OutputDto {
  id: string;
  name: string;
  nextWorkoutDayId?: string | null;
  lastCompletedWorkoutDayId?: string | null;
  workoutDays: Array<{
    id: string;
    order: number;
    weekDay: WeekDay;
    name: string;
    isRest: boolean;
    coverImageUrl: string | null;
    estimatedDurationInSeconds: number;
    exercisesCount: number;
  }>;
}

export class GetWorkoutPlan {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        id: dto.workoutPlanId,
        userId: dto.userId,
      },
      include: {
        workoutDays: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          include: {
            _count: {
              select: { exercises: true },
            },
          },
        },
      },
    });

    if (!workoutPlan) {
      throw new NotFoundError("Workout plan not found");
    }

    // Busca a última sessão concluída deste plano para saber o próximo treino da rotação
    const lastCompletedSession = await prisma.workoutSession.findFirst({
      where: {
        athleteId: dto.userId,
        completedAt: { not: null },
        OR: [
          { workoutPlanId: workoutPlan.id },
          { workoutDay: { workoutPlanId: workoutPlan.id } },
        ],
      },
      orderBy: { completedAt: "desc" },
    });

    const trainingDays = workoutPlan.workoutDays.filter((d) => !d.isRest);
    let nextWorkoutDayId: string | null = null;
    let lastCompletedWorkoutDayId: string | null = null;

    if (trainingDays.length > 0) {
      if (!lastCompletedSession || !lastCompletedSession.workoutDayId) {
        nextWorkoutDayId = trainingDays[0].id;
      } else {
        lastCompletedWorkoutDayId = lastCompletedSession.workoutDayId;
        const lastIndex = trainingDays.findIndex(
          (d) => d.id === lastCompletedSession.workoutDayId,
        );
        if (lastIndex === -1) {
          nextWorkoutDayId = trainingDays[0].id;
        } else {
          nextWorkoutDayId =
            trainingDays[(lastIndex + 1) % trainingDays.length].id;
        }
      }
    }

    return {
      id: workoutPlan.id,
      name: workoutPlan.name,
      nextWorkoutDayId,
      lastCompletedWorkoutDayId,
      workoutDays: workoutPlan.workoutDays.map((day) => ({
        id: day.id,
        order: day.order,
        weekDay: day.weekDay,
        name: day.name,
        isRest: day.isRest,
        coverImageUrl: day.coverImageUrl,
        estimatedDurationInSeconds: day.estimatedDurationInSeconds,
        exercisesCount: day._count.exercises,
      })),
    };
  }
}
