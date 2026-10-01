import {
  CANONICAL_MUSCLE_ORDER,
  validateDateRange,
  validateIanaTimezone,
} from "../domain/analytics-dates.js";
import { prisma } from "../lib/db.js";
import { MuscleAnalyticsResponse } from "../schemas/index.js";

export interface GetMuscleTrainingAnalyticsInput {
  userId: string;
  tz: string;
  startDate: string;
  endDate: string;
}

interface TotalsRow {
  totalWorkingSets: number;
  classifiedWorkingSets: number;
}

interface MuscleRow {
  muscleGroup: string;
  directWorkingSets: number;
  indirectWorkingSets: number;
}

export class GetMuscleTrainingAnalytics {
  constructor(private readonly prismaClient = prisma) {}

  async execute(input: GetMuscleTrainingAnalyticsInput): Promise<MuscleAnalyticsResponse> {
    const validTz = validateIanaTimezone(input.tz);
    const { startDate: windowStartDate, endDate: windowEndDate } = validateDateRange(
      input.startDate,
      input.endDate,
    );

    // Executa em paralelo duas queries agregadas otimizadas O(1) com proteção contra multiplicação de linhas
    const [totalsRows, muscleRows] = await Promise.all([
      // Query 1: Totais gerais de séries de trabalho (classificadas vs não-classificadas)
      this.prismaClient.$queryRaw<TotalsRow[]>`
        WITH sessions_in_range AS (
          SELECT ws.id
          FROM "WorkoutSession" ws
          WHERE ws."athleteId" = ${input.userId}
            AND ws."completedAt" IS NOT NULL
            AND ws."completedAt" >= (${windowStartDate}::timestamp AT TIME ZONE ${validTz})
            AND ws."completedAt" < ((${windowEndDate}::timestamp + INTERVAL '1 day') AT TIME ZONE ${validTz})
        ),
        working_sets AS (
          SELECT
            s.id AS set_id,
            se."exerciseId" AS exercise_id
          FROM sessions_in_range sir
          INNER JOIN "SessionExercise" se ON se."workoutSessionId" = sir.id
          INNER JOIN "WorkoutSet" s ON s."sessionExerciseId" = se.id
          WHERE s.type = 'WORKING' AND s."completedAt" IS NOT NULL
        )
        SELECT
          COUNT(DISTINCT ws.set_id)::int AS "totalWorkingSets",
          COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN ws.set_id END)::int AS "classifiedWorkingSets"
        FROM working_sets ws
        LEFT JOIN "ExerciseMuscle" em ON em."exerciseId" = ws.exercise_id;
      `,
      // Query 2: Distribuição muscular direta (PRIMARY) e indireta (SECONDARY)
      this.prismaClient.$queryRaw<MuscleRow[]>`
        WITH sessions_in_range AS (
          SELECT ws.id
          FROM "WorkoutSession" ws
          WHERE ws."athleteId" = ${input.userId}
            AND ws."completedAt" IS NOT NULL
            AND ws."completedAt" >= (${windowStartDate}::timestamp AT TIME ZONE ${validTz})
            AND ws."completedAt" < ((${windowEndDate}::timestamp + INTERVAL '1 day') AT TIME ZONE ${validTz})
        )
        SELECT
          em."muscleGroup"::text AS "muscleGroup",
          COUNT(DISTINCT CASE WHEN em.role = 'PRIMARY' THEN s.id END)::int AS "directWorkingSets",
          COUNT(DISTINCT CASE WHEN em.role = 'SECONDARY' THEN s.id END)::int AS "indirectWorkingSets"
        FROM sessions_in_range sir
        INNER JOIN "SessionExercise" se ON se."workoutSessionId" = sir.id
        INNER JOIN "WorkoutSet" s ON s."sessionExerciseId" = se.id
        INNER JOIN "ExerciseMuscle" em ON em."exerciseId" = se."exerciseId"
        WHERE s.type = 'WORKING' AND s."completedAt" IS NOT NULL
        GROUP BY em."muscleGroup";
      `,
    ]);

    const totalWorkingSets = totalsRows[0]?.totalWorkingSets ? Number(totalsRows[0].totalWorkingSets) : 0;
    const classifiedWorkingSets = totalsRows[0]?.classifiedWorkingSets
      ? Number(totalsRows[0].classifiedWorkingSets)
      : 0;
    const unclassifiedWorkingSets = totalWorkingSets - classifiedWorkingSets;

    const muscleMap = new Map<string, { directWorkingSets: number; indirectWorkingSets: number }>();
    for (const row of muscleRows) {
      if (row.muscleGroup) {
        muscleMap.set(row.muscleGroup, {
          directWorkingSets: Number(row.directWorkingSets),
          indirectWorkingSets: Number(row.indirectWorkingSets),
        });
      }
    }

    const muscles = CANONICAL_MUSCLE_ORDER.map((muscleGroup) => {
      const data = muscleMap.get(muscleGroup);
      return {
        muscleGroup,
        directWorkingSets: data ? data.directWorkingSets : 0,
        indirectWorkingSets: data ? data.indirectWorkingSets : 0,
      };
    });

    return {
      startDate: windowStartDate,
      endDate: windowEndDate,
      timezone: validTz,
      totalWorkingSets,
      classifiedWorkingSets,
      unclassifiedWorkingSets,
      muscles,
    };
  }
}
