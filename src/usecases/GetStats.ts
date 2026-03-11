import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

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

interface InputDto {
  userId: string;
  from: string;
  to: string;
  timezoneOffset: number;
}

interface OutputDto {
  workoutStreak: number;
  consistencyByDay: Record<
    string,
    {
      workoutDayCompleted: boolean;
      workoutDayStarted: boolean;
    }
  >;
  completedWorkoutsCount: number;
  conclusionRate: number;
  totalTimeInSeconds: number;
}

export class GetStats {
  async execute(dto: InputDto): Promise<OutputDto> {
    const fromDate = dayjs
      .utc(dto.from)
      .startOf("day")
      .subtract(dto.timezoneOffset, "minute");
    const toDate = dayjs
      .utc(dto.to)
      .endOf("day")
      .subtract(dto.timezoneOffset, "minute");

    // Fetch all sessions in the range for the user
    const sessions = await prisma.workoutSession.findMany({
      where: {
        workoutDay: {
          workoutPlan: {
            userId: dto.userId,
          },
        },
        startedAt: {
          gte: fromDate.toDate(),
          lte: toDate.toDate(),
        },
      },
    });

    // Group sessions by date
    const sessionsByDate = new Map<
      string,
      Array<{ startedAt: Date; completedAt: Date | null }>
    >();

    sessions.forEach((session) => {
      const dateKey = dayjs
        .utc(session.startedAt)
        .utcOffset(dto.timezoneOffset)
        .format("YYYY-MM-DD");
      const existing = sessionsByDate.get(dateKey) ?? [];
      existing.push({
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      });
      sessionsByDate.set(dateKey, existing);
    });

    // Build consistencyByDay — only days that have at least one session
    const consistencyByDay: Record<
      string,
      { workoutDayCompleted: boolean; workoutDayStarted: boolean }
    > = {};

    sessionsByDate.forEach((daySessions, dateKey) => {
      const workoutDayStarted = daySessions.length > 0;
      const workoutDayCompleted = daySessions.some(
        (s) => s.completedAt !== null,
      );
      consistencyByDay[dateKey] = { workoutDayCompleted, workoutDayStarted };
    });

    // completedWorkoutsCount
    const completedWorkoutsCount = sessions.filter(
      (s) => s.completedAt !== null,
    ).length;

    // conclusionRate
    const conclusionRate =
      sessions.length > 0 ? completedWorkoutsCount / sessions.length : 0;

    // totalTimeInSeconds — sum of (completedAt - startedAt) for completed sessions
    const totalTimeInSeconds = sessions
      .filter((s) => s.completedAt !== null)
      .reduce((total, s) => {
        const diff = dayjs
          .utc(s.completedAt!)
          .diff(dayjs.utc(s.startedAt), "second");
        return total + diff;
      }, 0);

    // workoutStreak
    const workoutStreak = await this.calculateStreak(
      dto.userId,
      toDate,
      dto.timezoneOffset,
    );

    return {
      workoutStreak,
      consistencyByDay,
      completedWorkoutsCount,
      conclusionRate,
      totalTimeInSeconds,
    };
  }

  private async calculateStreak(
    userId: string,
    endDate: dayjs.Dayjs,
    timezoneOffset: number,
  ): Promise<number> {
    // Get the active workout plan to know which weekdays are scheduled
    const activeWorkoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        userId,
        isActive: true,
      },
      include: {
        workoutDays: {
          include: {
            sessions: true,
          },
        },
      },
    });

    if (!activeWorkoutPlan) {
      return 0;
    }

    const today = endDate.format("YYYY-MM-DD");
    let streak = 0;

    for (let daysBack = 0; daysBack < 365; daysBack++) {
      const checkDate = endDate.subtract(daysBack, "day");
      const checkDateStr = checkDate.format("YYYY-MM-DD");
      const checkWeekDay = WEEKDAY_MAP[checkDate.day()];

      const workoutDay = activeWorkoutPlan.workoutDays.find(
        (d) => d.weekDay === checkWeekDay,
      );

      // If no workout day is scheduled for this day, skip it
      if (!workoutDay) {
        continue;
      }

      // Rest days count as completed automatically
      if (workoutDay.isRest) {
        streak++;
        continue;
      }

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
