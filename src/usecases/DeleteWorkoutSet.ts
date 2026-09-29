import {
  NotFoundError,
  WorkoutSessionAlreadyCompletedError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  setId: string;
}

interface OutputDto {
  success: boolean;
}

export class DeleteWorkoutSet {
  async execute(dto: InputDto): Promise<OutputDto> {
    const set = await prisma.workoutSet.findUnique({
      where: { id: dto.setId },
      include: {
        sessionExercise: {
          include: {
            workoutSession: true,
          },
        },
      },
    });

    if (!set || set.sessionExercise.workoutSession.athleteId !== dto.userId) {
      throw new NotFoundError("Workout set not found");
    }

    if (set.sessionExercise.workoutSession.completedAt !== null) {
      throw new WorkoutSessionAlreadyCompletedError(
        "Workout session is already completed"
      );
    }

    await prisma.workoutSet.delete({
      where: { id: dto.setId },
    });

    return { success: true };
  }
}
