import {
  NotFoundError,
  ValidationError,
  WorkoutSessionAlreadyCompletedError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  sessionExerciseId: string;
}

interface OutputDto {
  success: boolean;
}

export class RemoveExerciseFromWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const sessionExercise = await prisma.sessionExercise.findUnique({
      where: { id: dto.sessionExerciseId },
      include: {
        workoutSession: true,
      },
    });

    if (
      !sessionExercise ||
      sessionExercise.workoutSession.athleteId !== dto.userId
    ) {
      throw new NotFoundError("Session exercise not found");
    }

    if (sessionExercise.workoutSession.completedAt !== null) {
      throw new WorkoutSessionAlreadyCompletedError(
        "Workout session is already completed",
      );
    }

    if (sessionExercise.workoutSession.workoutDayId !== null) {
      throw new ValidationError(
        "Cannot remove exercise from a planned workout session",
      );
    }

    await prisma.sessionExercise.delete({
      where: { id: dto.sessionExerciseId },
    });

    return { success: true };
  }
}
