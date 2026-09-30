import {
  NoOpenBlockError,
  NotFoundError,
  PeriodizationCompletedError,
  PeriodizationNotActiveError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";
import {
  assertNoActiveWorkoutSession,
  formatPeriodizationLifecycleResponse,
  PeriodizationLifecycleDto,
} from "../lib/periodization.js";

interface InputDto {
  userId: string;
  periodizationId: string;
}

export class AdvancePeriodizationPlan {
  async execute(dto: InputDto): Promise<PeriodizationLifecycleDto> {
    return await prisma.$transaction(async (tx) => {
      // 1. Verifica se há sessão de treino em andamento
      await assertNoActiveWorkoutSession(tx, dto.userId);

      // 2. Busca a periodização com todos os blocos ordenados
      const periodization = await tx.periodization.findFirst({
        where: {
          id: dto.periodizationId,
          userId: dto.userId,
        },
        include: {
          plans: {
            orderBy: { order: "asc" },
            include: {
              workoutPlan: {
                select: { id: true, name: true, isActive: true },
              },
            },
          },
        },
      });

      if (!periodization) {
        throw new NotFoundError("Periodização não encontrada.");
      }

      if (periodization.completedAt !== null) {
        throw new PeriodizationCompletedError(
          "A periodização já foi concluída e não pode ser avançada.",
        );
      }

      if (!periodization.isActive) {
        throw new PeriodizationNotActiveError(
          "A periodização precisa estar ativa para avançar de bloco.",
        );
      }

      // 3. Identifica o bloco atualmente aberto
      const currentBlock = periodization.plans.find(
        (p) => p.activatedAt !== null && p.completedAt === null,
      );

      if (!currentBlock) {
        throw new NoOpenBlockError();
      }

      const now = new Date();

      // 4. Conclui o bloco atual e desativa seu WorkoutPlan
      await tx.periodizationPlan.update({
        where: { id: currentBlock.id },
        data: { completedAt: now },
      });

      await tx.workoutPlan.update({
        where: { id: currentBlock.workoutPlanId },
        data: { isActive: false },
      });

      // 5. Procura o próximo bloco ainda não concluído com order > currentBlock.order
      const nextBlock = periodization.plans.find(
        (p) => p.completedAt === null && p.order > currentBlock.order,
      );

      if (nextBlock) {
        // Ativa o próximo bloco
        await tx.periodizationPlan.update({
          where: { id: nextBlock.id },
          data: { activatedAt: now },
        });

        await tx.workoutPlan.update({
          where: { id: nextBlock.workoutPlanId },
          data: { isActive: true },
        });

        // Recarrega a periodização com os dados atualizados
        const updatedPeriodization = await tx.periodization.findUniqueOrThrow({
          where: { id: periodization.id },
          include: {
            plans: {
              orderBy: { order: "asc" },
              include: {
                workoutPlan: { select: { name: true } },
              },
            },
          },
        });

        return formatPeriodizationLifecycleResponse(updatedPeriodization);
      } else {
        // Último bloco: conclui a periodização
        const completedPeriodization = await tx.periodization.update({
          where: { id: periodization.id },
          data: {
            isActive: false,
            completedAt: now,
          },
          include: {
            plans: {
              orderBy: { order: "asc" },
              include: {
                workoutPlan: { select: { name: true } },
              },
            },
          },
        });

        return formatPeriodizationLifecycleResponse(completedPeriodization);
      }
    });
  }
}
