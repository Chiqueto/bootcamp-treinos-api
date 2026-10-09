import { ConflictError, NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  sessionId: string;
}

interface OutputDto {
  success: boolean;
  sessionId: string;
}

export class CancelWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const session = await prisma.workoutSession.findUnique({
      where: { id: dto.sessionId },
    });

    if (!session || session.athleteId !== dto.userId) {
      throw new NotFoundError("Workout session not found");
    }

    if (session.completedAt !== null) {
      throw new ConflictError("Cannot cancel an already completed workout session");
    }

    // Exclui a sessão e seus registros em cascata
    await prisma.workoutSession.delete({
      where: { id: dto.sessionId },
    });

    return {
      success: true,
      sessionId: dto.sessionId,
    };
  }
}
