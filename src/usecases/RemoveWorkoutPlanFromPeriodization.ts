import {
  ActiveBlockCannotBeRemovedError,
  CompletedBlockCannotBeRemovedError,
  NotFoundError,
  PeriodizationCompletedError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  periodizationId: string;
  periodizationPlanId: string;
}

export class RemoveWorkoutPlanFromPeriodization {
  async execute(dto: InputDto): Promise<{ success: boolean; message: string }> {
    return await prisma.$transaction(async (tx) => {
      const periodization = await tx.periodization.findFirst({
        where: {
          id: dto.periodizationId,
          userId: dto.userId,
        },
      });

      if (!periodization) {
        throw new NotFoundError("Periodização não encontrada.");
      }

      if (periodization.completedAt !== null) {
        throw new PeriodizationCompletedError(
          "A periodização já foi concluída e sua estrutura não pode ser alterada.",
        );
      }

      const plan = await tx.periodizationPlan.findFirst({
        where: {
          id: dto.periodizationPlanId,
          periodizationId: dto.periodizationId,
        },
      });

      if (!plan) {
        throw new NotFoundError("Bloco de periodização não encontrado.");
      }

      if (plan.completedAt !== null) {
        throw new CompletedBlockCannotBeRemovedError(
          "Um bloco já concluído não pode ser removido da periodização.",
        );
      }

      if (plan.activatedAt !== null && plan.completedAt === null) {
        throw new ActiveBlockCannotBeRemovedError(
          "O bloco atual em andamento não pode ser removido da periodização.",
        );
      }

      const removedOrder = plan.order;

      // 1. Remove apenas o PeriodizationPlan (WorkoutPlan permanece intacto no banco)
      await tx.periodizationPlan.delete({
        where: {
          id: plan.id,
        },
      });

      // 2. Compacta as ordens subsequentes deterministicamente em duas fases
      const subsequentPlans = await tx.periodizationPlan.findMany({
        where: {
          periodizationId: dto.periodizationId,
          order: { gt: removedOrder },
        },
        orderBy: { order: "asc" },
      });

      // Fase 1: Desloca para ordens temporárias altas (> 0) para evitar qualquer colisão
      for (let i = 0; i < subsequentPlans.length; i++) {
        await tx.periodizationPlan.update({
          where: { id: subsequentPlans[i].id },
          data: { order: 100000 + i },
        });
      }

      // Fase 2: Atribui as ordens finais compactadas
      for (let i = 0; i < subsequentPlans.length; i++) {
        await tx.periodizationPlan.update({
          where: { id: subsequentPlans[i].id },
          data: { order: subsequentPlans[i].order - 1 },
        });
      }

      return {
        success: true,
        message: "Bloco removido da periodização com sucesso.",
      };
    });
  }
}
