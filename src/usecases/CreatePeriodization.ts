import { ValidationError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import { derivePeriodizationStatus } from "../lib/periodization.js";

interface InputDto {
  userId: string;
  name: string;
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

export class CreatePeriodization {
  async execute(dto: InputDto): Promise<OutputDto> {
    const trimmedName = dto.name?.trim();
    if (!trimmedName) {
      throw new ValidationError("O nome da periodização é obrigatório.");
    }

    const periodization = await prisma.periodization.create({
      data: {
        id: crypto.randomUUID(),
        userId: dto.userId,
        name: trimmedName,
        goal: dto.goal?.trim() || null,
        notes: dto.notes?.trim() || null,
        isActive: false,
        startedAt: null,
        completedAt: null,
      },
    });

    return {
      id: periodization.id,
      name: periodization.name,
      goal: periodization.goal,
      notes: periodization.notes,
      isActive: periodization.isActive,
      startedAt: null,
      completedAt: null,
      createdAt: periodization.createdAt.toISOString(),
      updatedAt: periodization.updatedAt.toISOString(),
      status: derivePeriodizationStatus(periodization),
    };
  }
}
