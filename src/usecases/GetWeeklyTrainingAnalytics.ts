import {
  calculateWeeksCountRange,
  generateWeeksSequence,
  getMondayOfWeek,
  validateDateRange,
  validateIanaTimezone,
} from "../domain/analytics-dates.js";
import { InvalidDateRangeError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import {
  WeeklyAnalyticsItem,
  WeeklyAnalyticsResponse,
} from "../schemas/index.js";

export interface GetWeeklyTrainingAnalyticsInput {
  userId: string;
  tz: string;
  startDate?: string;
  endDate?: string;
  weeksCount?: number;
}

interface WeeklyAggregateRow {
  weekStart: string;
  workoutsCompleted: number;
  workingSets: number;
  warmupSets: number;
  loadVolumeGrams: string;
  totalDurationInSeconds: number;
}

export class GetWeeklyTrainingAnalytics {
  constructor(private readonly prismaClient = prisma) {}

  async execute(input: GetWeeklyTrainingAnalyticsInput): Promise<WeeklyAnalyticsResponse> {
    const validTz = validateIanaTimezone(input.tz);

    const hasExplicitDates = Boolean(input.startDate || input.endDate);
    const hasWeeksCount = input.weeksCount !== undefined && input.weeksCount !== null;

    if (hasExplicitDates && hasWeeksCount) {
      throw new InvalidDateRangeError(
        "Não é permitido misturar startDate/endDate com weeksCount. Escolha apenas um modo.",
      );
    }

    let windowStartDate: string;
    let windowEndDate: string;
    let weeksSequence: Array<{ weekStartDate: string; weekEndDate: string }>;

    if (hasExplicitDates) {
      if (!input.startDate || !input.endDate) {
        throw new InvalidDateRangeError("startDate e endDate devem ser ambos fornecidos.");
      }
      const validated = validateDateRange(input.startDate, input.endDate);
      windowStartDate = validated.startDate;
      windowEndDate = validated.endDate;

      const startMonday = getMondayOfWeek(windowStartDate);
      const endMonday = getMondayOfWeek(windowEndDate);
      weeksSequence = generateWeeksSequence(startMonday, endMonday);
    } else {
      const weeksCount = input.weeksCount ?? 8;
      if (typeof weeksCount !== "number" || isNaN(weeksCount) || weeksCount < 1 || weeksCount > 52) {
        throw new InvalidDateRangeError("weeksCount deve ser um número inteiro entre 1 e 52.");
      }

      const calculated = calculateWeeksCountRange(validTz, weeksCount);
      windowStartDate = calculated.startDate;
      windowEndDate = calculated.endDate;
      weeksSequence = calculated.weeks;
    }

    // CTE agregada em nível de banco evitando multiplicação de linhas e Anti-N+1
    const rows = await this.prismaClient.$queryRaw<WeeklyAggregateRow[]>`
      WITH sessions_in_range AS (
        SELECT
          ws.id,
          ws."startedAt",
          ws."completedAt",
          DATE_TRUNC('week', ws."completedAt" AT TIME ZONE ${validTz})::date AS week_start,
          GREATEST(0, EXTRACT(EPOCH FROM (ws."completedAt" - ws."startedAt")))::int AS duration_sec
        FROM "WorkoutSession" ws
        WHERE ws."athleteId" = ${input.userId}
          AND ws."completedAt" IS NOT NULL
          AND ws."completedAt" >= (${windowStartDate}::timestamp AT TIME ZONE ${validTz})
          AND ws."completedAt" < ((${windowEndDate}::timestamp + INTERVAL '1 day') AT TIME ZONE ${validTz})
      ),
      sessions_summary AS (
        SELECT
          week_start,
          COUNT(DISTINCT id)::int AS workouts_completed,
          COALESCE(SUM(duration_sec), 0)::int AS total_duration_seconds
        FROM sessions_in_range
        GROUP BY week_start
      ),
      sets_summary AS (
        SELECT
          sir.week_start,
          COUNT(CASE WHEN s.type = 'WORKING' AND s."completedAt" IS NOT NULL THEN 1 END)::int AS working_sets,
          COUNT(CASE WHEN s.type = 'WARMUP' AND s."completedAt" IS NOT NULL THEN 1 END)::int AS warmup_sets,
          COALESCE(
            SUM(
              CASE
                WHEN s.type = 'WORKING' AND s."completedAt" IS NOT NULL AND s."weightInGrams" IS NOT NULL AND s.reps IS NOT NULL
                THEN (s."weightInGrams"::bigint * s.reps::bigint)
                ELSE 0
              END
            ),
            0
          )::bigint AS load_volume_grams
        FROM sessions_in_range sir
        INNER JOIN "SessionExercise" se ON se."workoutSessionId" = sir.id
        INNER JOIN "WorkoutSet" s ON s."sessionExerciseId" = se.id
        GROUP BY sir.week_start
      )
      SELECT
        TO_CHAR(COALESCE(ss.week_start, ses.week_start), 'YYYY-MM-DD') AS "weekStart",
        COALESCE(ss.workouts_completed, 0)::int AS "workoutsCompleted",
        COALESCE(ses.working_sets, 0)::int AS "workingSets",
        COALESCE(ses.warmup_sets, 0)::int AS "warmupSets",
        COALESCE(ses.load_volume_grams, 0)::text AS "loadVolumeGrams",
        COALESCE(ss.total_duration_seconds, 0)::int AS "totalDurationInSeconds"
      FROM sessions_summary ss
      FULL OUTER JOIN sets_summary ses ON ss.week_start = ses.week_start
      ORDER BY "weekStart" ASC;
    `;

    const rowMap = new Map<string, WeeklyAggregateRow>();
    for (const row of rows) {
      if (row.weekStart) {
        rowMap.set(row.weekStart, row);
      }
    }

    const weeks: WeeklyAnalyticsItem[] = weeksSequence.map((week) => {
      const data = rowMap.get(week.weekStartDate);
      const workoutsCompleted = data ? Number(data.workoutsCompleted) : 0;
      const workingSets = data ? Number(data.workingSets) : 0;
      const warmupSets = data ? Number(data.warmupSets) : 0;
      const loadVolumeGrams = data ? Number(data.loadVolumeGrams) : 0;
      const totalDurationInSeconds = data ? Number(data.totalDurationInSeconds) : 0;
      const averageDurationInSeconds =
        workoutsCompleted > 0 ? Math.round(totalDurationInSeconds / workoutsCompleted) : 0;

      return {
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        workoutsCompleted,
        workingSets,
        warmupSets,
        loadVolumeGrams,
        loadVolumeKg: loadVolumeGrams / 1000,
        totalDurationInSeconds,
        averageDurationInSeconds,
      };
    });

    return {
      startDate: windowStartDate,
      endDate: windowEndDate,
      timezone: validTz,
      weeks,
    };
  }
}
