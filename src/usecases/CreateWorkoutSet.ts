import {
  NotFoundError,
  ValidationError,
  WorkoutSessionAlreadyCompletedError,
} from "../errors/index.js";
import { SetType } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  sessionExerciseId: string;
  type?: SetType;
  weightInGrams?: number | null;
  reps?: number | null;
  rir?: number | null;
  durationInSeconds?: number | null;
  notes?: string | null;
  completed?: boolean;
}

interface OutputDto {
  id: string;
  sessionExerciseId: string;
  order: number;
  type: SetType;
  weightInGrams: number | null;
  reps: number | null;
  rir: number | null;
  durationInSeconds: number | null;
  notes: string | null;
  completedAt: string | null;
}

export class CreateWorkoutSet {
  async execute(dto: InputDto): Promise<OutputDto> {
    const sessionExercise = await prisma.sessionExercise.findUnique({
      where: { id: dto.sessionExerciseId },
      include: {
        workoutSession: true,
      },
    });

    if (!sessionExercise || sessionExercise.workoutSession.athleteId !== dto.userId) {
      throw new NotFoundError("Session exercise not found");
    }

    if (sessionExercise.workoutSession.completedAt !== null) {
      throw new WorkoutSessionAlreadyCompletedError("Workout session is already completed");
    }

    if (dto.weightInGrams !== undefined && dto.weightInGrams !== null) {
      if (!Number.isInteger(dto.weightInGrams) || dto.weightInGrams < 0) {
        throw new ValidationError("O peso deve ser um número inteiro maior ou igual a zero");
      }
    }

    if (dto.reps !== undefined && dto.reps !== null) {
      if (!Number.isInteger(dto.reps) || dto.reps < 0) {
        throw new ValidationError("O número de repetições deve ser um número inteiro maior ou igual a zero");
      }
    }

    if (dto.rir !== undefined && dto.rir !== null) {
      if (!Number.isInteger(dto.rir) || dto.rir < 0 || dto.rir > 10) {
        throw new ValidationError("O RIR deve ser um número inteiro entre 0 e 10");
      }
    }

    if (dto.durationInSeconds !== undefined && dto.durationInSeconds !== null) {
      if (!Number.isInteger(dto.durationInSeconds) || dto.durationInSeconds < 0) {
        throw new ValidationError("A duração deve ser um número inteiro maior ou igual a zero");
      }
    }

    if (dto.completed) {
      const hasReps = dto.reps !== null && dto.reps !== undefined;
      const hasDuration = dto.durationInSeconds !== null && dto.durationInSeconds !== undefined;

      if (!hasReps && !hasDuration) {
        throw new ValidationError("Série concluída deve possuir repetições ou duração em segundos");
      }
    }

    const lastSet = await prisma.workoutSet.findFirst({
      where: { sessionExerciseId: dto.sessionExerciseId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const nextOrder = lastSet ? lastSet.order + 1 : 1;
    const completedAt = dto.completed ? new Date() : null;

    const set = await prisma.workoutSet.create({
      data: {
        id: crypto.randomUUID(),
        sessionExerciseId: dto.sessionExerciseId,
        order: nextOrder,
        type: dto.type ?? "WORKING",
        weightInGrams: dto.weightInGrams ?? null,
        reps: dto.reps ?? null,
        rir: dto.rir ?? null,
        durationInSeconds: dto.durationInSeconds ?? null,
        notes: dto.notes ?? null,
        completedAt,
      },
    });

    return {
      id: set.id,
      sessionExerciseId: set.sessionExerciseId,
      order: set.order,
      type: set.type,
      weightInGrams: set.weightInGrams,
      reps: set.reps,
      rir: set.rir,
      durationInSeconds: set.durationInSeconds,
      notes: set.notes,
      completedAt: set.completedAt ? set.completedAt.toISOString() : null,
    };
  }
}
