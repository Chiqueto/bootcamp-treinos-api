import { NotFoundError, ValidationError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import { derivePeriodizationStatus } from "../lib/periodization.js";

interface InputDto {
  userId: string;
  periodizationId: string;
  name?: string;
  goal?: string | null;
  notes?: string | null;
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
}

export class UpdatePeriodization {
  async execute(dto: InputDto): Promise<OutputDto> {
    const existing = await prisma.periodization.findFirst({
      where: {
        id: dto.periodizationId,
        userId: dto.userId,
      },
    });

    if (!existing) {
      throw new NotFoundError("Periodização não encontrada.");
    }

    let trimmedName: string | undefined;
    if (dto.name !== undefined) {
      trimmedName = dto.name.trim();
      if (!trimmedName) {
        throw new ValidationError("O nome da periodização não pode ser vazio.");
      }
    }

    const updated = await prisma.periodization.update({
      where: {
        id: dto.periodizationId,
      },
      data: {
        ...(trimmedName !== undefined ? { name: trimmedName } : {}),
        ...(dto.goal !== undefined ? { goal: dto.goal?.trim() || null } : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() || null }
          : {}),
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      goal: updated.goal,
      notes: updated.notes,
      isActive: updated.isActive,
      startedAt: updated.startedAt ? updated.startedAt.toISOString() : null,
      completedAt: updated.completedAt
        ? updated.completedAt.toISOString()
        : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      status: derivePeriodizationStatus(updated),
    };
  }
}
