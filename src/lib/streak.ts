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
  additionalSessions?: StreakWorkoutSession[];
}

/**
 * Calcula o streak de treinos consecutivos respeitando a semântica unificada de produto:
 * - Treino concluído (planejado ou avulso): incrementa streak (+1);
 * - Dia de descanso (isRest = true) sem treino: não incrementa e não quebra streak (preserva);
 * - Treino planejado no passado não concluído: quebra o streak (stop);
 * - Treino planejado de hoje ainda não concluído: não quebra o streak enquanto o dia não acabou;
 * - Dias futuros: ignorados.
 */
export function calculateWorkoutStreak(params: CalculateStreakParams): number {
  const {
    workoutDays,
    currentDate,
    timezoneOffset,
    maxDaysBack = 365,
    additionalSessions = [],
  } = params;

  let streak = 0;
  const todayStr = currentDate.format("YYYY-MM-DD");

  for (let daysBack = 0; daysBack < maxDaysBack; daysBack++) {
    const checkDate = currentDate.subtract(daysBack, "day");
    const checkDateStr = checkDate.format("YYYY-MM-DD");
    const checkWeekDay = WEEKDAY_MAP[checkDate.day()];

    const workoutDay = workoutDays.find((d) => d.weekDay === checkWeekDay);

    // Verifica se houve sessão concluída nesta data civil (planejada ou avulsa)
    const hasCompletedPlannedSession =
      workoutDay?.sessions.some((session) => {
        const sessionDate = dayjs
          .utc(session.startedAt)
          .utcOffset(timezoneOffset)
          .format("YYYY-MM-DD");
        return sessionDate === checkDateStr && session.completedAt !== null;
      }) ?? false;

    const hasCompletedAdditionalSession = additionalSessions.some((session) => {
      const sessionDate = dayjs
        .utc(session.startedAt)
        .utcOffset(timezoneOffset)
        .format("YYYY-MM-DD");
      return sessionDate === checkDateStr && session.completedAt !== null;
    });

    const hasCompletedSession =
      hasCompletedPlannedSession || hasCompletedAdditionalSession;

    // Se houve treino concluído (planejado ou avulso): incrementa o streak
    if (hasCompletedSession) {
      streak++;
      continue;
    }

    // Se o dia da semana não está no plano, apenas preserva e continua olhando para trás
    if (!workoutDay) {
      continue;
    }

    // Dia de descanso sem treino concluído: não incrementa e não quebra streak
    if (workoutDay.isRest) {
      continue;
    }

    // Dia de treino planejado sem treino concluído:
    // Se for a data de hoje e ainda não foi concluído, não quebra a sequência enquanto o dia não acabou
    if (checkDateStr === todayStr) {
      continue;
    }

    // Treino planejado no passado não concluído: quebra a sequência
    break;
  }

  return streak;
}
