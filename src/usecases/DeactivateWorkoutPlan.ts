import {
  ActiveWorkoutSessionError,
  NotFoundError,
  PlanBelongsToPeriodizationError,
  PlanIsActivePeriodizationBlockError,
} from "../errors/index.js";
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

export class DeactivateWorkoutPlan {
  async execute(dto: InputDto): Promise<OutputDto> {
    return await prisma.$transaction(async (tx) => {
      const plan = await tx.workoutPlan.findUnique({
        where: { id: dto.workoutPlanId },
        include: {
          periodizationPlan: {
            include: {
              periodization: true,
            },
          },
        },
      });

      if (!plan || plan.userId !== dto.userId) {
        throw new NotFoundError("Workout plan not found");
      }

      // 1. Idempotência: Se já estiver inativo
      if (!plan.isActive) {
        return {
          id: plan.id,
          name: plan.name,
          isActive: false,
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

      // 3. Não desativar bloco de Periodization diretamente
      if (plan.periodizationPlan) {
        if (plan.periodizationPlan.periodization.isActive) {
          throw new PlanIsActivePeriodizationBlockError();
        }

        throw new PlanBelongsToPeriodizationError(
          "Este plano pertence a uma periodização e não pode ser desativado diretamente.",
        );
      }

      // 4. Desativar plano standalone
      const updated = await tx.workoutPlan.update({
        where: { id: plan.id },
        data: { isActive: false },
      });

      return {
        id: updated.id,
        name: updated.name,
        isActive: updated.isActive,
      };
    });
  }
}
