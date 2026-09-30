import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import { derivePeriodizationStatus } from "../lib/periodization.js";

interface InputDto {
  userId: string;
  periodizationId: string;
}

interface OutputDto {
  id: string;
  name: string;
  goal: string | null;
  notes: string | null;
  isActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  plans: Array<{
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
  }>;
}

export class GetPeriodization {
  async execute(dto: InputDto): Promise<OutputDto> {
    const periodization = await prisma.periodization.findFirst({
      where: {
        id: dto.periodizationId,
        userId: dto.userId,
      },
      include: {
        plans: {
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
        },
      },
    });

    if (!periodization) {
      throw new NotFoundError("Periodização não encontrada.");
    }

    return {
      id: periodization.id,
      name: periodization.name,
      goal: periodization.goal,
      notes: periodization.notes,
      isActive: periodization.isActive,
      startedAt: periodization.startedAt
        ? periodization.startedAt.toISOString()
        : null,
      completedAt: periodization.completedAt
        ? periodization.completedAt.toISOString()
        : null,
      createdAt: periodization.createdAt.toISOString(),
      updatedAt: periodization.updatedAt.toISOString(),
      status: derivePeriodizationStatus(periodization),
      plans: periodization.plans.map((p) => ({
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
      })),
    };
  }
}
