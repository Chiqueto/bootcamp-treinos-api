import {
  ActivePlanCannotBeAttachedError,
  NotFoundError,
  PeriodizationCompletedError,
  PlanAlreadyInPeriodizationError,
  ValidationError,
} from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  periodizationId: string;
  workoutPlanId: string;
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

export class AddWorkoutPlanToPeriodization {
  async execute(dto: InputDto): Promise<OutputDto> {
    const periodization = await prisma.periodization.findFirst({
      where: {
        id: dto.periodizationId,
        userId: dto.userId,
      },
      include: {
        plans: {
          select: {
            order: true,
          },
        },
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

    const workoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        id: dto.workoutPlanId,
        userId: dto.userId,
      },
    });

    if (!workoutPlan) {
      throw new NotFoundError("Plano de treino não encontrado.");
    }

    if (workoutPlan.isActive) {
      throw new ActivePlanCannotBeAttachedError(
        "Um plano ativo não pode ser anexado a uma periodização. Desative-o primeiro.",
      );
    }

    const existingAttachment = await prisma.periodizationPlan.findUnique({
      where: {
        workoutPlanId: dto.workoutPlanId,
      },
    });

    if (existingAttachment) {
      throw new PlanAlreadyInPeriodizationError(
        "Este plano de treino já pertence a uma periodização.",
      );
    }

    const startDate = dto.plannedStartDate
      ? new Date(dto.plannedStartDate)
      : null;
    const endDate = dto.plannedEndDate ? new Date(dto.plannedEndDate) : null;

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

    const maxOrder = periodization.plans.reduce(
      (max, p) => Math.max(max, p.order),
      0,
    );
    const targetOrder = maxOrder + 1;

    try {
      const plan = await prisma.periodizationPlan.create({
        data: {
          id: crypto.randomUUID(),
          periodizationId: dto.periodizationId,
          workoutPlanId: dto.workoutPlanId,
          order: targetOrder,
          plannedStartDate: startDate,
          plannedEndDate: endDate,
          notes: dto.notes?.trim() || null,
          activatedAt: null,
          completedAt: null,
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
        id: plan.id,
        periodizationId: plan.periodizationId,
        workoutPlanId: plan.workoutPlanId,
        order: plan.order,
        plannedStartDate: plan.plannedStartDate
          ? plan.plannedStartDate.toISOString().split("T")[0]
          : null,
        plannedEndDate: plan.plannedEndDate
          ? plan.plannedEndDate.toISOString().split("T")[0]
          : null,
        activatedAt: plan.activatedAt ? plan.activatedAt.toISOString() : null,
        completedAt: plan.completedAt ? plan.completedAt.toISOString() : null,
        notes: plan.notes,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        workoutPlan: {
          id: plan.workoutPlan.id,
          name: plan.workoutPlan.name,
          isActive: plan.workoutPlan.isActive,
        },
      };
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002") ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2002")
      ) {
        throw new PlanAlreadyInPeriodizationError(
          "Este plano de treino já pertence a uma periodização.",
        );
      }
      throw error;
    }
  }
}
