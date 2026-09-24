import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import {
  calculateWorkoutStreak,
  WEEKDAY_MAP,
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
    isRest: boolean;
    weekDay: WeekDayValue;
    estimatedDurationInSeconds: number;
    coverImageUrl: string | null;
    exercisesCount: number;
  };
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
    const currentWeekDay = WEEKDAY_MAP[currentDate.day()];

    // Find active workout plan
    const activeWorkoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        userId: dto.userId,
        isActive: true,
      },
      include: {
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

    // Find today's workout day
    const todayWorkoutDay = activeWorkoutPlan.workoutDays.find(
      (day) => day.weekDay === currentWeekDay,
    );

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

    // Fetch all sessions in the week range
    const sessionsInWeek = await prisma.workoutSession.findMany({
      where: {
        workoutDay: {
          workoutPlan: {
            userId: dto.userId,
            isActive: true,
          },
        },
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

    // Calculate workout streak
    const workoutStreak = calculateWorkoutStreak({
      workoutDays: activeWorkoutPlan.workoutDays,
      currentDate,
      timezoneOffset: dto.timezoneOffset,
    });

    return {
      activeWorkoutPlanId: activeWorkoutPlan.id,
      todayWorkoutDay:
        todayWorkoutDay && activeWorkoutPlan
          ? {
              workoutPlanId: activeWorkoutPlan.id,
              id: todayWorkoutDay.id,
              name: todayWorkoutDay.name,
              isRest: todayWorkoutDay.isRest,
              weekDay: todayWorkoutDay.weekDay,
              estimatedDurationInSeconds:
                todayWorkoutDay.estimatedDurationInSeconds,
              coverImageUrl: todayWorkoutDay.coverImageUrl ?? null,
              exercisesCount: todayWorkoutDay.exercises.length,
            }
          : undefined,
      workoutStreak,
      consistencyByDay,
    };
  }
}
