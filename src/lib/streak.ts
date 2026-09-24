import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { WeekDay } from "../generated/prisma/enums.js";

dayjs.extend(utc);

export type WeekDayValue = (typeof WeekDay)[keyof typeof WeekDay];

export const WEEKDAY_MAP: Record<number, WeekDayValue> = {
  0: WeekDay.SUNDAY,
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
};

export interface StreakWorkoutSession {
  startedAt: Date | string;
  completedAt: Date | string | null;
}

export interface StreakWorkoutDay {
  weekDay: string;
  isRest: boolean;
  sessions: StreakWorkoutSession[];
}

export interface CalculateStreakParams {
  workoutDays: StreakWorkoutDay[];
  currentDate: dayjs.Dayjs;
  timezoneOffset: number;
  maxDaysBack?: number;
}

/**
 * Calcula o streak de treinos consecutivos respeitando a semântica unificada de produto:
 * - Treino planejado e concluído: incrementa streak (+1);
 * - Dia de descanso (isRest = true): não incrementa e não quebra streak (preserva);
 * - Treino planejado no passado não concluído: quebra o streak (stop);
 * - Treino planejado de hoje ainda não concluído: não quebra o streak enquanto o dia não acabou;
 * - Dias futuros: ignorados.
 */
export function calculateWorkoutStreak(params: CalculateStreakParams): number {
  const { workoutDays, currentDate, timezoneOffset, maxDaysBack = 365 } = params;

  let streak = 0;
  const todayStr = currentDate.format("YYYY-MM-DD");

  for (let daysBack = 0; daysBack < maxDaysBack; daysBack++) {
    const checkDate = currentDate.subtract(daysBack, "day");
    const checkDateStr = checkDate.format("YYYY-MM-DD");
    const checkWeekDay = WEEKDAY_MAP[checkDate.day()];

    const workoutDay = workoutDays.find((d) => d.weekDay === checkWeekDay);

    // Se o dia da semana não está no plano, pula
    if (!workoutDay) {
      continue;
    }

    // Dia de descanso: não incrementa e não quebra streak
    if (workoutDay.isRest) {
      continue;
    }

    // Dia de treino planejado: verifica se houve sessão concluída nesta data civil
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
      // Se for a data de hoje e ainda não foi concluído, não quebra a sequência
      if (checkDateStr === todayStr) {
        continue;
      }
      break;
    }
  }

  return streak;
}
