import {
  ConflictError,
  NotFoundError,
  PeriodizationCompletedError,
  PeriodizationHasNoPlansError,
} from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
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

export class ActivatePeriodization {
  async execute(dto: InputDto): Promise<PeriodizationLifecycleDto> {
    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Verifica se há sessão de treino em andamento
        await assertNoActiveWorkoutSession(tx, dto.userId);

        // 2. Busca a periodização com seus planos
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
            "A periodização já foi concluída e não pode ser ativada.",
          );
        }

        if (periodization.plans.length === 0) {
          throw new PeriodizationHasNoPlansError();
        }

        // 3. Idempotência: já está ativa e sincronizada com seu bloco
        const currentOpenBlock = periodization.plans.find(
          (p) => p.activatedAt !== null && p.completedAt === null,
        );

        if (
          periodization.isActive &&
          currentOpenBlock &&
          currentOpenBlock.workoutPlan.isActive
        ) {
          return formatPeriodizationLifecycleResponse(periodization);
        }

        const now = new Date();

        // 4. Pausa qualquer outra periodização ativa do atleta (atômico)
        const otherActivePeriodizations = await tx.periodization.findMany({
          where: {
            userId: dto.userId,
            isActive: true,
            id: { not: periodization.id },
          },
          include: {
            plans: {
              where: {
                activatedAt: { not: null },
                completedAt: null,
              },
            },
          },
        });

        for (const otherP of otherActivePeriodizations) {
          await tx.periodization.update({
            where: { id: otherP.id },
            data: { isActive: false },
          });
          for (const block of otherP.plans) {
            await tx.workoutPlan.update({
              where: { id: block.workoutPlanId },
              data: { isActive: false },
            });
          }
        }

        // 5. Desativa qualquer plano standalone ativo anterior
        await tx.workoutPlan.updateMany({
          where: {
            userId: dto.userId,
            isActive: true,
          },
          data: {
            isActive: false,
          },
        });

        // 6. Seleciona o bloco a ser ativado
        let targetBlock = currentOpenBlock;

        if (!targetBlock) {
          // Não há bloco aberto: seleciona o primeiro bloco não concluído
          const firstUncompleted = periodization.plans.find(
            (p) => p.completedAt === null,
          );

          if (!firstUncompleted) {
            // Todos os blocos foram concluídos
            throw new PeriodizationCompletedError(
              "Todos os blocos desta periodização já foram concluídos.",
            );
          }

          targetBlock = firstUncompleted;

          // Preenche activatedAt do novo bloco
          await tx.periodizationPlan.update({
            where: { id: targetBlock.id },
            data: { activatedAt: now },
          });
        }

        // 7. Ativa o WorkoutPlan do bloco
        await tx.workoutPlan.update({
          where: { id: targetBlock.workoutPlanId },
          data: { isActive: true },
        });

        // 8. Ativa a Periodization (registra startedAt apenas na primeira ativação)
        const updatedPeriodization = await tx.periodization.update({
          where: { id: periodization.id },
          data: {
            isActive: true,
            ...(periodization.startedAt === null ? { startedAt: now } : {}),
          },
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

        return formatPeriodizationLifecycleResponse(updatedPeriodization);
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
        throw new ConflictError(
          "Conflito de unicidade ao ativar periodização. Verifique se há outra periodização ativa.",
          "CONFLICT",
        );
      }
      throw error;
    }
  }
}
