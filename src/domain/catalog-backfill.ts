import { Prisma } from "../generated/prisma/client.js";
import { MuscleRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { CANONICAL_GLOBAL_CATALOG, getCanonicalGlobalByName } from "./canonical-catalog.js";
import { resolveCanonicalExerciseId } from "./canonical-exercise.js";

export interface CatalogBackfillReport {
  globals: {
    totalDefined: number;
    created: number;
    existing: number;
    musclesCreated: number;
  };
  customClassified: {
    matchedCount: number;
    musclesCreated: number;
    unmatchedCount: number;
  };
  workoutExercises: {
    totalBefore: number;
    linkedBefore: number;
    nullBefore: number;
    resolved: number;
    unresolved: number;
    totalAfter: number;
    linkedAfter: number;
    nullAfter: number;
    unresolvedNames: string[];
  };
  sessionExercises: {
    totalBefore: number;
    linkedBefore: number;
    nullBefore: number;
    resolvedViaSource: number;
    resolvedViaFallback: number;
    unresolved: number;
    totalAfter: number;
    linkedAfter: number;
    nullAfter: number;
    unresolvedNames: string[];
  };
}

/**
 * 1. Sincroniza o catálogo global canônico no banco com IDs determinísticos e ExerciseMuscle.
 * Idempotente: se o exercício ou o músculo já existir, não duplica.
 */
export async function syncCanonicalGlobalCatalog(
  client: Prisma.TransactionClient = prisma,
): Promise<{ created: number; existing: number; musclesCreated: number }> {
  let created = 0;
  let existing = 0;
  let musclesCreated = 0;

  for (const def of CANONICAL_GLOBAL_CATALOG) {
    const existingGlobal = await client.exercise.findFirst({
      where: {
        OR: [
          { id: def.id },
          {
            ownerUserId: null,
            name: { equals: def.name, mode: "insensitive" },
          },
        ],
      },
    });

    let exerciseId = def.id;

    if (!existingGlobal) {
      const createdExercise = await client.exercise.create({
        data: {
          id: def.id,
          name: def.name,
          ownerUserId: null,
        },
      });
      exerciseId = createdExercise.id;
      created++;
    } else {
      exerciseId = existingGlobal.id;
      existing++;
    }

    // Criar ExerciseMuscle (PRIMARY e SECONDARY) de forma idempotente
    const musclesToSync = [
      ...def.primary.map((mg) => ({ muscleGroup: mg, role: MuscleRole.PRIMARY })),
      ...def.secondary.map((mg) => ({ muscleGroup: mg, role: MuscleRole.SECONDARY })),
    ];

    for (const m of musclesToSync) {
      const existingMuscle = await client.exerciseMuscle.findUnique({
        where: {
          exerciseId_muscleGroup: {
            exerciseId,
            muscleGroup: m.muscleGroup,
          },
        },
      });

      if (!existingMuscle) {
        await client.exerciseMuscle.create({
          data: {
            exerciseId,
            muscleGroup: m.muscleGroup,
            role: m.role,
          },
        });
        musclesCreated++;
      }
    }
  }

  return { created, existing, musclesCreated };
}

/**
 * 2. Classificação segura de exercícios customizados legados que possuem 0 músculos.
 * Somente quando houver match exato normalizado (LOWER(TRIM(custom.name)) === LOWER(TRIM(global.name))).
 * Não altera customizados que já possuem músculos (classificação manual tem precedência).
 * Não altera ownerUserId nem substitui a entidade do custom exercise.
 */
export async function classifyUnclassifiedCustomExercises(
  client: Prisma.TransactionClient = prisma,
): Promise<{ matchedCount: number; musclesCreated: number; unmatchedCount: number }> {
  // Buscar todos os exercícios customizados
  const customExercises = await client.exercise.findMany({
    where: {
      ownerUserId: { not: null },
    },
    include: {
      muscles: true,
    },
  });

  let matchedCount = 0;
  let musclesCreated = 0;
  let unmatchedCount = 0;

  for (const custom of customExercises) {
    // Regra: se o usuário já classificou (muscles.length > 0), NÃO alterar nada
    if (custom.muscles.length > 0) {
      continue;
    }

    const catalogMatch = getCanonicalGlobalByName(custom.name);
    if (!catalogMatch) {
      unmatchedCount++;
      continue;
    }

    matchedCount++;
    const musclesToAssign = [
      ...catalogMatch.primary.map((mg) => ({ muscleGroup: mg, role: MuscleRole.PRIMARY })),
      ...catalogMatch.secondary.map((mg) => ({ muscleGroup: mg, role: MuscleRole.SECONDARY })),
    ];

    for (const m of musclesToAssign) {
      await client.exerciseMuscle.create({
        data: {
          exerciseId: custom.id,
          muscleGroup: m.muscleGroup,
          role: m.role,
        },
      });
      musclesCreated++;
    }
  }

  return { matchedCount, musclesCreated, unmatchedCount };
}

/**
 * 3. Backfill de WorkoutExercise.exerciseId legado.
 * Prioridade runtime:
 *   1. Custom exercise do próprio usuário com match exato normalizado
 *   2. Global exercise com match exato normalizado
 *   3. Sem match -> continua null
 * Não altera campos de prescrição/histórico (name, sets, reps, warmupSets, etc).
 */
export async function backfillWorkoutExercises(
  client: Prisma.TransactionClient = prisma,
): Promise<{
  totalBefore: number;
  linkedBefore: number;
  nullBefore: number;
  resolved: number;
  unresolved: number;
  totalAfter: number;
  linkedAfter: number;
  nullAfter: number;
  unresolvedNames: string[];
}> {
  const allWE = await client.workoutExercise.findMany({
    include: {
      workoutDay: {
        include: {
          workoutPlan: {
            select: { userId: true },
          },
        },
      },
    },
  });

  const totalBefore = allWE.length;
  const linkedBefore = allWE.filter((we) => we.exerciseId !== null).length;
  const nullBefore = allWE.filter((we) => we.exerciseId === null).length;

  let resolved = 0;
  const unresolvedNamesSet = new Set<string>();

  for (const we of allWE) {
    if (we.exerciseId !== null) {
      continue;
    }

    const userId = we.workoutDay.workoutPlan.userId;
    const canonicalId = await resolveCanonicalExerciseId({
      userId,
      name: we.name,
      tx: client,
    });

    if (canonicalId) {
      await client.workoutExercise.update({
        where: { id: we.id },
        data: { exerciseId: canonicalId },
      });
      resolved++;
    } else {
      unresolvedNamesSet.add(we.name);
    }
  }

  const nullAfter = nullBefore - resolved;
  const linkedAfter = linkedBefore + resolved;

  return {
    totalBefore,
    linkedBefore,
    nullBefore,
    resolved,
    unresolved: nullAfter,
    totalAfter: totalBefore,
    linkedAfter,
    nullAfter,
    unresolvedNames: Array.from(unresolvedNamesSet),
  };
}

/**
 * 4. Backfill de SessionExercise.exerciseId legado.
 * Estratégia 1: se existir sourceWorkoutExerciseId e este possuir exerciseId, copiar.
 * Estratégia 2: fallback seguro por exerciseNameSnapshot + athleteId (user custom > global > null).
 * Não altera históricos (exerciseNameSnapshot, plannedSets, etc).
 */
export async function backfillSessionExercises(
  client: Prisma.TransactionClient = prisma,
): Promise<{
  totalBefore: number;
  linkedBefore: number;
  nullBefore: number;
  resolvedViaSource: number;
  resolvedViaFallback: number;
  unresolved: number;
  totalAfter: number;
  linkedAfter: number;
  nullAfter: number;
  unresolvedNames: string[];
}> {
  const allSE = await client.sessionExercise.findMany({
    include: {
      sourceWorkoutExercise: {
        select: { exerciseId: true },
      },
      workoutSession: {
        select: { athleteId: true },
      },
    },
  });

  const totalBefore = allSE.length;
  const linkedBefore = allSE.filter((se) => se.exerciseId !== null).length;
  const nullBefore = allSE.filter((se) => se.exerciseId === null).length;

  let resolvedViaSource = 0;
  let resolvedViaFallback = 0;
  const unresolvedNamesSet = new Set<string>();

  for (const se of allSE) {
    if (se.exerciseId !== null) {
      continue;
    }

    // Estratégia 1: herdar do sourceWorkoutExercise se já resolvido
    if (se.sourceWorkoutExercise?.exerciseId) {
      await client.sessionExercise.update({
        where: { id: se.id },
        data: { exerciseId: se.sourceWorkoutExercise.exerciseId },
      });
      resolvedViaSource++;
      continue;
    }

    // Estratégia 2: fallback por nome exato contra atleta custom ou global
    const athleteId = se.workoutSession.athleteId;
    const canonicalId = await resolveCanonicalExerciseId({
      userId: athleteId,
      name: se.exerciseNameSnapshot,
      tx: client,
    });

    if (canonicalId) {
      await client.sessionExercise.update({
        where: { id: se.id },
        data: { exerciseId: canonicalId },
      });
      resolvedViaFallback++;
    } else {
      unresolvedNamesSet.add(se.exerciseNameSnapshot);
    }
  }

  const nullAfter = nullBefore - (resolvedViaSource + resolvedViaFallback);
  const linkedAfter = linkedBefore + resolvedViaSource + resolvedViaFallback;

  return {
    totalBefore,
    linkedBefore,
    nullBefore,
    resolvedViaSource,
    resolvedViaFallback,
    unresolved: nullAfter,
    totalAfter: totalBefore,
    linkedAfter,
    nullAfter,
    unresolvedNames: Array.from(unresolvedNamesSet),
  };
}

/**
 * 5. Orquestrador completo do Backfill Canônico Task 3.1D.
 * Executa todas as etapas em sequência dentro de uma transação se desejado.
 */
export async function runCanonicalCatalogBackfill(
  client: Prisma.TransactionClient = prisma,
): Promise<CatalogBackfillReport> {
  const syncResult = await syncCanonicalGlobalCatalog(client);
  const customResult = await classifyUnclassifiedCustomExercises(client);
  const weResult = await backfillWorkoutExercises(client);
  const seResult = await backfillSessionExercises(client);

  return {
    globals: {
      totalDefined: CANONICAL_GLOBAL_CATALOG.length,
      created: syncResult.created,
      existing: syncResult.existing,
      musclesCreated: syncResult.musclesCreated,
    },
    customClassified: {
      matchedCount: customResult.matchedCount,
      musclesCreated: customResult.musclesCreated,
      unmatchedCount: customResult.unmatchedCount,
    },
    workoutExercises: weResult,
    sessionExercises: seResult,
  };
}
