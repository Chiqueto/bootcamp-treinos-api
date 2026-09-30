import {
  InvalidReorderBlocksError,
  NotFoundError,
  PeriodizationCompletedError,
  ValidationError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  periodizationId: string;
  periodizationPlanIds: string[];
}

interface OutputDto {
  id: string;
  periodizationId: string;
  workoutPlanId: string;
  order: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  workoutPlan: {
    id: string;
    name: string;
    isActive: boolean;
  };
}

export class ReorderPeriodizationPlans {
  async execute(dto: InputDto): Promise<OutputDto[]> {
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

      const allPlans = await tx.periodizationPlan.findMany({
        where: {
          periodizationId: dto.periodizationId,
        },
        orderBy: {
          order: "asc",
        },
      });

      // Divide blocos entre não-editáveis (concluídos ou ativos) e editáveis (planejados)
      const editable = allPlans.filter(
        (p) => p.activatedAt === null && p.completedAt === null,
      );

      if (dto.periodizationPlanIds.length !== editable.length) {
        throw new InvalidReorderBlocksError(
          "A reordenação deve conter exatamente todos os blocos planejados/futuros.",
        );
      }

      const uniqueIds = new Set(dto.periodizationPlanIds);
      if (uniqueIds.size !== dto.periodizationPlanIds.length) {
        throw new ValidationError("IDs duplicados encontrados na reordenação.");
      }

      const editableIdSet = new Set(editable.map((p) => p.id));
      for (const id of dto.periodizationPlanIds) {
        if (!editableIdSet.has(id)) {
          throw new InvalidReorderBlocksError(
            "Somente blocos planejados (não iniciados) podem ser reordenados.",
          );
        }
      }

      // As ordens alvo são exatamente as ordens atuais dos blocos editáveis
      const targetOrders = editable.map((p) => p.order).sort((a, b) => a - b);

      // Fase 1: Desloca para ordens temporárias altas (> 0) para evitar colisão no UNIQUE(periodizationId, order)
      for (let i = 0; i < dto.periodizationPlanIds.length; i++) {
        await tx.periodizationPlan.update({
          where: { id: dto.periodizationPlanIds[i] },
          data: { order: 100000 + i },
        });
      }

      // Fase 2: Atribui a ordem final desejada
      for (let i = 0; i < dto.periodizationPlanIds.length; i++) {
        await tx.periodizationPlan.update({
          where: { id: dto.periodizationPlanIds[i] },
          data: { order: targetOrders[i] },
        });
      }

      const updatedPlans = await tx.periodizationPlan.findMany({
        where: {
          periodizationId: dto.periodizationId,
        },
        orderBy: {
          order: "asc",
        },
        include: {
          workoutPlan: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
        },
      });

      return updatedPlans.map((p) => ({
        id: p.id,
        periodizationId: p.periodizationId,
        workoutPlanId: p.workoutPlanId,
        order: p.order,
        plannedStartDate: p.plannedStartDate
          ? p.plannedStartDate.toISOString().split("T")[0]
          : null,
        plannedEndDate: p.plannedEndDate
          ? p.plannedEndDate.toISOString().split("T")[0]
          : null,
        activatedAt: p.activatedAt ? p.activatedAt.toISOString() : null,
        completedAt: p.completedAt ? p.completedAt.toISOString() : null,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        workoutPlan: {
          id: p.workoutPlan.id,
          name: p.workoutPlan.name,
          isActive: p.workoutPlan.isActive,
        },
      }));
    });
  }
}
