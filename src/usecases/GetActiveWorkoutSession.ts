import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import {
  GetWorkoutSession,
  GetWorkoutSessionOutputDto,
} from "./GetWorkoutSession.js";

interface InputDto {
  userId: string;
}

export class GetActiveWorkoutSession {
  private getWorkoutSession = new GetWorkoutSession();

  async execute(dto: InputDto): Promise<GetWorkoutSessionOutputDto> {
    const activeSession = await prisma.workoutSession.findFirst({
      where: {
        athleteId: dto.userId,
        completedAt: null,
      },
      select: { id: true },
    });

    if (!activeSession) {
      throw new NotFoundError("Active workout session not found");
    }

    return this.getWorkoutSession.execute({
      userId: dto.userId,
      sessionId: activeSession.id,
    });
  }
}
