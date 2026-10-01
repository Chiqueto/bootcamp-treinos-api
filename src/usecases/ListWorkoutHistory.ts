import { decodeHistoryCursor, encodeHistoryCursor } from "../domain/history-cursor.js";
import { computeSessionDurationInSeconds } from "../domain/history-metrics.js";
import { Prisma } from "../generated/prisma/client.js";
import { WorkoutSessionOrigin } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  cursor?: string;
  limit?: number;
  origin?: "PLANNED" | "FREE";
}

export interface HistoryTimelineItemDto {
  id: string;
  origin: "PLANNED" | "FREE";
  startedAt: string;
  completedAt: string;
  durationInSeconds: number;
  workoutPlanId: string | null;
  workoutPlanNameSnapshot: string | null;
  workoutDayNameSnapshot: string | null;
  exercisesCount: number;
  workingSetsCount: number;
  warmupSetsCount: number;
  totalLoadVolumeGrams: number;
  totalLoadVolumeKg: number;
}

export interface ListWorkoutHistoryOutputDto {
  items: HistoryTimelineItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ListWorkoutHistory {
  async execute(dto: InputDto): Promise<ListWorkoutHistoryOutputDto> {
    const limit = Math.min(50, Math.max(1, dto.limit ?? 15));
    const cursorData = dto.cursor ? decodeHistoryCursor(dto.cursor) : null;

    const where: Prisma.WorkoutSessionWhereInput = {
      athleteId: dto.userId,
      completedAt: { not: null },
    };

    if (dto.origin) {
      where.origin = dto.origin as WorkoutSessionOrigin;
    }

    if (cursorData) {
      where.OR = [
        {
          completedAt: {
            lt: cursorData.completedAt,
          },
        },
        {
          completedAt: cursorData.completedAt,
          id: {
            lt: cursorData.id,
          },
        },
      ];
    }

    // 1. Busca limit + 1 sessões para detecção de hasMore
    const rawSessions = await prisma.workoutSession.findMany({
      where,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        origin: true,
        startedAt: true,
        completedAt: true,
        workoutPlanId: true,
        workoutPlanNameSnapshot: true,
        workoutDayNameSnapshot: true,
      },
    });

    const hasMore = rawSessions.length > limit;
    const pageSessions = hasMore ? rawSessions.slice(0, limit) : rawSessions;

    if (pageSessions.length === 0) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
    }

    // 2. Anti-N+1: Agregação única no PostgreSQL para todos os itens da página
    const sessionIds = pageSessions.map((s) => s.id);
    const aggregates = await prisma.$queryRaw<
      Array<{
        workoutSessionId: string;
        exercisesCount: number;
        workingSetsCount: number;
        warmupSetsCount: number;
        totalLoadVolumeGrams: string | number;
      }>
    >`
      SELECT
        ws."id" AS "workoutSessionId",
        COUNT(DISTINCT se."id")::int AS "exercisesCount",
        COUNT(CASE WHEN s."type" = 'WORKING' AND s."completedAt" IS NOT NULL THEN 1 END)::int AS "workingSetsCount",
        COUNT(CASE WHEN s."type" = 'WARMUP' AND s."completedAt" IS NOT NULL THEN 1 END)::int AS "warmupSetsCount",
        COALESCE(
          SUM(
            CASE
              WHEN s."type" = 'WORKING' AND s."completedAt" IS NOT NULL AND s."weightInGrams" IS NOT NULL AND s."reps" IS NOT NULL
              THEN (s."weightInGrams"::bigint * s."reps"::bigint)
              ELSE 0
            END
          ),
          0
        )::text AS "totalLoadVolumeGrams"
      FROM "WorkoutSession" ws
      LEFT JOIN "SessionExercise" se ON se."workoutSessionId" = ws."id"
      LEFT JOIN "WorkoutSet" s ON s."sessionExerciseId" = se."id"
      WHERE ws."id" IN (${Prisma.join(sessionIds)})
      GROUP BY ws."id"
    `;

    const aggMap = new Map<
      string,
      {
        exercisesCount: number;
        workingSetsCount: number;
        warmupSetsCount: number;
        totalLoadVolumeGrams: number;
      }
    >();

    for (const row of aggregates) {
      const grams = Number(row.totalLoadVolumeGrams) || 0;
      aggMap.set(row.workoutSessionId, {
        exercisesCount: row.exercisesCount,
        workingSetsCount: row.workingSetsCount,
        warmupSetsCount: row.warmupSetsCount,
        totalLoadVolumeGrams: grams,
      });
    }

    const items: HistoryTimelineItemDto[] = pageSessions.map((session) => {
      const agg = aggMap.get(session.id) ?? {
        exercisesCount: 0,
        workingSetsCount: 0,
        warmupSetsCount: 0,
        totalLoadVolumeGrams: 0,
      };

      const durationInSeconds = computeSessionDurationInSeconds(
        session.startedAt,
        session.completedAt!,
      );

      return {
        id: session.id,
        origin: session.origin as "PLANNED" | "FREE",
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt!.toISOString(),
        durationInSeconds,
        workoutPlanId: session.workoutPlanId ?? null,
        workoutPlanNameSnapshot: session.workoutPlanNameSnapshot ?? null,
        workoutDayNameSnapshot: session.workoutDayNameSnapshot ?? null,
        exercisesCount: agg.exercisesCount,
        workingSetsCount: agg.workingSetsCount,
        warmupSetsCount: agg.warmupSetsCount,
        totalLoadVolumeGrams: agg.totalLoadVolumeGrams,
        totalLoadVolumeKg: agg.totalLoadVolumeGrams / 1000,
      };
    });

    const nextCursor =
      hasMore && items.length > 0
        ? encodeHistoryCursor({
            completedAt: items[items.length - 1].completedAt,
            id: items[items.length - 1].id,
          })
        : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }
}
