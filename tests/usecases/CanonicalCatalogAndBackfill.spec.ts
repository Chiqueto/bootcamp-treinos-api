import { afterAll, describe, expect, it } from "vitest";

import { CANONICAL_GLOBAL_CATALOG, getCanonicalGlobalByName } from "../../src/domain/canonical-catalog.js";
import {
  backfillSessionExercises,
  backfillWorkoutExercises,
  classifyUnclassifiedCustomExercises,
  runCanonicalCatalogBackfill,
  syncCanonicalGlobalCatalog,
} from "../../src/domain/catalog-backfill.js";
import { MuscleGroup, MuscleRole, WorkoutSessionOrigin } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import {
  cleanupTestUsers,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("Task 3.1D — Catálogo Canônico Global & Backfill de Legado", () => {
  const testUserIds: string[] = [];

  const createUser = async (emailPrefix: string) => {
    const user = await createTestUser({ email: `${emailPrefix}-${crypto.randomUUID()}@test.com` });
    testUserIds.push(user.id);
    return user;
  };

  afterAll(async () => {
    await cleanupTestUsers(testUserIds);
  });

  describe("1. Catálogo Canônico Global (Item 22)", () => {
    it("sync cria globals e associa os músculos corretamente", async () => {
      const syncResult = await syncCanonicalGlobalCatalog();
      expect(syncResult).toBeDefined();

      const globalsCount = await prisma.exercise.count({
        where: { ownerUserId: null },
      });
      expect(globalsCount).toBeGreaterThanOrEqual(33);

      // Verificar IDs determinísticos do catálogo oficial
      for (const def of CANONICAL_GLOBAL_CATALOG) {
        const found = await prisma.exercise.findUnique({
          where: { id: def.id },
          include: { muscles: true },
        });

        expect(found).not.toBeNull();
        expect(found?.ownerUserId).toBeNull();
        expect(found?.name).toBe(def.name);

        const primaryMuscles = found?.muscles
          .filter((m) => m.role === MuscleRole.PRIMARY)
          .map((m) => m.muscleGroup);
        const secondaryMuscles = found?.muscles
          .filter((m) => m.role === MuscleRole.SECONDARY)
          .map((m) => m.muscleGroup);

        expect(primaryMuscles).toEqual(expect.arrayContaining(def.primary));
        expect(secondaryMuscles).toEqual(expect.arrayContaining(def.secondary));
      }
    });

    it("segunda execução não duplica exercícios globais nem músculos (Idempotência)", async () => {
      const countBefore = await prisma.exercise.count({
        where: { ownerUserId: null },
      });
      const musclesBefore = await prisma.exerciseMuscle.count({
        where: { exercise: { ownerUserId: null } },
      });

      const secondRun = await syncCanonicalGlobalCatalog();
      expect(secondRun.created).toBe(0);

      const countAfter = await prisma.exercise.count({
        where: { ownerUserId: null },
      });
      const musclesAfter = await prisma.exerciseMuscle.count({
        where: { exercise: { ownerUserId: null } },
      });

      expect(countAfter).toBe(countBefore);
      expect(musclesAfter).toBe(musclesBefore);
    });

    it("possui IDs estáveis e determinísticos entre chamadas", () => {
      const supino = getCanonicalGlobalByName("Supino Reto com Barra");
      expect(supino?.id).toBe("00000000-0000-4000-8000-000000000101");

      const agachamento = getCanonicalGlobalByName("Agachamento Livre");
      expect(agachamento?.id).toBe("00000000-0000-4000-8000-000000000105");
    });
  });

  describe("2. Custom Legacy Exercises (Item 23)", () => {
    it("exact match sem muscles recebe classificação correta", async () => {
      const user = await createUser("custom-match");
      const custom = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          ownerUserId: user.id,
          name: "Supino Inclinado com Halteres",
        },
      });

      const classifyResult = await classifyUnclassifiedCustomExercises();
      expect(classifyResult.matchedCount).toBeGreaterThanOrEqual(1);

      const updated = await prisma.exercise.findUnique({
        where: { id: custom.id },
        include: { muscles: true },
      });

      expect(updated?.ownerUserId).toBe(user.id);
      expect(updated?.muscles.length).toBeGreaterThan(0);

      const primary = updated?.muscles.filter((m) => m.role === MuscleRole.PRIMARY).map((m) => m.muscleGroup);
      const secondary = updated?.muscles.filter((m) => m.role === MuscleRole.SECONDARY).map((m) => m.muscleGroup);

      expect(primary).toContain(MuscleGroup.CHEST);
      expect(secondary).toContain(MuscleGroup.TRICEPS);
      expect(secondary).toContain(MuscleGroup.SHOULDERS);
    });

    it("custom já classificado manualmente pelo usuário permanece intacto", async () => {
      const user = await createUser("custom-classified");
      const customClassified = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          ownerUserId: user.id,
          name: "Supino Reto",
          muscles: {
            create: [
              {
                muscleGroup: MuscleGroup.TRICEPS,
                role: MuscleRole.PRIMARY,
              },
            ],
          },
        },
        include: { muscles: true },
      });

      await classifyUnclassifiedCustomExercises();

      const checked = await prisma.exercise.findUnique({
        where: { id: customClassified.id },
        include: { muscles: true },
      });

      expect(checked?.muscles.length).toBe(1);
      expect(checked?.muscles[0].muscleGroup).toBe(MuscleGroup.TRICEPS);
      expect(checked?.muscles[0].role).toBe(MuscleRole.PRIMARY);
    });

    it("nome parecido ou desconhecido permanece unclassified (sem fuzzy)", async () => {
      const user = await createUser("custom-fuzzy");
      const customFuzzy = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          ownerUserId: user.id,
          name: "Supino Reto Muito Pesado Com Barra Olímpica",
        },
      });

      await classifyUnclassifiedCustomExercises();

      const checked = await prisma.exercise.findUnique({
        where: { id: customFuzzy.id },
        include: { muscles: true },
      });

      expect(checked?.muscles.length).toBe(0);
    });
  });

  describe("3. WorkoutExercise Backfill (Item 24)", () => {
    it("user exact match ganha prioridade sobre global de mesmo nome", async () => {
      const user = await createUser("we-priority");
      const customExtensora = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          ownerUserId: user.id,
          name: "Cadeira Extensora",
        },
      });

      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const day = await createTestWorkoutDay(plan.id);

      const we = await prisma.workoutExercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Cadeira Extensora",
          workoutDayId: day.id,
          order: 1,
          sets: 3,
          reps: 10,
          restTimeInSeconds: 60,
          exerciseId: null,
        },
      });

      await backfillWorkoutExercises();

      const updated = await prisma.workoutExercise.findUnique({
        where: { id: we.id },
      });

      expect(updated?.exerciseId).toBe(customExtensora.id);
    });

    it("global exact match é usado como fallback quando não há custom", async () => {
      const user = await createUser("we-fallback");
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const day = await createTestWorkoutDay(plan.id);

      const we = await prisma.workoutExercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Panturrilha em Pé",
          workoutDayId: day.id,
          order: 1,
          sets: 4,
          reps: 15,
          restTimeInSeconds: 45,
          exerciseId: null,
        },
      });

      await backfillWorkoutExercises();

      const globalPanturrilha = getCanonicalGlobalByName("Panturrilha em Pé");
      const updated = await prisma.workoutExercise.findUnique({
        where: { id: we.id },
      });

      expect(updated?.exerciseId).toBe(globalPanturrilha?.id);
    });

    it("exercício customizado de outro usuário NUNCA é associado", async () => {
      const userOwner = await createUser("we-owner");
      const userRequester = await createUser("we-requester");

      const userBExercise = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          ownerUserId: userOwner.id,
          name: "Exercicio Exclusivo do User Owner",
        },
      });

      const plan = await createTestWorkoutPlan(userRequester.id, { isActive: false });
      const day = await createTestWorkoutDay(plan.id);

      const we = await prisma.workoutExercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Exercicio Exclusivo do User Owner",
          workoutDayId: day.id,
          order: 1,
          sets: 3,
          reps: 10,
          restTimeInSeconds: 60,
          exerciseId: null,
        },
      });

      await backfillWorkoutExercises();

      const updated = await prisma.workoutExercise.findUnique({
        where: { id: we.id },
      });

      expect(updated?.exerciseId).toBeNull();
      expect(updated?.exerciseId).not.toBe(userBExercise.id);
    });

    it("fuzzy matching não associa e desconhecido permanece null", async () => {
      const user = await createUser("we-fuzzy");
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const day = await createTestWorkoutDay(plan.id);

      const weFuzzy = await prisma.workoutExercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Agachamento com Salto Explosivo 360",
          workoutDayId: day.id,
          order: 1,
          sets: 3,
          reps: 10,
          restTimeInSeconds: 60,
          exerciseId: null,
        },
      });

      await backfillWorkoutExercises();

      const updated = await prisma.workoutExercise.findUnique({
        where: { id: weFuzzy.id },
      });

      expect(updated?.exerciseId).toBeNull();
    });

    it("não altera dados de prescrição (name, sets, reps, warmupSets)", async () => {
      const user = await createUser("we-preserve");
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const day = await createTestWorkoutDay(plan.id);

      const we = await prisma.workoutExercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Mesa Flexora",
          workoutDayId: day.id,
          order: 3,
          sets: 4,
          warmupSets: 2,
          reps: 12,
          restTimeInSeconds: 90,
          exerciseId: null,
        },
      });

      await backfillWorkoutExercises();

      const updated = await prisma.workoutExercise.findUnique({
        where: { id: we.id },
      });

      expect(updated?.exerciseId).not.toBeNull();
      expect(updated?.name).toBe("Mesa Flexora");
      expect(updated?.order).toBe(3);
      expect(updated?.sets).toBe(4);
      expect(updated?.warmupSets).toBe(2);
      expect(updated?.reps).toBe(12);
      expect(updated?.restTimeInSeconds).toBe(90);
    });
  });

  describe("4. SessionExercise Backfill (Item 25)", () => {
    it("herda exerciseId do sourceWorkoutExercise quando resolvido (Estratégia 1)", async () => {
      const user = await createUser("se-source");
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const day = await createTestWorkoutDay(plan.id);

      const globalStiff = getCanonicalGlobalByName("Stiff");
      const we = await prisma.workoutExercise.create({
        data: {
          id: crypto.randomUUID(),
          name: "Stiff",
          workoutDayId: day.id,
          order: 1,
          sets: 3,
          reps: 10,
          restTimeInSeconds: 60,
          exerciseId: globalStiff?.id ?? null,
        },
      });

      const session = await prisma.workoutSession.create({
        data: {
          id: crypto.randomUUID(),
          origin: WorkoutSessionOrigin.PLANNED,
          athleteId: user.id,
          workoutPlanId: plan.id,
          workoutDayId: day.id,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });

      const se = await prisma.sessionExercise.create({
        data: {
          id: crypto.randomUUID(),
          workoutSessionId: session.id,
          sourceWorkoutExerciseId: we.id,
          exerciseId: null,
          exerciseNameSnapshot: "Stiff Tradicional com Halteres",
          order: 1,
        },
      });

      const backfillResult = await backfillSessionExercises();
      expect(backfillResult.resolvedViaSource).toBeGreaterThanOrEqual(1);

      const updated = await prisma.sessionExercise.findUnique({
        where: { id: se.id },
      });

      expect(updated?.exerciseId).toBe(globalStiff?.id);
    });

    it("sem sourceWorkoutExercise: fallback seguro exact-match contra custom do atleta ou global (Estratégia 2)", async () => {
      const user = await createUser("se-fallback");
      const session = await prisma.workoutSession.create({
        data: {
          id: crypto.randomUUID(),
          origin: WorkoutSessionOrigin.FREE,
          athleteId: user.id,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });

      const seGlobalFallback = await prisma.sessionExercise.create({
        data: {
          id: crypto.randomUUID(),
          workoutSessionId: session.id,
          sourceWorkoutExerciseId: null,
          exerciseId: null,
          exerciseNameSnapshot: "Elevação Lateral",
          order: 1,
        },
      });

      await backfillSessionExercises();

      const globalElevacao = getCanonicalGlobalByName("Elevação Lateral");
      const updated = await prisma.sessionExercise.findUnique({
        where: { id: seGlobalFallback.id },
      });

      expect(updated?.exerciseId).toBe(globalElevacao?.id);
    });

    it("exercício de sessão desconhecido permanece com exerciseId = null", async () => {
      const user = await createUser("se-unknown");
      const session = await prisma.workoutSession.create({
        data: {
          id: crypto.randomUUID(),
          origin: WorkoutSessionOrigin.FREE,
          athleteId: user.id,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });

      const seUnknown = await prisma.sessionExercise.create({
        data: {
          id: crypto.randomUUID(),
          workoutSessionId: session.id,
          sourceWorkoutExerciseId: null,
          exerciseId: null,
          exerciseNameSnapshot: "Exercício Raro Inventado 123",
          order: 1,
        },
      });

      await backfillSessionExercises();

      const updated = await prisma.sessionExercise.findUnique({
        where: { id: seUnknown.id },
      });

      expect(updated?.exerciseId).toBeNull();
    });

    it("preserva snapshots e históricos de SessionExercise inalterados", async () => {
      const user = await createUser("se-preserve");
      const session = await prisma.workoutSession.create({
        data: {
          id: crypto.randomUUID(),
          origin: WorkoutSessionOrigin.FREE,
          athleteId: user.id,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });

      const se = await prisma.sessionExercise.create({
        data: {
          id: crypto.randomUUID(),
          workoutSessionId: session.id,
          sourceWorkoutExerciseId: null,
          exerciseId: null,
          exerciseNameSnapshot: "Rosca Martelo",
          order: 2,
          plannedSets: 4,
          plannedWarmupSets: 1,
          plannedReps: 12,
          notes: "Aumentar peso na última série",
        },
      });

      await backfillSessionExercises();

      const updated = await prisma.sessionExercise.findUnique({
        where: { id: se.id },
      });

      expect(updated?.exerciseId).toBe(getCanonicalGlobalByName("Rosca Martelo")?.id);
      expect(updated?.exerciseNameSnapshot).toBe("Rosca Martelo");
      expect(updated?.order).toBe(2);
      expect(updated?.plannedSets).toBe(4);
      expect(updated?.plannedWarmupSets).toBe(1);
      expect(updated?.plannedReps).toBe(12);
      expect(updated?.notes).toBe("Aumentar peso na última série");
    });
  });

  describe("5. Idempotência Completa do Orquestrador (Item 26)", () => {
    it("executar o backfill duas vezes produz estado final idêntico", async () => {
      const report1 = await runCanonicalCatalogBackfill();
      const report2 = await runCanonicalCatalogBackfill();

      // Na segunda execução: 0 criados, 0 resolvidos a mais
      expect(report2.globals.created).toBe(0);
      expect(report2.globals.musclesCreated).toBe(0);
      expect(report2.customClassified.matchedCount).toBe(0);
      expect(report2.customClassified.musclesCreated).toBe(0);
      expect(report2.workoutExercises.resolved).toBe(0);
      expect(report2.sessionExercises.resolvedViaSource).toBe(0);
      expect(report2.sessionExercises.resolvedViaFallback).toBe(0);

      // Totais e linked permanecem idênticos
      expect(report2.workoutExercises.totalAfter).toBe(report1.workoutExercises.totalAfter);
      expect(report2.workoutExercises.linkedAfter).toBe(report1.workoutExercises.linkedAfter);
      expect(report2.sessionExercises.totalAfter).toBe(report1.sessionExercises.totalAfter);
      expect(report2.sessionExercises.linkedAfter).toBe(report1.sessionExercises.linkedAfter);
    });
  });
});
