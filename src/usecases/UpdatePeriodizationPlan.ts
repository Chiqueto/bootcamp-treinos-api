import {
  CompletedBlockImmutableError,
  NotFoundError,
  PeriodizationCompletedError,
  ValidationError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  periodizationId: string;
  periodizationPlanId: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  notes?: string | null;
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

export class UpdatePeriodizationPlan {
  async execute(dto: InputDto): Promise<OutputDto> {
    const periodization = await prisma.periodization.findFirst({
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

    const plan = await prisma.periodizationPlan.findFirst({
      where: {
        id: dto.periodizationPlanId,
        periodizationId: dto.periodizationId,
      },
    });

    if (!plan) {
      throw new NotFoundError("Bloco de periodização não encontrado.");
    }

    // Se o bloco já estiver concluído, congelar datas previstas
    if (plan.completedAt !== null) {
      if (
        dto.plannedStartDate !== undefined ||
        dto.plannedEndDate !== undefined
      ) {
        throw new CompletedBlockImmutableError(
          "As datas previstas de um bloco já concluído não podem ser alteradas.",
        );
      }
    }

    const startDate =
      dto.plannedStartDate !== undefined
        ? dto.plannedStartDate
          ? new Date(dto.plannedStartDate)
          : null
        : plan.plannedStartDate;

    const endDate =
      dto.plannedEndDate !== undefined
        ? dto.plannedEndDate
          ? new Date(dto.plannedEndDate)
          : null
        : plan.plannedEndDate;

    if (startDate && isNaN(startDate.getTime())) {
      throw new ValidationError("Data de início prevista inválida.");
    }
    if (endDate && isNaN(endDate.getTime())) {
      throw new ValidationError("Data de término prevista inválida.");
    }

    if (startDate && endDate && endDate < startDate) {
      throw new ValidationError(
        "plannedEndDate não pode ser anterior a plannedStartDate.",
      );
    }

    const updated = await prisma.periodizationPlan.update({
      where: {
        id: dto.periodizationPlanId,
      },
      data: {
        ...(dto.plannedStartDate !== undefined
          ? { plannedStartDate: startDate }
          : {}),
        ...(dto.plannedEndDate !== undefined
          ? { plannedEndDate: endDate }
          : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() || null }
          : {}),
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

    return {
      id: updated.id,
      periodizationId: updated.periodizationId,
      workoutPlanId: updated.workoutPlanId,
      order: updated.order,
      plannedStartDate: updated.plannedStartDate
        ? updated.plannedStartDate.toISOString().split("T")[0]
        : null,
      plannedEndDate: updated.plannedEndDate
        ? updated.plannedEndDate.toISOString().split("T")[0]
        : null,
      activatedAt: updated.activatedAt
        ? updated.activatedAt.toISOString()
        : null,
      completedAt: updated.completedAt
        ? updated.completedAt.toISOString()
        : null,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      workoutPlan: {
        id: updated.workoutPlan.id,
        name: updated.workoutPlan.name,
        isActive: updated.workoutPlan.isActive,
      },
    };
  }
}
