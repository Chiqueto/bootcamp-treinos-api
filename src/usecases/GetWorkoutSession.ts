import { NotFoundError } from "../errors/index.js";
import { SetType, WorkoutSessionOrigin } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  sessionId: string;
}

export interface WorkoutSetOutputDto {
  id: string;
  order: number;
  type: SetType;
  weightInGrams: number | null;
  reps: number | null;
  rir: number | null;
  durationInSeconds: number | null;
  notes: string | null;
  completedAt: string | null;
}

export interface SessionExerciseOutputDto {
  id: string;
  exerciseNameSnapshot: string;
  order: number;
  plannedSets: number | null;
  plannedReps: number | null;
  plannedRestTimeInSeconds: number | null;
  notes: string | null;
  sets: WorkoutSetOutputDto[];
}

export interface GetWorkoutSessionOutputDto {
  id: string;
  origin?: WorkoutSessionOrigin;
  workoutDayId: string | null;
  workoutPlanId?: string | null;
  workoutPlanNameSnapshot?: string | null;
  workoutDayNameSnapshot?: string | null;
  startedAt: string;
  completedAt: string | null;
  sessionExercises: SessionExerciseOutputDto[];
}

export class GetWorkoutSession {
  async execute(dto: InputDto): Promise<GetWorkoutSessionOutputDto> {
    const session = await prisma.workoutSession.findUnique({
      where: { id: dto.sessionId },
      include: {
        sessionExercises: {
          orderBy: { order: "asc" },
          include: {
            sets: {
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!session || session.athleteId !== dto.userId) {
      throw new NotFoundError("Workout session not found");
    }

    return {
      id: session.id,
      origin: session.origin,
      workoutDayId: session.workoutDayId,
      workoutPlanId: session.workoutPlanId,
      workoutPlanNameSnapshot: session.workoutPlanNameSnapshot,
      workoutDayNameSnapshot: session.workoutDayNameSnapshot,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      sessionExercises: session.sessionExercises.map((exercise) => ({
        id: exercise.id,
        exerciseNameSnapshot: exercise.exerciseNameSnapshot,
        order: exercise.order,
        plannedSets: exercise.plannedSets,
        plannedReps: exercise.plannedReps,
        plannedRestTimeInSeconds: exercise.plannedRestTimeInSeconds,
        notes: exercise.notes,
        sets: exercise.sets.map((set) => ({
          id: set.id,
          order: set.order,
          type: set.type,
          weightInGrams: set.weightInGrams,
          reps: set.reps,
          rir: set.rir,
          durationInSeconds: set.durationInSeconds,
          notes: set.notes,
          completedAt: set.completedAt ? set.completedAt.toISOString() : null,
        })),
      })),
    };
  }
}
