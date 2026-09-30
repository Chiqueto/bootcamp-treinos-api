import {
  ActiveWorkoutSessionError,
  ConflictError,
  NotFoundError,
  PlanBelongsToPeriodizationError,
} from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
}

interface OutputDto {
  id: string;
  name: string;
  isActive: boolean;
}

export class ActivateWorkoutPlan {
  async execute(dto: InputDto): Promise<OutputDto> {
    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await tx.workoutPlan.findUnique({
          where: { id: dto.workoutPlanId },
          include: {
            periodizationPlan: true,
          },
        });

        if (!plan || plan.userId !== dto.userId) {
          throw new NotFoundError("Workout plan not found");
        }

        // 1. Idempotência: Se já estiver ativo
        if (plan.isActive) {
          return {
            id: plan.id,
            name: plan.name,
            isActive: true,
          };
        }

        // 2. Bloquear se houver sessão de treino aberta
        const activeSession = await tx.workoutSession.findFirst({
          where: {
            athleteId: dto.userId,
            completedAt: null,
          },
        });

        if (activeSession) {
          throw new ActiveWorkoutSessionError();
        }

        // 3. Bloquear se o plano pertencer a uma Periodization
        if (plan.periodizationPlan) {
          throw new PlanBelongsToPeriodizationError();
        }

        // 4. Se existir uma Periodization ativa: pausar a periodização
        const activePeriodization = await tx.periodization.findFirst({
          where: {
            userId: dto.userId,
            isActive: true,
          },
        });

        if (activePeriodization) {
          await tx.periodization.update({
            where: { id: activePeriodization.id },
            data: { isActive: false },
          });
        }

        // 5. Desativar qualquer plano ativo atual do usuário
        await tx.workoutPlan.updateMany({
          where: {
            userId: dto.userId,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        // 6. Ativar o plano standalone escolhido
        const updated = await tx.workoutPlan.update({
          where: { id: plan.id },
          data: { isActive: true },
        });

        return {
          id: updated.id,
          name: updated.name,
          isActive: updated.isActive,
        };
      });
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002") ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2002")
      ) {
        throw new ConflictError("User already has an active workout plan");
      }

      throw error;
    }
  }
}
