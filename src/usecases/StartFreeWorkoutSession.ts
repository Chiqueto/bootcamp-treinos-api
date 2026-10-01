import { ConflictError } from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { WorkoutSessionOrigin } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
}

interface OutputDto {
  userWorkoutSessionId: string;
  workoutSessionId: string;
  origin?: WorkoutSessionOrigin;
  workoutDayId: string | null;
  workoutPlanId?: string | null;
  workoutPlanNameSnapshot?: string | null;
  workoutDayNameSnapshot?: string | null;
  startedAt: string;
  completedAt: string | null;
}

export class StartFreeWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    try {
      const activeSession = await prisma.workoutSession.findFirst({
        where: {
          athleteId: dto.userId,
          completedAt: null,
        },
      });

      if (activeSession) {
        throw new ConflictError("There is already a workout session in progress");
      }

      const session = await prisma.workoutSession.create({
        data: {
          id: crypto.randomUUID(),
          origin: WorkoutSessionOrigin.FREE,
          athleteId: dto.userId,
          workoutDayId: null,
          workoutPlanId: null,
          workoutPlanNameSnapshot: null,
          workoutDayNameSnapshot: null,
          startedAt: new Date(),
        },
      });

      return {
        userWorkoutSessionId: session.id,
        workoutSessionId: session.id,
        origin: session.origin,
        workoutDayId: session.workoutDayId,
        workoutPlanId: session.workoutPlanId,
        workoutPlanNameSnapshot: session.workoutPlanNameSnapshot,
        workoutDayNameSnapshot: session.workoutDayNameSnapshot,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("There is already a workout session in progress");
      }
      throw error;
    }
  }
}
