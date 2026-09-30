import {
  NotFoundError,
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

export class CompletePeriodization {
  async execute(dto: InputDto): Promise<PeriodizationLifecycleDto> {
    return await prisma.$transaction(async (tx) => {
      // 1. Verifica se há sessão de treino em andamento
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

      // 3. Idempotência: já concluída
      if (periodization.completedAt !== null) {
        return formatPeriodizationLifecycleResponse(periodization);
      }

      // 4. Bloqueia concluir periodização em DRAFT (nunca iniciada)
      if (periodization.startedAt === null) {
        throw new PeriodizationNotStartedError(
          "A periodização nunca foi iniciada e não pode ser concluída.",
        );
      }

      const now = new Date();

      // 5. Se houver bloco aberto, conclui o bloco e desativa seu WorkoutPlan
      const openBlock = periodization.plans.find(
        (p) => p.activatedAt !== null && p.completedAt === null,
      );

      if (openBlock) {
        await tx.periodizationPlan.update({
          where: { id: openBlock.id },
          data: { completedAt: now },
        });

        await tx.workoutPlan.update({
          where: { id: openBlock.workoutPlanId },
          data: { isActive: false },
        });
      }

      // 6. Conclui a periodização (blocos futuros não iniciados permanecem intocados)
      const updatedPeriodization = await tx.periodization.update({
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

      return formatPeriodizationLifecycleResponse(updatedPeriodization);
    });
  }
}
