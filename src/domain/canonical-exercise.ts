import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

/**
 * Resolução canônica de exercício por nome exato normalizado (LOWER(TRIM(name))).
 *
 * Invariantes da Fase 3 / Task 3.1C:
 * 1. Prioridade:
 *    - Exercício do próprio usuário com match exato (ownerUserId === userId)
 *    - Exercício global com match exato (ownerUserId === null)
 *    - Nenhum match -> null
 * 2. NUNCA realizar fuzzy matching ou correspondência parcial.
 * 3. NUNCA vincular a exercícios pertencentes a outros usuários.
 * 4. NUNCA criar automaticamente um Exercise a partir de texto arbitrário.
 */
export async function resolveCanonicalExerciseMap(params: {
  userId: string;
  names: string[];
  tx?: Prisma.TransactionClient;
}): Promise<Map<string, string>> {
  const { userId, names, tx } = params;
  const client = tx ?? prisma;
  const result = new Map<string, string>();

  // Normalizar os nomes buscados
  const normalizedSearchNames = new Set(
    names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0),
  );

  if (normalizedSearchNames.size === 0) {
    return result;
  }

  // Buscar todos os exercícios acessíveis ao usuário (globais + próprios)
  const accessibleExercises = await client.exercise.findMany({
    where: {
      OR: [{ ownerUserId: userId }, { ownerUserId: null }],
    },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
    },
  });

  // Indexar com prioridade: custom do usuário sobrescreve global em caso de mesmo nome
  const userMap = new Map<string, string>();
  const globalMap = new Map<string, string>();

  for (const ex of accessibleExercises) {
    const key = ex.name.trim().toLowerCase();
    if (ex.ownerUserId === userId) {
      userMap.set(key, ex.id);
    } else if (ex.ownerUserId === null) {
      if (!globalMap.has(key)) {
        globalMap.set(key, ex.id);
      }
    }
  }

  // Para cada nome original, resolver o id canônico
  for (const originalName of names) {
    const key = originalName.trim().toLowerCase();
    const matchedId = userMap.get(key) ?? globalMap.get(key);
    if (matchedId) {
      result.set(originalName, matchedId);
    }
  }

  return result;
}

export async function resolveCanonicalExerciseId(params: {
  userId: string;
  name: string;
  tx?: Prisma.TransactionClient;
}): Promise<string | null> {
  const map = await resolveCanonicalExerciseMap({
    userId: params.userId,
    names: [params.name],
    tx: params.tx,
  });
  return map.get(params.name) ?? null;
}
