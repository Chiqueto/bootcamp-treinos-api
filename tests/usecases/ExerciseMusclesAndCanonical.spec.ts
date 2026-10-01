import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../../src/errors/index.js";
import { MuscleGroup, MuscleRole } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { CreateExercise } from "../../src/usecases/CreateExercise.js";
import { ListExercises } from "../../src/usecases/ListExercises.js";
import { UpdateExerciseMuscles } from "../../src/usecases/UpdateExerciseMuscles.js";
import {
  syncGlobalExerciseMuscles,
  validateAndSanitizeMuscles,
} from "../../src/domain/muscle-taxonomy.js";
import {
  resolveCanonicalExerciseId,
  resolveCanonicalExerciseMap,
} from "../../src/domain/canonical-exercise.js";
import {
  cleanupTestUsers,
  createTestUser,
} from "../helpers/test-db.js";

describe("Task 3.1C - Catálogo de Grupos Musculares & Resolução Canônica", () => {
  let userA: { id: string };
  let userB: { id: string };
  const trackedGlobalExerciseIds: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(async () => {
    userA = await createTestUser({ email: "user-a-muscles@test.com" });
    userB = await createTestUser({ email: "user-b-muscles@test.com" });
    testUserIds.push(userA.id, userB.id);
  });

  afterAll(async () => {
    if (trackedGlobalExerciseIds.length > 0) {
      await prisma.exercise.deleteMany({
        where: { id: { in: trackedGlobalExerciseIds } },
      });
    }
    await cleanupTestUsers(testUserIds);
  });

  describe("1. Domínio & Validação de Músculos (Item 30)", () => {
    it("permite exercício com apenas PRIMARY", () => {
      const res = validateAndSanitizeMuscles([MuscleGroup.CHEST], []);
      expect(res.isClassified).toBe(true);
      expect(res.primary).toEqual([MuscleGroup.CHEST]);
      expect(res.secondary).toEqual([]);
    });

    it("permite exercício com PRIMARY e SECONDARY", () => {
      const res = validateAndSanitizeMuscles(
        [MuscleGroup.CHEST],
        [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
      );
      expect(res.isClassified).toBe(true);
      expect(res.primary).toEqual([MuscleGroup.CHEST]);
      expect(res.secondary).toEqual([MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS]);
    });

    it("permite múltiplos PRIMARY quando tecnicamente necessário", () => {
      const res = validateAndSanitizeMuscles(
        [MuscleGroup.QUADRICEPS, MuscleGroup.GLUTES],
        [MuscleGroup.HAMSTRINGS],
      );
      expect(res.primary).toHaveLength(2);
      expect(res.primary).toContain(MuscleGroup.QUADRICEPS);
      expect(res.primary).toContain(MuscleGroup.GLUTES);
    });

    it("rejeita mesmo grupo muscular como PRIMARY e SECONDARY", () => {
      expect(() =>
        validateAndSanitizeMuscles(
          [MuscleGroup.CHEST],
          [MuscleGroup.CHEST, MuscleGroup.TRICEPS],
        ),
      ).toThrow(ValidationError);
    });

    it("rejeita exercício com SECONDARY mas sem nenhum PRIMARY", () => {
      expect(() =>
        validateAndSanitizeMuscles([], [MuscleGroup.TRICEPS]),
      ).toThrow(ValidationError);
    });

    it("deduplica grupos musculares repetidos no mesmo papel", () => {
      const res = validateAndSanitizeMuscles(
        [MuscleGroup.CHEST, MuscleGroup.CHEST],
        [MuscleGroup.TRICEPS, MuscleGroup.TRICEPS],
      );
      expect(res.primary).toEqual([MuscleGroup.CHEST]);
      expect(res.secondary).toEqual([MuscleGroup.TRICEPS]);
    });

    it("permite exercício não classificado (muscles vazios)", () => {
      const res = validateAndSanitizeMuscles(undefined, undefined);
      expect(res.isClassified).toBe(false);
      expect(res.primary).toEqual([]);
      expect(res.secondary).toEqual([]);
    });
  });

  describe("2. CreateExercise (Item 31)", () => {
    it("cria exercício customizado com classificação muscular", async () => {
      const createExercise = new CreateExercise();
      const result = await createExercise.execute({
        userId: userA.id,
        name: "Supino Reto Customizado",
        primaryMuscleGroups: [MuscleGroup.CHEST],
        secondaryMuscleGroups: [MuscleGroup.TRICEPS, MuscleGroup.SHOULDERS],
      });

      expect(result.id).toBeDefined();
      expect(result.ownerUserId).toBe(userA.id);
      expect(result.muscles).toHaveLength(3);

      const primary = result.muscles.filter((m) => m.role === MuscleRole.PRIMARY);
      const secondary = result.muscles.filter((m) => m.role === MuscleRole.SECONDARY);

      expect(primary).toHaveLength(1);
      expect(primary[0].muscleGroup).toBe(MuscleGroup.CHEST);
      expect(secondary).toHaveLength(2);
      expect(secondary.map((s) => s.muscleGroup)).toContain(MuscleGroup.TRICEPS);
      expect(secondary.map((s) => s.muscleGroup)).toContain(MuscleGroup.SHOULDERS);
    });

    it("cria exercício customizado sem músculos (retrocompatibilidade não classificado)", async () => {
      const createExercise = new CreateExercise();
      const result = await createExercise.execute({
        userId: userA.id,
        name: "Exercício Sem Músculos Inicial",
      });

      expect(result.id).toBeDefined();
      expect(result.muscles).toHaveLength(0);
    });

    it("impede criação de exercício com nome duplicado para o mesmo usuário", async () => {
      const createExercise = new CreateExercise();
      await expect(
        createExercise.execute({
          userId: userA.id,
          name: "Supino Reto Customizado",
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("3. UpdateExerciseMuscles (Item 32)", () => {
    it("permite ao proprietário atualizar atomicamente a classificação muscular", async () => {
      const createExercise = new CreateExercise();
      const ex = await createExercise.execute({
        userId: userA.id,
        name: "Remada Articulada Custom",
        primaryMuscleGroups: [MuscleGroup.BACK],
      });

      const updateMuscles = new UpdateExerciseMuscles();
      const updated = await updateMuscles.execute({
        userId: userA.id,
        exerciseId: ex.id,
        primaryMuscleGroups: [MuscleGroup.BACK],
        secondaryMuscleGroups: [MuscleGroup.BICEPS, MuscleGroup.FOREARMS],
      });

      expect(updated.muscles).toHaveLength(3);
      const roles = updated.muscles.map((m) => m.role);
      expect(roles.filter((r) => r === MuscleRole.PRIMARY)).toHaveLength(1);
      expect(roles.filter((r) => r === MuscleRole.SECONDARY)).toHaveLength(2);

      // Confirmar no banco de dados que a substituição foi atômica
      const dbMuscles = await prisma.exerciseMuscle.findMany({
        where: { exerciseId: ex.id },
      });
      expect(dbMuscles).toHaveLength(3);
    });

    it("retorna 404 ao tentar atualizar exercício de outro usuário", async () => {
      const createExercise = new CreateExercise();
      const ex = await createExercise.execute({
        userId: userA.id,
        name: "Exercício Privado de A",
        primaryMuscleGroups: [MuscleGroup.CORE],
      });

      const updateMuscles = new UpdateExerciseMuscles();
      await expect(
        updateMuscles.execute({
          userId: userB.id,
          exerciseId: ex.id,
          primaryMuscleGroups: [MuscleGroup.BACK],
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("retorna 404 ao tentar atualizar exercício global", async () => {
      const globalEx = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Exercício Global Protegido",
          ownerUserId: null,
        },
      });
      trackedGlobalExerciseIds.push(globalEx.id);

      const updateMuscles = new UpdateExerciseMuscles();
      await expect(
        updateMuscles.execute({
          userId: userA.id,
          exerciseId: globalEx.id,
          primaryMuscleGroups: [MuscleGroup.CHEST],
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("4. ListExercises com músculos (Item 33)", () => {
    it("retorna globais e customizados do usuário com músculos classificados", async () => {
      const globalEx = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Exercício Global de Teste List",
          ownerUserId: null,
          muscles: {
            create: [
              {
                id: crypto.randomUUID(),
                muscleGroup: MuscleGroup.CALVES,
                role: MuscleRole.PRIMARY,
              },
            ],
          },
        },
      });
      trackedGlobalExerciseIds.push(globalEx.id);

      const listExercises = new ListExercises();
      const listA = await listExercises.execute({
        userId: userA.id,
        query: "Exercício Global de Teste List",
      });

      expect(listA).toHaveLength(1);
      expect(listA[0].id).toBe(globalEx.id);
      expect(listA[0].muscles).toHaveLength(1);
      expect(listA[0].muscles[0].muscleGroup).toBe(MuscleGroup.CALVES);
    });

    it("não vaza exercícios customizados de outro usuário na listagem", async () => {
      const createExercise = new CreateExercise();
      await createExercise.execute({
        userId: userB.id,
        name: "Exclusivo de B Segredo",
        primaryMuscleGroups: [MuscleGroup.CHEST],
      });

      const listExercises = new ListExercises();
      const listA = await listExercises.execute({
        userId: userA.id,
        query: "Exclusivo de B Segredo",
      });

      expect(listA).toHaveLength(0);
    });
  });

  describe("5. Resolução Canônica Exata (Item 34)", () => {
    it("associa exatamente pelo nome ao exercício do próprio usuário", async () => {
      const createExercise = new CreateExercise();
      const ex = await createExercise.execute({
        userId: userA.id,
        name: "Puxador Triângulo Especial",
        primaryMuscleGroups: [MuscleGroup.BACK],
      });

      const resolved = await resolveCanonicalExerciseId({
        userId: userA.id,
        name: "  puxador triângulo especial  ",
      });
      expect(resolved).toBe(ex.id);
    });

    it("associa exatamente a exercício global se o usuário não possuir homônimo", async () => {
      const globalEx = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Agachamento Frontal Canônico Global",
          ownerUserId: null,
        },
      });
      trackedGlobalExerciseIds.push(globalEx.id);

      const resolved = await resolveCanonicalExerciseId({
        userId: userA.id,
        name: "agachamento frontal canônico global",
      });
      expect(resolved).toBe(globalEx.id);
    });

    it("prioriza o exercício do próprio usuário sobre um exercício global com mesmo nome", async () => {
      const sameName = "Elevação de Panturrilha Coincidente";
      const globalEx = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: sameName,
          ownerUserId: null,
        },
      });
      trackedGlobalExerciseIds.push(globalEx.id);

      const createExercise = new CreateExercise();
      const userEx = await createExercise.execute({
        userId: userA.id,
        name: sameName,
        primaryMuscleGroups: [MuscleGroup.CALVES],
      });

      const resolved = await resolveCanonicalExerciseId({
        userId: userA.id,
        name: sameName,
      });
      expect(resolved).toBe(userEx.id);
    });

    it("retorna null para nome desconhecido (não inventa ID)", async () => {
      const resolved = await resolveCanonicalExerciseId({
        userId: userA.id,
        name: "Salto Búlgaro Explosivo Inclinado Especial Inexistente",
      });
      expect(resolved).toBeNull();
    });

    it("NUNCA associa a exercício de outro usuário", async () => {
      const createExercise = new CreateExercise();
      await createExercise.execute({
        userId: userB.id,
        name: "Isolador Ultra Secreto de B",
        primaryMuscleGroups: [MuscleGroup.BICEPS],
      });

      const resolved = await resolveCanonicalExerciseId({
        userId: userA.id,
        name: "Isolador Ultra Secreto de B",
      });
      expect(resolved).toBeNull();
    });

    it("NUNCA faz fuzzy matching para termos parciais", async () => {
      const globalEx = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Agachamento Sumô Especial",
          ownerUserId: null,
        },
      });
      trackedGlobalExerciseIds.push(globalEx.id);

      // "Agachamento" não deve associar com "Agachamento Sumô Especial"
      const resolved = await resolveCanonicalExerciseId({
        userId: userA.id,
        name: "Agachamento",
      });
      expect(resolved).not.toBe(globalEx.id);
    });

    it("batch resolver mapeia múltiplos exercícios de uma vez", async () => {
      const globalEx = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Stiff com Barra Canônico",
          ownerUserId: null,
        },
      });
      trackedGlobalExerciseIds.push(globalEx.id);

      const map = await resolveCanonicalExerciseMap({
        userId: userA.id,
        names: ["Stiff com Barra Canônico", "Exercício Desconhecido XYZ"],
      });

      expect(map.get("Stiff com Barra Canônico")).toBe(globalEx.id);
      expect(map.get("Exercício Desconhecido XYZ")).toBeUndefined();
    });
  });

  describe("6. Sincronização e Idempotência de Globais (Item 35)", () => {
    it("classifica exercício global conhecido e é 100% idempotente", async () => {
      let globalSupino = await prisma.exercise.findFirst({
        where: { ownerUserId: null, name: "Supino Reto com Barra" },
      });
      if (!globalSupino) {
        globalSupino = await prisma.exercise.create({
          data: {
            id: crypto.randomUUID(),
            name: "Supino Reto com Barra",
            ownerUserId: null,
          },
        });
        trackedGlobalExerciseIds.push(globalSupino.id);
      }

      // Primeira execução
      const res1 = await syncGlobalExerciseMuscles();
      expect(res1.classified).toBeGreaterThanOrEqual(1);

      const muscles1 = await prisma.exerciseMuscle.findMany({
        where: { exerciseId: globalSupino.id },
      });
      expect(muscles1.length).toBeGreaterThan(0);

      // Segunda execução: idempotente
      const res2 = await syncGlobalExerciseMuscles();
      expect(res2.classified).toBeGreaterThanOrEqual(1);

      const muscles2 = await prisma.exerciseMuscle.findMany({
        where: { exerciseId: globalSupino.id },
      });
      expect(muscles2.length).toBe(muscles1.length);
    });

    it("não altera exercício customizado do usuário durante a sincronização", async () => {
      const createExercise = new CreateExercise();
      const customEx = await createExercise.execute({
        userId: userA.id,
        name: "Agachamento Livre", // Mesmo nome do global mapeado, mas é customizado
        primaryMuscleGroups: [MuscleGroup.QUADRICEPS], // Sem GLUTES intencionalmente
      });

      await syncGlobalExerciseMuscles();

      const customMuscles = await prisma.exerciseMuscle.findMany({
        where: { exerciseId: customEx.id },
      });
      // Permanece intocado (apenas QUADRICEPS)
      expect(customMuscles).toHaveLength(1);
      expect(customMuscles[0].muscleGroup).toBe(MuscleGroup.QUADRICEPS);
    });
  });
});
