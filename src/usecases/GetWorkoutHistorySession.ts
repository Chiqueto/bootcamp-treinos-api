import {
  computeExercisePerformedMetrics,
  computeSessionDurationInSeconds,
} from "../domain/history-metrics.js";
import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  sessionId: string;
}

export interface HistorySetDetailDto {
  id: string;
  order: number;
  type: "WARMUP" | "WORKING";
  weightInGrams: number | null;
  reps: number | null;
  rir: number | null;
  durationInSeconds: number | null;
  notes: string | null;
  completedAt: string;
}

export interface HistoryExerciseDetailDto {
  id: string;
  exerciseId: string | null;
  exerciseNameSnapshot: string;
  order: number;
  notes: string | null;
  planned: {
    warmupSets: number | null;
    workingSets: number | null;
    reps: number | null;
    restTimeInSeconds: number | null;
  };
  performed: {
    warmupSetsCount: number;
    workingSetsCount: number;
    loadVolumeGrams: number;
    loadVolumeKg: number;
  };
  sets: HistorySetDetailDto[];
}

export interface GetWorkoutHistorySessionOutputDto {
  id: string;
  origin: "PLANNED" | "FREE";
  startedAt: string;
  completedAt: string;
  durationInSeconds: number;
  workoutPlanId: string | null;
  workoutPlanNameSnapshot: string | null;
  workoutDayNameSnapshot: string | null;
  summary: {
    exercisesCount: number;
    workingSetsCount: number;
    warmupSetsCount: number;
    totalLoadVolumeGrams: number;
    totalLoadVolumeKg: number;
  };
  exercises: HistoryExerciseDetailDto[];
}

export class GetWorkoutHistorySession {
  async execute(dto: InputDto): Promise<GetWorkoutHistorySessionOutputDto> {
    const session = await prisma.workoutSession.findFirst({
      where: {
        id: dto.sessionId,
        athleteId: dto.userId,
        completedAt: { not: null }, // Apenas sessões concluídas pertencem ao histórico
      },
      include: {
        sessionExercises: {
          orderBy: { order: "asc" },
          include: {
            sets: {
              where: { completedAt: { not: null } },
              orderBy: [
                { order: "asc" },
                { createdAt: "asc" },
                { id: "asc" },
              ],
            },
          },
        },
      },
    });

    if (!session || !session.completedAt) {
      throw new NotFoundError("Workout session not found");
    }

    const durationInSeconds = computeSessionDurationInSeconds(
      session.startedAt,
      session.completedAt,
    );

    let totalWorkingSets = 0;
    let totalWarmupSets = 0;
    let totalLoadVolumeGrams = 0;

    const exercises: HistoryExerciseDetailDto[] = session.sessionExercises.map((exercise) => {
      const performed = computeExercisePerformedMetrics(exercise.sets);

      totalWorkingSets += performed.workingSetsCount;
      totalWarmupSets += performed.warmupSetsCount;
      totalLoadVolumeGrams += performed.loadVolumeGrams;

      const sets: HistorySetDetailDto[] = exercise.sets.map((set) => ({
        id: set.id,
        order: set.order,
        type: set.type as "WARMUP" | "WORKING",
        weightInGrams: set.weightInGrams,
        reps: set.reps,
        rir: set.rir,
        durationInSeconds: set.durationInSeconds,
        notes: set.notes,
        completedAt: set.completedAt!.toISOString(),
      }));

      return {
        id: exercise.id,
        exerciseId: exercise.exerciseId ?? null,
        exerciseNameSnapshot: exercise.exerciseNameSnapshot,
        order: exercise.order,
        notes: exercise.notes ?? null,
        planned: {
          warmupSets: exercise.plannedWarmupSets ?? null,
          workingSets: exercise.plannedSets ?? null,
          reps: exercise.plannedReps ?? null,
          restTimeInSeconds: exercise.plannedRestTimeInSeconds ?? null,
        },
        performed,
        sets,
      };
    });

    return {
      id: session.id,
      origin: session.origin as "PLANNED" | "FREE",
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt.toISOString(),
      durationInSeconds,
      workoutPlanId: session.workoutPlanId ?? null,
      workoutPlanNameSnapshot: session.workoutPlanNameSnapshot ?? null,
      workoutDayNameSnapshot: session.workoutDayNameSnapshot ?? null,
      summary: {
        exercisesCount: exercises.length,
        workingSetsCount: totalWorkingSets,
        warmupSetsCount: totalWarmupSets,
        totalLoadVolumeGrams,
        totalLoadVolumeKg: totalLoadVolumeGrams / 1000,
      },
      exercises,
    };
  }
}
