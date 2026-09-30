import {
  NotFoundError,
  PeriodizationCompletedError,
  PeriodizationNotStartedError,
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

export class DeactivatePeriodization {
  async execute(dto: InputDto): Promise<PeriodizationLifecycleDto> {
    return await prisma.$transaction(async (tx) => {
      // 1. Verifica se há sessão de treino aberta
      await assertNoActiveWorkoutSession(tx, dto.userId);

      // 2. Busca a periodização com seus blocos
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
                select: { name: true, isActive: true },
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
          "A periodização já foi concluída e não pode ser pausada.",
        );
      }

      if (periodization.startedAt === null) {
        throw new PeriodizationNotStartedError(
          "A periodização nunca foi iniciada e não pode ser pausada.",
        );
      }

      // 3. Idempotência: se já estiver inativa (pausada), retorna imediatamente
      if (!periodization.isActive) {
        return formatPeriodizationLifecycleResponse(periodization);
      }

      // 4. Pausa a periodização
      const updatedPeriodization = await tx.periodization.update({
        where: { id: periodization.id },
        data: { isActive: false },
        include: {
          plans: {
            orderBy: { order: "asc" },
            include: {
              workoutPlan: {
                select: { name: true },
              },
            },
          },
        },
      });

      // 5. Desativa o WorkoutPlan do bloco aberto
      const openBlock = periodization.plans.find(
        (p) => p.activatedAt !== null && p.completedAt === null,
      );

      if (openBlock) {
        await tx.workoutPlan.update({
          where: { id: openBlock.workoutPlanId },
          data: { isActive: false },
        });
      }

      return formatPeriodizationLifecycleResponse(updatedPeriodization);
    });
  }
}
