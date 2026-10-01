import { MuscleGroup, MuscleRole, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  query?: string;
}

interface ExerciseOutputDto {
  id: string;
  name: string;
  ownerUserId: string | null;
  muscles: Array<{
    id: string;
    muscleGroup: MuscleGroup;
    role: MuscleRole;
  }>;
}

export class ListExercises {
  async execute(dto: InputDto): Promise<ExerciseOutputDto[]> {
    const where: Prisma.ExerciseWhereInput = {
      OR: [{ ownerUserId: null }, { ownerUserId: dto.userId }],
    };

    if (dto.query && dto.query.trim().length > 0) {
      where.name = {
        contains: dto.query.trim(),
        mode: "insensitive",
      };
    }

    return prisma.exercise.findMany({
      where,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        muscles: {
          select: {
            id: true,
            muscleGroup: true,
            role: true,
          },
          orderBy: [{ role: "asc" }, { muscleGroup: "asc" }],
        },
      },
    });
  }
}
