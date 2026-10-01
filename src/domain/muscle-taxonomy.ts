import { ValidationError } from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { MuscleGroup, MuscleRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

export { MuscleGroup, MuscleRole };

export interface MuscleClassification {
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
}

/**
 * Mapeamento canônico explícito e versionado de exercícios conhecidos.
 * Usado exclusivamente para catalogar exercícios globais (ownerUserId = null).
 * Exercícios personalizados dos usuários NUNCA são modificados por este catálogo.
 */
export const GLOBAL_EXERCISE_MUSCLE_MAPPING: Record<string, MuscleClassification> = {
  // Peito & Empurrar
  "supino reto com barra": {
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },
  "supino reto": {
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },
  "supino inclinado com halteres": {
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },
  "supino inclinado": {
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },

  // Pernas / Membros Inferiores
  "agachamento livre": {
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  "agachamento": {
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  "agachamento búlgaro": {
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  "leg press 45": {
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS, MuscleGroup.CALVES],
  },
  "leg press horizontal": {
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS, MuscleGroup.CALVES],
  },
  "cadeira extensora": {
    primary: [MuscleGroup.QUADRICEPS],
    secondary: [],
  },
  "cadeira flexora": {
    primary: [MuscleGroup.HAMSTRINGS],
    secondary: [],
  },
  "mesa flexora": {
    primary: [MuscleGroup.HAMSTRINGS],
    secondary: [],
  },
  "stiff": {
    primary: [MuscleGroup.HAMSTRINGS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.BACK, MuscleGroup.CORE],
  },
  "elevação pélvica": {
    primary: [MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  "cadeira abdutora": {
    primary: [MuscleGroup.HIP_ABDUCTORS, MuscleGroup.GLUTES],
    secondary: [],
  },
  "cadeira adutora": {
    primary: [MuscleGroup.ADDUCTORS],
    secondary: [],
  },
  "panturrilha em pé": {
    primary: [MuscleGroup.CALVES],
    secondary: [],
  },
  "panturrilha sentado": {
    primary: [MuscleGroup.CALVES],
    secondary: [],
  },

  // Costas / Puxadas / Remadas
  "puxada frontal na máquina": {
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS],
  },
  "puxada frontal": {
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS],
  },
  "remada curvada com barra": {
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS, MuscleGroup.CORE],
  },
  "remada curvada": {
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS, MuscleGroup.CORE],
  },

  // Ombros
  "desenvolvimento militar": {
    primary: [MuscleGroup.SHOULDERS],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.CORE],
  },
  "desenvolvimento com halteres": {
    primary: [MuscleGroup.SHOULDERS],
    secondary: [MuscleGroup.TRICEPS],
  },
  "elevação lateral": {
    primary: [MuscleGroup.SHOULDERS],
    secondary: [],
  },
  "crucifixo inverso na máquina": {
    primary: [MuscleGroup.SHOULDERS, MuscleGroup.BACK],
    secondary: [],
  },

  // Braços (Bíceps, Tríceps, Antebraço)
  "rosca direta com barra": {
    primary: [MuscleGroup.BICEPS],
    secondary: [MuscleGroup.FOREARMS],
  },
  "rosca direta": {
    primary: [MuscleGroup.BICEPS],
    secondary: [MuscleGroup.FOREARMS],
  },
  "rosca martelo": {
    primary: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    secondary: [],
  },
  "rosca scott": {
    primary: [MuscleGroup.BICEPS],
    secondary: [],
  },
  "tríceps corda": {
    primary: [MuscleGroup.TRICEPS],
    secondary: [],
  },
  "tríceps testa": {
    primary: [MuscleGroup.TRICEPS],
    secondary: [],
  },
  "tríceps francês unilateral": {
    primary: [MuscleGroup.TRICEPS],
    secondary: [],
  },
};

/**
 * Valida a integridade da classificação muscular:
 * - Deduplica cada lista.
 * - Impede o mesmo músculo como PRIMARY e SECONDARY.
 * - Se classificado, exige pelo menos 1 PRIMARY.
 * - Aceita múltiplos PRIMARY.
 */
export function validateAndSanitizeMuscles(
  primaryInput?: MuscleGroup[],
  secondaryInput?: MuscleGroup[],
): {
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
  isClassified: boolean;
} {
  const primarySet = new Set(primaryInput ?? []);
  const secondarySet = new Set(secondaryInput ?? []);

  // Verificar sobreposição
  for (const muscle of secondarySet) {
    if (primarySet.has(muscle)) {
      throw new ValidationError(
        `O grupo muscular ${muscle} não pode ser simultaneamente primário e secundário.`,
      );
    }
  }

  const primary = Array.from(primarySet);
  const secondary = Array.from(secondarySet);

  const isClassified = primary.length > 0 || secondary.length > 0;

  if (isClassified && primary.length === 0) {
    throw new ValidationError(
      "Um exercício classificado deve possuir pelo menos um grupo muscular primário (PRIMARY).",
    );
  }

  return { primary, secondary, isClassified };
}

/**
 * Sincroniza / classifica exercícios globais conhecidos no banco de dados.
 * Idempotente: não cria duplicatas e NUNCA altera exercícios customizados (ownerUserId != null).
 */
export async function syncGlobalExerciseMuscles(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{
  totalGlobals: number;
  classified: number;
  unclassified: number;
  unclassifiedNames: string[];
}> {
  const globals = await client.exercise.findMany({
    where: { ownerUserId: null },
    include: { muscles: true },
  });

  let classified = 0;
  let unclassified = 0;
  const unclassifiedNames: string[] = [];

  for (const globalEx of globals) {
    const normalizedName = globalEx.name.trim().toLowerCase();
    const mapping = GLOBAL_EXERCISE_MUSCLE_MAPPING[normalizedName];

    if (!mapping) {
      unclassified++;
      unclassifiedNames.push(globalEx.name);
      continue;
    }

    // Se já classificado, não duplicar
    if (globalEx.muscles.length > 0) {
      classified++;
      continue;
    }

    const records: Array<{
      exerciseId: string;
      muscleGroup: MuscleGroup;
      role: MuscleRole;
    }> = [
      ...mapping.primary.map((mg) => ({
        exerciseId: globalEx.id,
        muscleGroup: mg,
        role: MuscleRole.PRIMARY,
      })),
      ...mapping.secondary.map((mg) => ({
        exerciseId: globalEx.id,
        muscleGroup: mg,
        role: MuscleRole.SECONDARY,
      })),
    ];

    if (records.length > 0) {
      await client.exerciseMuscle.createMany({
        data: records,
        skipDuplicates: true,
      });
    }

    classified++;
  }

  return {
    totalGlobals: globals.length,
    classified,
    unclassified,
    unclassifiedNames,
  };
}
