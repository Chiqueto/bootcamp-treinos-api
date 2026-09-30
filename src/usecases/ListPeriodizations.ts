import { prisma } from "../lib/db.js";
import { derivePeriodizationStatus } from "../lib/periodization.js";

interface InputDto {
  userId: string;
}

interface PeriodizationItemDto {
  id: string;
  name: string;
  goal: string | null;
  notes: string | null;
  isActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totalPlans: number;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
}

export class ListPeriodizations {
  async execute(dto: InputDto): Promise<PeriodizationItemDto[]> {
    const periodizations = await prisma.periodization.findMany({
      where: {
        userId: dto.userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        _count: {
          select: {
            plans: true,
          },
        },
      },
    });

    return periodizations.map((p) => ({
      id: p.id,
      name: p.name,
      goal: p.goal,
      notes: p.notes,
      isActive: p.isActive,
      startedAt: p.startedAt ? p.startedAt.toISOString() : null,
      completedAt: p.completedAt ? p.completedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      totalPlans: p._count.plans,
      status: derivePeriodizationStatus(p),
    }));
  }
}
