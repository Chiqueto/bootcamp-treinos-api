import { resolveCanonicalExerciseId } from "../domain/canonical-exercise.js";
import { decodeHistoryCursor, encodeHistoryCursor } from "../domain/history-cursor.js";
import { NotFoundError } from "../errors/index.js";
import {
  MuscleGroup,
  MuscleRole,
  Prisma,
  SetType,
  WorkoutSessionOrigin,
} from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

export interface GetExerciseEvolutionInput {
  userId: string;
  exerciseId: string;
  cursor?: string;
  limit?: number;
}

export interface ExerciseEvolutionMuscle {
  muscleGroup: MuscleGroup;
  role: MuscleRole;
}

export interface ExerciseEvolutionExercise {
  id: string;
  name: string;
  ownerUserId: string | null;
  muscles: ExerciseEvolutionMuscle[];
}

export interface ExerciseLoadPR {
  weightInGrams: number;
  weightKg: number;
  reps: number | null;
  rir: number | null;
  completedAt: string;
  workoutSessionId: string;
  sessionExerciseId: string;
  workoutSetId: string;
  origin: "PLANNED" | "FREE";
  workoutPlanNameSnapshot: string | null;
  workoutDayNameSnapshot: string | null;
}

export interface ExerciseEvolutionTopSet {
  workoutSetId: string;
  weightInGrams: number | null;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
}

export interface ExerciseEvolutionSet {
  id: string;
  sessionExerciseId: string;
  order: number;
  weightInGrams: number | null;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  durationInSeconds: number | null;
  notes: string | null;
  completedAt: string;
}

export interface ExerciseEvolutionItem {
  workoutSessionId: string;
  startedAt: string;
  completedAt: string;
  origin: "PLANNED" | "FREE";
  workoutPlanNameSnapshot: string | null;
  workoutDayNameSnapshot: string | null;
  exerciseNameSnapshot: string;
  workingSetsCount: number;
  totalReps: number;
  loadVolumeGrams: number;
  loadVolumeKg: number;
  topSet: ExerciseEvolutionTopSet | null;
  sets: ExerciseEvolutionSet[];
}

export interface GetExerciseEvolutionOutput {
  exercise: ExerciseEvolutionExercise;
  loadPR: ExerciseLoadPR | null;
  items: ExerciseEvolutionItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface LoadPRRow {
  workoutSetId: string;
  sessionExerciseId: string;
  workoutSessionId: string;
  weightInGrams: number;
  reps: number | null;
  rir: number | null;
  completedAt: Date;
  origin: WorkoutSessionOrigin;
  workoutPlanNameSnapshot: string | null;
  workoutDayNameSnapshot: string | null;
}

interface SessionPageRow {
  id: string;
  origin: WorkoutSessionOrigin;
  startedAt: Date;
  completedAt: Date;
  workoutPlanNameSnapshot: string | null;
  workoutDayNameSnapshot: string | null;
}

export class GetExerciseEvolution {
  async execute(input: GetExerciseEvolutionInput): Promise<GetExerciseEvolutionOutput> {
    let decodedCursor: { completedAt: Date; id: string } | null = null;
    if (input.cursor) {
      decodedCursor = decodeHistoryCursor(input.cursor);
    }

    // 1. Target Exercise & Ownership Check (global OR athlete's custom)
    const targetExercise = await prisma.exercise.findFirst({
      where: {
        id: input.exerciseId,
        OR: [{ ownerUserId: null }, { ownerUserId: input.userId }],
      },
      include: {
        muscles: true,
      },
    });

    if (!targetExercise) {
      throw new NotFoundError("Exercício não encontrado", "EXERCISE_NOT_FOUND");
    }

    // 2. Sort Muscles: PRIMARY first, then SECONDARY, then alphabetical
    const sortedMuscles: ExerciseEvolutionMuscle[] = targetExercise.muscles
      .map((m) => ({
        muscleGroup: m.muscleGroup,
        role: m.role,
      }))
      .sort((a, b) => {
        if (a.role !== b.role) {
          return a.role === "PRIMARY" ? -1 : 1;
        }
        return a.muscleGroup.localeCompare(b.muscleGroup);
      });

    // 3. Resolve canonical exercise for this user + name to prevent custom vs global collision on legacy fallback
    const canonicalIdForName = await resolveCanonicalExerciseId({
      userId: input.userId,
      name: targetExercise.name,
    });
    const enableLegacyFallback = canonicalIdForName === targetExercise.id;

    const limit = input.limit ?? 20;
    const take = limit + 1;

    // 4. Concurrently fetch loadPR and page of WorkoutSessions (Anti-N+1: O(1) queries)
    const cursorSql = decodedCursor
      ? Prisma.sql`AND (
          ws."completedAt" < ${decodedCursor.completedAt}
          OR (ws."completedAt" = ${decodedCursor.completedAt} AND ws.id < ${decodedCursor.id})
        )`
      : Prisma.empty;

    const loadPrPromise = prisma.$queryRaw<LoadPRRow[]>`
      SELECT
        s.id AS "workoutSetId",
        s."sessionExerciseId",
        se."workoutSessionId",
        s."weightInGrams",
        s.reps,
        s.rir,
        s."completedAt",
        ws.origin,
        ws."workoutPlanNameSnapshot",
        ws."workoutDayNameSnapshot"
      FROM "WorkoutSet" s
      JOIN "SessionExercise" se ON se.id = s."sessionExerciseId"
      JOIN "WorkoutSession" ws ON ws.id = se."workoutSessionId"
      WHERE ws."athleteId" = ${input.userId}
        AND ws."completedAt" IS NOT NULL
        AND s.type = 'WORKING'
        AND s."completedAt" IS NOT NULL
        AND s."weightInGrams" IS NOT NULL
        AND (
          se."exerciseId" = ${targetExercise.id}
          ${
            enableLegacyFallback
              ? Prisma.sql`OR (se."exerciseId" IS NULL AND LOWER(TRIM(se."exerciseNameSnapshot")) = LOWER(TRIM(${targetExercise.name})))`
              : Prisma.empty
          }
        )
      ORDER BY
        s."weightInGrams" DESC,
        s.reps DESC NULLS LAST,
        s."completedAt" DESC,
        s.id DESC
      LIMIT 1
    `;

    const sessionsPagePromise = prisma.$queryRaw<SessionPageRow[]>`
      SELECT
        ws.id,
        ws.origin,
        ws."startedAt",
        ws."completedAt",
        ws."workoutPlanNameSnapshot",
        ws."workoutDayNameSnapshot"
      FROM "WorkoutSession" ws
      WHERE ws."athleteId" = ${input.userId}
        AND ws."completedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "SessionExercise" se
          WHERE se."workoutSessionId" = ws.id
            AND (
              se."exerciseId" = ${targetExercise.id}
              ${
                enableLegacyFallback
                  ? Prisma.sql`OR (se."exerciseId" IS NULL AND LOWER(TRIM(se."exerciseNameSnapshot")) = LOWER(TRIM(${targetExercise.name})))`
                  : Prisma.empty
              }
            )
        )
        ${cursorSql}
      ORDER BY ws."completedAt" DESC, ws.id DESC
      LIMIT ${take}
    `;

    const [prRows, sessionRows] = await Promise.all([loadPrPromise, sessionsPagePromise]);

    let loadPR: ExerciseLoadPR | null = null;
    if (prRows.length > 0) {
      const pr = prRows[0];
      loadPR = {
        weightInGrams: Number(pr.weightInGrams),
        weightKg: Number(pr.weightInGrams) / 1000,
        reps: pr.reps,
        rir: pr.rir,
        completedAt: pr.completedAt.toISOString(),
        workoutSessionId: pr.workoutSessionId,
        sessionExerciseId: pr.sessionExerciseId,
        workoutSetId: pr.workoutSetId,
        origin: pr.origin,
        workoutPlanNameSnapshot: pr.workoutPlanNameSnapshot,
        workoutDayNameSnapshot: pr.workoutDayNameSnapshot,
      };
    }

    if (sessionRows.length === 0) {
      return {
        exercise: {
          id: targetExercise.id,
          name: targetExercise.name,
          ownerUserId: targetExercise.ownerUserId,
          muscles: sortedMuscles,
        },
        loadPR,
        items: [],
        nextCursor: null,
        hasMore: false,
      };
    }

    const hasMore = sessionRows.length > limit;
    const pageSessions = hasMore ? sessionRows.slice(0, limit) : sessionRows;
    const lastSession = pageSessions[pageSessions.length - 1];
    const nextCursor = hasMore
      ? encodeHistoryCursor({
          completedAt: lastSession.completedAt,
          id: lastSession.id,
        })
      : null;

    // 5. Query 3: Fetch SessionExercises and completed WORKING sets for page sessions in a single query
    const pageSessionIds = pageSessions.map((s) => s.id);

    const sessionExercises = await prisma.sessionExercise.findMany({
      where: {
        workoutSessionId: { in: pageSessionIds },
        OR: [
          { exerciseId: targetExercise.id },
          ...(enableLegacyFallback
            ? [
                {
                  exerciseId: null,
                  exerciseNameSnapshot: {
                    equals: targetExercise.name.trim(),
                    mode: "insensitive" as const,
                  },
                },
              ]
            : []),
        ],
      },
      include: {
        sets: {
          where: {
            type: SetType.WORKING,
            completedAt: { not: null },
          },
          orderBy: [
            { order: "asc" },
            { createdAt: "asc" },
            { id: "asc" },
          ],
        },
      },
      orderBy: {
        order: "asc",
      },
    });

    const seBySession = new Map<string, typeof sessionExercises>();
    for (const se of sessionExercises) {
      const list = seBySession.get(se.workoutSessionId) ?? [];
      list.push(se);
      seBySession.set(se.workoutSessionId, list);
    }

    // 6. Build evolution items consolidating multiple SessionExercises of the same session
    const items: ExerciseEvolutionItem[] = pageSessions.map((session) => {
      const matchingSEs = seBySession.get(session.id) ?? [];
      matchingSEs.sort((a, b) => a.order - b.order);

      // Snapshot name from lowest order occurrence (Rule 18)
      const exerciseNameSnapshot =
        matchingSEs.length > 0 ? matchingSEs[0].exerciseNameSnapshot : targetExercise.name;

      // Rule 20: Order sets by SessionExercise.order ASC, WorkoutSet.order ASC, createdAt ASC, id ASC
      const allWorkingSets: Array<
        typeof sessionExercises[0]["sets"][0] & { sessionExerciseOrder: number }
      > = [];
      for (const se of matchingSEs) {
        for (const s of se.sets) {
          allWorkingSets.push({
            ...s,
            sessionExerciseOrder: se.order,
          });
        }
      }

      allWorkingSets.sort((a, b) => {
        if (a.sessionExerciseOrder !== b.sessionExerciseOrder) {
          return a.sessionExerciseOrder - b.sessionExerciseOrder;
        }
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        const timeA = a.createdAt.getTime();
        const timeB = b.createdAt.getTime();
        if (timeA !== timeB) {
          return timeA - timeB;
        }
        return a.id.localeCompare(b.id);
      });

      const workingSetsCount = allWorkingSets.length;
      const totalReps = allWorkingSets.reduce((acc, s) => acc + (s.reps ?? 0), 0);
      const loadVolumeGrams = allWorkingSets.reduce((acc, s) => {
        if (s.weightInGrams !== null && s.reps !== null) {
          return acc + s.weightInGrams * s.reps;
        }
        return acc;
      }, 0);
      const loadVolumeKg = loadVolumeGrams / 1000;

      // Rule 21: Top Set selection
      let topSet: ExerciseEvolutionTopSet | null = null;
      if (allWorkingSets.length > 0) {
        const sortedForTop = [...allWorkingSets].sort((a, b) => {
          // 1. weightInGrams not null before null
          if (a.weightInGrams !== null && b.weightInGrams === null) return -1;
          if (a.weightInGrams === null && b.weightInGrams !== null) return 1;
          if (a.weightInGrams !== null && b.weightInGrams !== null) {
            if (a.weightInGrams !== b.weightInGrams) {
              return b.weightInGrams - a.weightInGrams;
            }
          }
          // 2. reps DESC
          const repsA = a.reps ?? -1;
          const repsB = b.reps ?? -1;
          if (repsA !== repsB) {
            return repsB - repsA;
          }
          // 3. completedAt DESC
          const timeA = a.completedAt ? a.completedAt.getTime() : 0;
          const timeB = b.completedAt ? b.completedAt.getTime() : 0;
          if (timeA !== timeB) {
            return timeB - timeA;
          }
          // 4. id DESC
          return b.id.localeCompare(a.id);
        });

        const best = sortedForTop[0];
        topSet = {
          workoutSetId: best.id,
          weightInGrams: best.weightInGrams,
          weightKg: best.weightInGrams !== null ? best.weightInGrams / 1000 : null,
          reps: best.reps,
          rir: best.rir,
        };
      }

      return {
        workoutSessionId: session.id,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt.toISOString(),
        origin: session.origin,
        workoutPlanNameSnapshot: session.workoutPlanNameSnapshot,
        workoutDayNameSnapshot: session.workoutDayNameSnapshot,
        exerciseNameSnapshot,
        workingSetsCount,
        totalReps,
        loadVolumeGrams,
        loadVolumeKg,
        topSet,
        sets: allWorkingSets.map((s) => ({
          id: s.id,
          sessionExerciseId: s.sessionExerciseId,
          order: s.order,
          weightInGrams: s.weightInGrams,
          weightKg: s.weightInGrams !== null ? s.weightInGrams / 1000 : null,
          reps: s.reps,
          rir: s.rir,
          durationInSeconds: s.durationInSeconds,
          notes: s.notes,
          completedAt: s.completedAt!.toISOString(),
        })),
      };
    });

    return {
      exercise: {
        id: targetExercise.id,
        name: targetExercise.name,
        ownerUserId: targetExercise.ownerUserId,
        muscles: sortedMuscles,
      },
      loadPR,
      items,
      nextCursor,
      hasMore,
    };
  }
}
