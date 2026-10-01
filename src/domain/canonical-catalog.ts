import { MuscleGroup } from "../generated/prisma/enums.js";

export interface CanonicalGlobalExerciseDefinition {
  id: string; // UUID fixo e determinístico
  name: string;
  primary: MuscleGroup[];
  secondary: MuscleGroup[];
}

/**
 * Catálogo Canônico Global Oficial do Trainvy.
 * Cada exercício possui um UUID fixo e imutável para garantir estabilidade
 * longitudinal entre ambientes (TEST, staging, produção).
 */
export const CANONICAL_GLOBAL_CATALOG: readonly CanonicalGlobalExerciseDefinition[] = [
  // Peito & Empurrar
  {
    id: "00000000-0000-4000-8000-000000000101",
    name: "Supino Reto com Barra",
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    name: "Supino Reto",
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    name: "Supino Inclinado com Halteres",
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },
  {
    id: "00000000-0000-4000-8000-000000000104",
    name: "Supino Inclinado",
    primary: [MuscleGroup.CHEST],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
  },

  // Pernas / Membros Inferiores
  {
    id: "00000000-0000-4000-8000-000000000105",
    name: "Agachamento Livre",
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  {
    id: "00000000-0000-4000-8000-000000000106",
    name: "Agachamento",
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  {
    id: "00000000-0000-4000-8000-000000000107",
    name: "Agachamento Búlgaro",
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  {
    id: "00000000-0000-4000-8000-000000000108",
    name: "Leg Press 45",
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS, MuscleGroup.CALVES],
  },
  {
    id: "00000000-0000-4000-8000-000000000109",
    name: "Leg Press Horizontal",
    primary: [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS, MuscleGroup.CALVES],
  },
  {
    id: "00000000-0000-4000-8000-000000000110",
    name: "Cadeira Extensora",
    primary: [MuscleGroup.QUADRICEPS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000111",
    name: "Cadeira Flexora",
    primary: [MuscleGroup.HAMSTRINGS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000112",
    name: "Mesa Flexora",
    primary: [MuscleGroup.HAMSTRINGS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000113",
    name: "Stiff",
    primary: [MuscleGroup.HAMSTRINGS, MuscleGroup.GLUTES],
    secondary: [MuscleGroup.BACK, MuscleGroup.CORE],
  },
  {
    id: "00000000-0000-4000-8000-000000000114",
    name: "Elevação Pélvica",
    primary: [MuscleGroup.GLUTES],
    secondary: [MuscleGroup.HAMSTRINGS],
  },
  {
    id: "00000000-0000-4000-8000-000000000115",
    name: "Cadeira Abdutora",
    primary: [MuscleGroup.HIP_ABDUCTORS, MuscleGroup.GLUTES],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000116",
    name: "Cadeira Adutora",
    primary: [MuscleGroup.ADDUCTORS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000117",
    name: "Panturrilha em Pé",
    primary: [MuscleGroup.CALVES],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000118",
    name: "Panturrilha Sentado",
    primary: [MuscleGroup.CALVES],
    secondary: [],
  },

  // Costas / Puxadas / Remadas
  {
    id: "00000000-0000-4000-8000-000000000119",
    name: "Puxada Frontal na Máquina",
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS],
  },
  {
    id: "00000000-0000-4000-8000-000000000120",
    name: "Puxada Frontal",
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS],
  },
  {
    id: "00000000-0000-4000-8000-000000000121",
    name: "Remada Curvada com Barra",
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS, MuscleGroup.CORE],
  },
  {
    id: "00000000-0000-4000-8000-000000000122",
    name: "Remada Curvada",
    primary: [MuscleGroup.BACK],
    secondary: [MuscleGroup.BICEPS, MuscleGroup.CORE],
  },

  // Ombros
  {
    id: "00000000-0000-4000-8000-000000000123",
    name: "Desenvolvimento Militar",
    primary: [MuscleGroup.SHOULDERS],
    secondary: [MuscleGroup.TRICEPS, MuscleGroup.CORE],
  },
  {
    id: "00000000-0000-4000-8000-000000000124",
    name: "Desenvolvimento com Halteres",
    primary: [MuscleGroup.SHOULDERS],
    secondary: [MuscleGroup.TRICEPS],
  },
  {
    id: "00000000-0000-4000-8000-000000000125",
    name: "Elevação Lateral",
    primary: [MuscleGroup.SHOULDERS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000126",
    name: "Crucifixo Inverso na Máquina",
    primary: [MuscleGroup.SHOULDERS, MuscleGroup.BACK],
    secondary: [],
  },

  // Braços (Bíceps, Tríceps, Antebraço)
  {
    id: "00000000-0000-4000-8000-000000000127",
    name: "Rosca Direta com Barra",
    primary: [MuscleGroup.BICEPS],
    secondary: [MuscleGroup.FOREARMS],
  },
  {
    id: "00000000-0000-4000-8000-000000000128",
    name: "Rosca Direta",
    primary: [MuscleGroup.BICEPS],
    secondary: [MuscleGroup.FOREARMS],
  },
  {
    id: "00000000-0000-4000-8000-000000000129",
    name: "Rosca Martelo",
    primary: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000130",
    name: "Rosca Scott",
    primary: [MuscleGroup.BICEPS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000131",
    name: "Tríceps Corda",
    primary: [MuscleGroup.TRICEPS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000132",
    name: "Tríceps Testa",
    primary: [MuscleGroup.TRICEPS],
    secondary: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000133",
    name: "Tríceps Francês Unilateral",
    primary: [MuscleGroup.TRICEPS],
    secondary: [],
  },
] as const;

export const CANONICAL_GLOBAL_BY_NAME = new Map<string, CanonicalGlobalExerciseDefinition>(
  CANONICAL_GLOBAL_CATALOG.map((item) => [item.name.trim().toLowerCase(), item]),
);

export const CANONICAL_GLOBAL_BY_ID = new Map<string, CanonicalGlobalExerciseDefinition>(
  CANONICAL_GLOBAL_CATALOG.map((item) => [item.id, item]),
);

export function getCanonicalGlobalByName(name: string): CanonicalGlobalExerciseDefinition | undefined {
  return CANONICAL_GLOBAL_BY_NAME.get(name.trim().toLowerCase());
}

export function getCanonicalGlobalById(id: string): CanonicalGlobalExerciseDefinition | undefined {
  return CANONICAL_GLOBAL_BY_ID.get(id);
}
