import { MuscleGroup, MuscleRole, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  query?: string;
  limit?: number;
}

export interface ExerciseOutputDto {
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

    const exercises = await prisma.exercise.findMany({
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

    const normalizedQuery = normalizeExerciseSearch(dto.query ?? "");
    const matchingExercises = normalizedQuery
      ? exercises
          .filter((exercise) =>
            normalizeExerciseSearch(exercise.name).includes(normalizedQuery),
          )
          .sort((a, b) => {
            const aName = normalizeExerciseSearch(a.name);
            const bName = normalizeExerciseSearch(b.name);
            const aRank =
              aName === normalizedQuery
                ? 0
                : aName.startsWith(normalizedQuery)
                  ? 1
                  : 2;
            const bRank =
              bName === normalizedQuery
                ? 0
                : bName.startsWith(normalizedQuery)
                  ? 1
                  : 2;
            return (
              aRank - bRank ||
              aName.localeCompare(bName) ||
              a.id.localeCompare(b.id)
            );
          })
      : exercises;

    return dto.limit === undefined
      ? matchingExercises
      : matchingExercises.slice(0, Math.max(0, dto.limit));
  }
}

function normalizeExerciseSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}
