import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { prisma } from "../lib/db.js";
import { calculateWorkoutStreak } from "../lib/streak.js";

dayjs.extend(utc);

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
    const activeWorkoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        userId: dto.userId,
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

    const workoutStreak = activeWorkoutPlan
      ? calculateWorkoutStreak({
          workoutDays: activeWorkoutPlan.workoutDays,
          currentDate: toDate,
          timezoneOffset: dto.timezoneOffset,
        })
      : 0;

    return {
      workoutStreak,
      consistencyByDay,
      completedWorkoutsCount,
      conclusionRate,
      totalTimeInSeconds,
    };
  }
}
