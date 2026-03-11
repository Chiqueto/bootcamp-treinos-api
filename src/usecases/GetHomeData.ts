import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

dayjs.extend(utc);

type WeekDayValue = (typeof WeekDay)[keyof typeof WeekDay];

const WEEKDAY_MAP: Record<number, WeekDayValue> = {
  0: WeekDay.SUNDAY,
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
};

const WEEKDAY_ORDER: Record<string, number> = {
  [WeekDay.SUNDAY]: 0,
  [WeekDay.MONDAY]: 1,
  [WeekDay.TUESDAY]: 2,
  [WeekDay.WEDNESDAY]: 3,
  [WeekDay.THURSDAY]: 4,
  [WeekDay.FRIDAY]: 5,
  [WeekDay.SATURDAY]: 6,
};

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
    const workoutStreak = this.calculateStreak(
      activeWorkoutPlan.workoutDays,
      currentDate,
      dto.timezoneOffset,
    );

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

  private calculateStreak(
    workoutDays: Array<{
      weekDay: string;
      isRest: boolean;
      sessions: Array<{ completedAt: Date | null; startedAt: Date }>;
    }>,
    currentDate: dayjs.Dayjs,
    timezoneOffset: number,
  ): number {
    // Sort workout days by weekday order
    const sortedDays = [...workoutDays].sort(
      (a, b) => WEEKDAY_ORDER[a.weekDay] - WEEKDAY_ORDER[b.weekDay],
    );

    let streak = 0;
    const today = currentDate.format("YYYY-MM-DD");

    // Go backwards from today checking consecutive workout plan days
    for (let daysBack = 0; daysBack < 30; daysBack++) {
      const checkDate = currentDate.subtract(daysBack, "day");
      const checkDateStr = checkDate.format("YYYY-MM-DD");
      const checkWeekDay = WEEKDAY_MAP[checkDate.day()];

      const workoutDay = sortedDays.find((d) => d.weekDay === checkWeekDay);

      // If no workout day is scheduled for this day, skip it (not part of the plan)
      if (!workoutDay) {
        continue;
      }

      // Rest days count as completed automatically
      // if (workoutDay.isRest) {
      //   streak++;
      //   continue;
      // }

      // Check if the workout day has a completed session on this date
      const hasCompletedSession = workoutDay.sessions.some((session) => {
        const sessionDate = dayjs
          .utc(session.startedAt)
          .utcOffset(timezoneOffset)
          .format("YYYY-MM-DD");
        return sessionDate === checkDateStr && session.completedAt !== null;
      });

      if (hasCompletedSession) {
        streak++;
      } else {
        // If today and not completed yet, skip (don't break streak for today)
        if (checkDateStr === today) {
          continue;
        }
        break;
      }
    }

    return streak;
  }
}
