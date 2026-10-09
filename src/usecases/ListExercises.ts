import { MuscleGroup, MuscleRole, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  query?: string;
  limit?: number;
  onlyWithHistory?: boolean;
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
    // 1. Identifica exercícios que o atleta já realizou em sessões concluídas
    const exercisedSessions = await prisma.sessionExercise.findMany({
      where: {
        workoutSession: {
          athleteId: dto.userId,
          completedAt: { not: null },
        },
        exerciseId: { not: null },
      },
      select: { exerciseId: true },
      distinct: ["exerciseId"],
    });

    const exercisedIds = new Set(
      exercisedSessions
        .map((s) => s.exerciseId)
        .filter((id): id is string => Boolean(id)),
    );

    // 2. Busca exercícios globais e customizados do usuário
    const where: Prisma.ExerciseWhereInput = {
      OR: [{ ownerUserId: null }, { ownerUserId: dto.userId }],
    };

    if (dto.onlyWithHistory) {
      where.id = { in: Array.from(exercisedIds) };
    }

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

    // 3. Deduplicação inteligente por nome normalizado:
    // Evita duplicatas visuais (ex: versão global vs custom do mesmo exercício)
    // Dando preferência para a versão que já tem histórico ou à versão personalizada do usuário
    const deduplicatedMap = new Map<string, (typeof exercises)[0]>();

    for (const ex of exercises) {
      const normalizedName = normalizeExerciseSearch(ex.name);
      const existing = deduplicatedMap.get(normalizedName);

      if (!existing) {
        deduplicatedMap.set(normalizedName, ex);
      } else {
        const currentHasHistory = exercisedIds.has(ex.id);
        const existingHasHistory = exercisedIds.has(existing.id);

        if (currentHasHistory && !existingHasHistory) {
          deduplicatedMap.set(normalizedName, ex);
        } else if (
          !existingHasHistory &&
          ex.ownerUserId === dto.userId &&
          existing.ownerUserId === null
        ) {
          deduplicatedMap.set(normalizedName, ex);
        }
      }
    }

    const deduplicatedExercises = Array.from(deduplicatedMap.values());

    const normalizedQuery = normalizeExerciseSearch(dto.query ?? "");
    const matchingExercises = normalizedQuery
      ? deduplicatedExercises
          .filter((exercise) =>
            normalizeExerciseSearch(exercise.name).includes(normalizedQuery),
          )
          .sort((a, b) => {
            const aHasHistory = exercisedIds.has(a.id) ? 0 : 1;
            const bHasHistory = exercisedIds.has(b.id) ? 0 : 1;
            if (aHasHistory !== bHasHistory) return aHasHistory - bHasHistory;

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
      : deduplicatedExercises.sort((a, b) => {
          const aHasHistory = exercisedIds.has(a.id) ? 0 : 1;
          const bHasHistory = exercisedIds.has(b.id) ? 0 : 1;
          if (aHasHistory !== bHasHistory) return aHasHistory - bHasHistory;
          return a.name.localeCompare(b.name);
        });

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
