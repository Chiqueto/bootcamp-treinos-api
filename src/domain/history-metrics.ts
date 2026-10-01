/**
 * Calcula a duração em segundos a partir de timestamps de início e conclusão.
 * Garante valor mínimo não negativo (defesa contra relógios dessincronizados).
 */
export function computeSessionDurationInSeconds(
  startedAt: Date | string,
  completedAt: Date | string,
): number {
  const startMs =
    typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  const endMs =
    typeof completedAt === "string" ? new Date(completedAt).getTime() : completedAt.getTime();

  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

/**
 * Calcula o volume de carga em gramas de uma série específica.
 * Apenas séries do tipo WORKING concluídas (completedAt != null) contribuem para o volume.
 * Séries com peso ou repetições nulas retornam 0 (mas contam como working set).
 */
export function computeSetLoadVolumeGrams(set: {
  type: string;
  completedAt?: Date | string | null;
  weightInGrams?: number | null;
  reps?: number | null;
}): number {
  if (set.type !== "WORKING" || !set.completedAt) {
    return 0;
  }

  if (
    set.weightInGrams === null ||
    set.weightInGrams === undefined ||
    set.weightInGrams <= 0 ||
    set.reps === null ||
    set.reps === undefined ||
    set.reps <= 0
  ) {
    return 0;
  }

  return set.weightInGrams * set.reps;
}

/**
 * Consolida as métricas executadas de um exercício a partir de suas séries.
 */
export function computeExercisePerformedMetrics(
  sets: Array<{
    type: string;
    completedAt?: Date | string | null;
    weightInGrams?: number | null;
    reps?: number | null;
  }>,
): {
  warmupSetsCount: number;
  workingSetsCount: number;
  loadVolumeGrams: number;
  loadVolumeKg: number;
} {
  let warmupSetsCount = 0;
  let workingSetsCount = 0;
  let loadVolumeGrams = 0;

  for (const set of sets) {
    if (!set.completedAt) {
      continue;
    }

    if (set.type === "WARMUP") {
      warmupSetsCount++;
    } else if (set.type === "WORKING") {
      workingSetsCount++;
      loadVolumeGrams += computeSetLoadVolumeGrams(set);
    }
  }

  return {
    warmupSetsCount,
    workingSetsCount,
    loadVolumeGrams,
    loadVolumeKg: loadVolumeGrams / 1000,
  };
}
