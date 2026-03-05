import dayjs from "dayjs";

import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
}

interface OutputDto {
  id: string;
  name: string;
  isRest: boolean;
  coverImageUrl: string | null;
  estimatedDurationInSeconds: number;
  weekDay: WeekDay;
  exercises: Array<{
    id: string;
    name: string;
    order: number;
    workoutDayId: string;
    sets: number;
    reps: number;
    restTimeInSeconds: number;
  }>;
  sessions: Array<{
    id: string;
    workoutDayId: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export class GetWorkoutDay {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutDay = await prisma.workoutDay.findFirst({
      where: {
        id: dto.workoutDayId,
        workoutPlanId: dto.workoutPlanId,
        workoutPlan: {
          userId: dto.userId,
        },
      },
      include: {
        exercises: {
          orderBy: { order: "asc" },
        },
        sessions: true,
      },
    });

    if (!workoutDay) {
      throw new NotFoundError("Workout day not found");
    }

    return {
      id: workoutDay.id,
      name: workoutDay.name,
      isRest: workoutDay.isRest,
      coverImageUrl: workoutDay.coverImageUrl,
      estimatedDurationInSeconds: workoutDay.estimatedDurationInSeconds,
      weekDay: workoutDay.weekDay,
      exercises: workoutDay.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        order: exercise.order,
        workoutDayId: exercise.workoutDayId,
        sets: exercise.sets,
        reps: exercise.reps,
        restTimeInSeconds: exercise.restTimeInSeconds,
      })),
      sessions: workoutDay.sessions.map((session) => ({
        id: session.id,
        workoutDayId: session.workoutDayId,
        startedAt: dayjs(session.startedAt).format("YYYY-MM-DD"),
        completedAt: session.completedAt
          ? dayjs(session.completedAt).format("YYYY-MM-DD")
          : null,
      })),
    };
  }
}
