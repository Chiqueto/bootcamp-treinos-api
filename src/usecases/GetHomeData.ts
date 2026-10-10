import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import {
  calculateWorkoutStreak,
  WeekDayValue,
} from "../lib/streak.js";

dayjs.extend(utc);


interface InputDto {
  userId: string;
  date: string;
  timezoneOffset: number;
}

interface OutputDto {
  activeWorkoutPlanId: string;
  todayWorkoutDay?: {
    workoutPlanId: string;
    id: string;
    name: string;
    order?: number;
    isRest: boolean;
    weekDay: WeekDayValue;
    estimatedDurationInSeconds: number;
    coverImageUrl: string | null;
    exercisesCount: number;
  };
  lastCompletedWorkoutDay?: {
    id: string;
    name: string;
    completedAt: string;
  };
  isLastWorkoutCompletedToday?: boolean;
  rotationIndex?: number;
  totalWorkoutsInRotation?: number;
  gamificationTheme?: "ALL" | "ANIMES" | "VEHICLES" | "ANIMALS" | "MOVIES_SERIES";
  workoutStreak: number;

  consistencyByDay: Record<
    string,
    {
      workoutDayCompleted: boolean;
      workoutDayStarted: boolean;
    }
  >;
}

export class GetHomeData {
  async execute(dto: InputDto): Promise<OutputDto> {
    const currentDate = dayjs.utc(dto.date);

    // Find active workout plan
    const activeWorkoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        userId: dto.userId,
        isActive: true,
      },
      include: {
        user: {
          select: {
            gamificationTheme: true,
          },
        },
        workoutDays: {
          include: {
            exercises: true,
            sessions: true,
          },
        },
      },

    });

    if (!activeWorkoutPlan) {
      throw new NotFoundError("Active workout plan not found");
    }

    // 1. Filtrar e ordenar treinos ativos na rotação (excluindo descanso)
    const WEEKDAY_ORDER = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ];

    const trainingDays = activeWorkoutPlan.workoutDays
      .filter((day) => !day.isRest)
      .sort((a, b) => {
        if (
          typeof a.order === "number" &&
          typeof b.order === "number" &&
          a.order !== b.order
        ) {
          return a.order - b.order;
        }
        const orderA = WEEKDAY_ORDER.indexOf(a.weekDay as string);
        const orderB = WEEKDAY_ORDER.indexOf(b.weekDay as string);
        if (orderA !== -1 && orderB !== -1) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

    // 2. Buscar a última sessão concluída pelo usuário no plano ativo
    const lastCompletedSession = await prisma.workoutSession.findFirst({
      where: {
        athleteId: dto.userId,
        completedAt: { not: null },
        OR: [
          { workoutPlanId: activeWorkoutPlan.id },
          { workoutDay: { workoutPlanId: activeWorkoutPlan.id } },
        ],
      },
      orderBy: { completedAt: "desc" },
      include: {
        workoutDay: true,
      },
    });

    // 3. Determinar o próximo treino na rotação sequencial (ontem fez peito -> próximo é costas)
    let nextWorkoutDay = trainingDays[0] ?? activeWorkoutPlan.workoutDays[0];
    let nextWorkoutIndex = 0;

    if (trainingDays.length > 0) {
      if (!lastCompletedSession || !lastCompletedSession.workoutDayId) {
        nextWorkoutDay = trainingDays[0];
        nextWorkoutIndex = 0;
      } else {
        const lastIndex = trainingDays.findIndex(
          (d) => d.id === lastCompletedSession.workoutDayId,
        );
        if (lastIndex === -1) {
          nextWorkoutDay = trainingDays[0];
          nextWorkoutIndex = 0;
        } else {
          nextWorkoutIndex = (lastIndex + 1) % trainingDays.length;
          nextWorkoutDay = trainingDays[nextWorkoutIndex];
        }
      }
    }

    const currentDateStr = currentDate.format("YYYY-MM-DD");
    let isLastWorkoutCompletedToday = false;
    let lastCompletedWorkoutDayData: {
      id: string;
      name: string;
      completedAt: string;
    } | undefined = undefined;

    if (lastCompletedSession && lastCompletedSession.completedAt) {
      const sessionCompletedDate = dayjs
        .utc(lastCompletedSession.completedAt)
        .utcOffset(dto.timezoneOffset)
        .format("YYYY-MM-DD");
      if (sessionCompletedDate === currentDateStr) {
        isLastWorkoutCompletedToday = true;
      }
      if (lastCompletedSession.workoutDay) {
        lastCompletedWorkoutDayData = {
          id: lastCompletedSession.workoutDay.id,
          name: lastCompletedSession.workoutDay.name,
          completedAt: lastCompletedSession.completedAt.toISOString(),
        };
      }
    }

    const todayWorkoutDay = nextWorkoutDay;

    // Calculate week range (Sunday to Saturday) adjusted for user's timezone
    // weekStart/weekEnd represent local midnight boundaries converted to UTC
    const weekStart = currentDate
      .day(0)
      .startOf("day")
      .subtract(dto.timezoneOffset, "minute");
    const weekEnd = currentDate
      .day(6)
      .endOf("day")
      .subtract(dto.timezoneOffset, "minute");

    // Fetch all sessions in the week range (both planned from active plan and free workouts)
    const sessionsInWeek = await prisma.workoutSession.findMany({
      where: {
        athleteId: dto.userId,
        OR: [
          { workoutDayId: null },
          {
            workoutDay: {
              workoutPlan: {
                isActive: true,
              },
            },
          },
        ],
        startedAt: {
          gte: weekStart.toDate(),
          lte: weekEnd.toDate(),
        },
      },
    });

    // Build consistencyByDay for all days Sunday–Saturday
    const consistencyByDay: Record<
      string,
      { workoutDayCompleted: boolean; workoutDayStarted: boolean }
    > = {};

    for (let i = 0; i <= 6; i++) {
      const dateKey = currentDate.day(i).format("YYYY-MM-DD");

      const daySessions = sessionsInWeek.filter(
        (session) =>
          dayjs
            .utc(session.startedAt)
            .utcOffset(dto.timezoneOffset)
            .format("YYYY-MM-DD") === dateKey,
      );

      const workoutDayStarted = daySessions.length > 0;
      const workoutDayCompleted = daySessions.some(
        (session) => session.completedAt !== null,
      );

      consistencyByDay[dateKey] = {
        workoutDayCompleted,
        workoutDayStarted,
      };
    }

    // Fetch free workout sessions completed by the athlete
    const freeCompletedSessions = await prisma.workoutSession.findMany({
      where: {
        athleteId: dto.userId,
        workoutDayId: null,
        completedAt: { not: null },
      },
      select: {
        startedAt: true,
        completedAt: true,
      },
    });

    // Calculate workout streak
    const workoutStreak = calculateWorkoutStreak({
      workoutDays: activeWorkoutPlan.workoutDays,
      currentDate,
      timezoneOffset: dto.timezoneOffset,
      additionalSessions: freeCompletedSessions,
    });

    return {
      activeWorkoutPlanId: activeWorkoutPlan.id,
      todayWorkoutDay:
        todayWorkoutDay && activeWorkoutPlan
          ? {
              workoutPlanId: activeWorkoutPlan.id,
              id: todayWorkoutDay.id,
              name: todayWorkoutDay.name,
              order: todayWorkoutDay.order,
              isRest: todayWorkoutDay.isRest,
              weekDay: todayWorkoutDay.weekDay,
              estimatedDurationInSeconds:
                todayWorkoutDay.estimatedDurationInSeconds,
              coverImageUrl: todayWorkoutDay.coverImageUrl ?? null,
              exercisesCount: todayWorkoutDay.exercises.length,
            }
          : undefined,
      lastCompletedWorkoutDay: lastCompletedWorkoutDayData,
      isLastWorkoutCompletedToday,
      rotationIndex: trainingDays.length > 0 ? nextWorkoutIndex + 1 : 1,
      totalWorkoutsInRotation: trainingDays.length,
      gamificationTheme: (activeWorkoutPlan.user?.gamificationTheme as OutputDto["gamificationTheme"]) ?? "ALL",
      workoutStreak,
      consistencyByDay,

    };
  }
}
