import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MuscleGroup, MuscleRole, SetType, WorkoutSessionOrigin } from "../../src/generated/prisma/enums.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { historyRoutes } from "../../src/routes/history.js";
import {
  cleanupTestExercises,
  cleanupTestUsers,
  createdTestExerciseIds,
  createTestExercise,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
  createTestWorkoutSession,
  createTestWorkoutSet,
} from "../helpers/test-db.js";

describe("Exercise Evolution & Load PR API — GET /history/exercises/:exerciseId (Task 3.3)", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  let userA: { id: string; email: string; name: string };
  let userB: { id: string; email: string; name: string };

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(historyRoutes, { prefix: "/history" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    testUserIds.push(userA.id, userB.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
    if (createdTestExerciseIds.length > 0) {
      await cleanupTestExercises([...createdTestExerciseIds]);
      createdTestExerciseIds.length = 0;
    }
  });

  function mockAuthUser(user: { id: string; email: string; name: string }) {
    vi.spyOn(auth.api, "getSession").mockResolvedValue({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "sess-test",
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
        token: "tok-test",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as any);
  }

  // -------------------------------------------------------------
  // 36. TESTES — OWNERSHIP
  // -------------------------------------------------------------
  describe("36. Ownership & Access Control", () => {
    it("permite acesso a exercício global e próprio custom; retorna 404 para custom de outro usuário ou inexistente", async () => {
      mockAuthUser(userA);

      // 1. Global Exercise
      const globalEx = await createTestExercise({
        ownerUserId: null,
        name: `Global Supino ${crypto.randomUUID().slice(0, 6)}`,
      });

      // 2. Custom de UserA
      const customExA = await createTestExercise({
        ownerUserId: userA.id,
        name: `Custom Ex User A ${crypto.randomUUID().slice(0, 6)}`,
      });

      // 3. Custom de UserB
      const customExB = await createTestExercise({
        ownerUserId: userB.id,
        name: `Custom Ex User B ${crypto.randomUUID().slice(0, 6)}`,
      });

      // Global -> 200
      const resGlobal = await app.inject({
        method: "GET",
        url: `/history/exercises/${globalEx.id}`,
      });
      expect(resGlobal.statusCode).toBe(200);
      expect(resGlobal.json().exercise.id).toBe(globalEx.id);

      // Custom próprio -> 200
      const resCustomA = await app.inject({
        method: "GET",
        url: `/history/exercises/${customExA.id}`,
      });
      expect(resCustomA.statusCode).toBe(200);
      expect(resCustomA.json().exercise.id).toBe(customExA.id);

      // Custom de User B -> 404 EXERCISE_NOT_FOUND
      const resCustomB = await app.inject({
        method: "GET",
        url: `/history/exercises/${customExB.id}`,
      });
      expect(resCustomB.statusCode).toBe(404);
      expect(resCustomB.json().code).toBe("EXERCISE_NOT_FOUND");

      // Inexistente -> 404 EXERCISE_NOT_FOUND
      const resNonExistent = await app.inject({
        method: "GET",
        url: `/history/exercises/${crypto.randomUUID()}`,
      });
      expect(resNonExistent.statusCode).toBe(404);
      expect(resNonExistent.json().code).toBe("EXERCISE_NOT_FOUND");
    });
  });

  // -------------------------------------------------------------
  // 37. TESTES — SESSÕES
  // -------------------------------------------------------------
  describe("37. Session Status & Athlete Isolation", () => {
    it("participam apenas sessões concluídas do próprio atleta (PLANNED e FREE); ativas e de terceiros não participam", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Supino Reto ${crypto.randomUUID().slice(0, 6)}`,
      });

      const planA = await createTestWorkoutPlan(userA.id, { name: "Plano A" });
      const dayA = await createTestWorkoutDay(planA.id, { name: "Dia A" });

      // 1. Própria Concluída PLANNED -> participa
      const sPlanned = await createTestWorkoutSession(dayA.id, {
        athleteId: userA.id,
        origin: WorkoutSessionOrigin.PLANNED,
        workoutPlanNameSnapshot: "Plano A",
        workoutDayNameSnapshot: "Dia A",
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const sePlanned = await createTestSessionExercise(sPlanned.id, {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      });
      await createTestWorkoutSet(sePlanned.id, {
        type: SetType.WORKING,
        weightInGrams: 80000,
        reps: 10,
        completedAt: new Date("2026-10-01T10:05:00.000Z"),
      });

      // 2. Própria Concluída FREE -> participa
      const sFree = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        origin: WorkoutSessionOrigin.FREE,
        completedAt: new Date("2026-10-01T11:00:00.000Z"),
      });
      const seFree = await createTestSessionExercise(sFree.id, {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      });
      await createTestWorkoutSet(seFree.id, {
        type: SetType.WORKING,
        weightInGrams: 85000,
        reps: 8,
        completedAt: new Date("2026-10-01T11:05:00.000Z"),
      });

      // 3. Própria Ativa -> NÃO participa
      const sActive = await createTestWorkoutSession(dayA.id, {
        athleteId: userA.id,
        completedAt: null,
      });
      const seActive = await createTestSessionExercise(sActive.id, {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      });
      await createTestWorkoutSet(seActive.id, {
        type: SetType.WORKING,
        weightInGrams: 90000,
        reps: 8,
        completedAt: new Date(),
      });

      // 4. Concluída de User B -> NÃO participa
      const sOther = await createTestWorkoutSession(null, {
        athleteId: userB.id,
        completedAt: new Date("2026-10-01T09:00:00.000Z"),
      });
      const seOther = await createTestSessionExercise(sOther.id, {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      });
      await createTestWorkoutSet(seOther.id, {
        type: SetType.WORKING,
        weightInGrams: 120000,
        reps: 5,
        completedAt: new Date("2026-10-01T09:05:00.000Z"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.items).toHaveLength(2);
      const sessionIds = data.items.map((i: any) => i.workoutSessionId);
      expect(sessionIds).toContain(sPlanned.id);
      expect(sessionIds).toContain(sFree.id);
      expect(sessionIds).not.toContain(sActive.id);
      expect(sessionIds).not.toContain(sOther.id);
    });
  });

  // -------------------------------------------------------------
  // 38. TESTES — WORKING VS WARMUP
  // -------------------------------------------------------------
  describe("38. WORKING vs WARMUP & Incomplete Sets", () => {
    it("inclui apenas WORKING concluídas; ignora WARMUP e incompletas", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Leg Press ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      const se = await createTestSessionExercise(session.id, {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      });

      const now = new Date();

      // 2 WARMUP
      await createTestWorkoutSet(se.id, {
        order: 1,
        type: SetType.WARMUP,
        weightInGrams: 50000,
        reps: 12,
        completedAt: now,
      });
      await createTestWorkoutSet(se.id, {
        order: 2,
        type: SetType.WARMUP,
        weightInGrams: 100000,
        reps: 10,
        completedAt: now,
      });

      // 3 WORKING concluídas
      await createTestWorkoutSet(se.id, {
        order: 3,
        type: SetType.WORKING,
        weightInGrams: 150000,
        reps: 10,
        completedAt: now,
      });
      await createTestWorkoutSet(se.id, {
        order: 4,
        type: SetType.WORKING,
        weightInGrams: 170000,
        reps: 8,
        completedAt: now,
      });
      await createTestWorkoutSet(se.id, {
        order: 5,
        type: SetType.WORKING,
        weightInGrams: 180000,
        reps: 6,
        completedAt: now,
      });

      // 1 WORKING incompleta
      await createTestWorkoutSet(se.id, {
        order: 6,
        type: SetType.WORKING,
        weightInGrams: 200000,
        reps: 5,
        completedAt: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.workingSetsCount).toBe(3);
      expect(item.sets).toHaveLength(3);
      expect(item.sets.map((s: any) => s.weightInGrams)).toEqual([150000, 170000, 180000]);
    });
  });

  // -------------------------------------------------------------
  // 39, 40, 41, 42. TESTES — LOAD PR & DESEMPATES
  // -------------------------------------------------------------
  describe("39-42. Load PR Calculation & Tie-breakers", () => {
    it("39. Seleciona a maior carga WORKING ignorando warmup mais pesado", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Agachamento ${crypto.randomUUID().slice(0, 6)}`,
      });

      // Sessão A: 80kg x 10
      const sA = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T08:00:00.000Z"),
      });
      const seA = await createTestSessionExercise(sA.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seA.id, {
        type: SetType.WORKING,
        weightInGrams: 80000,
        reps: 10,
        completedAt: new Date("2026-10-01T08:05:00.000Z"),
      });

      // Sessão B: 85kg x 5
      const sB = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T09:00:00.000Z"),
      });
      const seB = await createTestSessionExercise(sB.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seB.id, {
        type: SetType.WORKING,
        weightInGrams: 85000,
        reps: 5,
        completedAt: new Date("2026-10-01T09:05:00.000Z"),
      });

      // Sessão C: 85kg x 7
      const sC = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const seC = await createTestSessionExercise(sC.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seC.id, {
        type: SetType.WORKING,
        weightInGrams: 85000,
        reps: 7,
        completedAt: new Date("2026-10-01T10:05:00.000Z"),
      });

      // Sessão D: WARMUP 100kg x 1 (deve ser ignorado)
      const sD = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T11:00:00.000Z"),
      });
      const seD = await createTestSessionExercise(sD.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seD.id, {
        type: SetType.WARMUP,
        weightInGrams: 100000,
        reps: 1,
        completedAt: new Date("2026-10-01T11:05:00.000Z"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const pr = res.json().loadPR;
      expect(pr).not.toBeNull();
      expect(pr.weightInGrams).toBe(85000);
      expect(pr.weightKg).toBe(85);
      expect(pr.reps).toBe(7);
      expect(pr.workoutSessionId).toBe(sC.id);
    });

    it("40. Desempata por data da série (completedAt DESC) quando carga e reps são idênticos", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Desenvolvimento ${crypto.randomUUID().slice(0, 6)}`,
      });

      // Sessão Antiga: 85kg x 7 às 09:00
      const sOld = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T09:00:00.000Z"),
      });
      const seOld = await createTestSessionExercise(sOld.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seOld.id, {
        type: SetType.WORKING,
        weightInGrams: 85000,
        reps: 7,
        completedAt: new Date("2026-10-01T09:05:00.000Z"),
      });

      // Sessão Nova: 85kg x 7 às 11:00
      const sNew = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T11:00:00.000Z"),
      });
      const seNew = await createTestSessionExercise(sNew.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seNew.id, {
        type: SetType.WORKING,
        weightInGrams: 85000,
        reps: 7,
        completedAt: new Date("2026-10-01T11:05:00.000Z"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const pr = res.json().loadPR;
      expect(pr.weightInGrams).toBe(85000);
      expect(pr.reps).toBe(7);
      expect(pr.workoutSessionId).toBe(sNew.id);
    });

    it("41. RIR não interfere no desempate de PR", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Remada Curvada ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se = await createTestSessionExercise(session.id, { exerciseId: exercise.id });

      // Série 1 às 10:05: 100kg x 5 @ RIR 3
      await createTestWorkoutSet(se.id, {
        order: 1,
        type: SetType.WORKING,
        weightInGrams: 100000,
        reps: 5,
        rir: 3,
        completedAt: new Date("2026-10-01T10:05:00.000Z"),
      });

      // Série 2 às 10:10: 100kg x 5 @ RIR 0 (mais recente)
      const set2 = await createTestWorkoutSet(se.id, {
        order: 2,
        type: SetType.WORKING,
        weightInGrams: 100000,
        reps: 5,
        rir: 0,
        completedAt: new Date("2026-10-01T10:10:00.000Z"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const pr = res.json().loadPR;
      // Ganha pela data mais recente (10:10), e não pelo RIR
      expect(pr.workoutSetId).toBe(set2.id);
      expect(pr.rir).toBe(0);
    });

    it("42. Retorna loadPR = null quando todas as séries possuem weightInGrams = null", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Barra Fixa Bodyweight ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se = await createTestSessionExercise(session.id, { exerciseId: exercise.id });

      await createTestWorkoutSet(se.id, {
        type: SetType.WORKING,
        weightInGrams: null,
        reps: 12,
        completedAt: new Date("2026-10-01T10:05:00.000Z"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.loadPR).toBeNull();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].workingSetsCount).toBe(1);
      expect(data.items[0].topSet).not.toBeNull();
      expect(data.items[0].topSet.weightInGrams).toBeNull();
      expect(data.items[0].topSet.reps).toBe(12);
    });
  });

  // -------------------------------------------------------------
  // 43 & 44. TESTES — EVOLUÇÃO POR SESSÃO E CONSOLIDAÇÃO
  // -------------------------------------------------------------
  describe("43-44. Evolution Grouping & Duplicate Exercise Consolidation", () => {
    it("43. Agrupa múltiplas séries da mesma sessão em 1 único evolution item", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Rosca Direta ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se = await createTestSessionExercise(session.id, { exerciseId: exercise.id });

      for (let i = 1; i <= 3; i++) {
        await createTestWorkoutSet(se.id, {
          order: i,
          type: SetType.WORKING,
          weightInGrams: 30000,
          reps: 10,
          completedAt: new Date(),
        });
      }

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items).toHaveLength(1);
      expect(items[0].workingSetsCount).toBe(3);
    });

    it("44. Consolida dois SessionExercise do mesmo exercício na mesma sessão em 1 único item", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Tríceps Corda ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });

      // Ocorrência 1: order 1, snapshot "Tríceps Corda A"
      const se1 = await createTestSessionExercise(session.id, {
        order: 1,
        exerciseId: exercise.id,
        exerciseNameSnapshot: "Tríceps Corda A",
      });
      const set1 = await createTestWorkoutSet(se1.id, {
        order: 1,
        type: SetType.WORKING,
        weightInGrams: 25000,
        reps: 12,
        completedAt: new Date("2026-10-01T10:05:00.000Z"),
      });

      // Ocorrência 2: order 2, snapshot "Tríceps Corda B"
      const se2 = await createTestSessionExercise(session.id, {
        order: 2,
        exerciseId: exercise.id,
        exerciseNameSnapshot: "Tríceps Corda B",
      });
      const set2 = await createTestWorkoutSet(se2.id, {
        order: 1,
        type: SetType.WORKING,
        weightInGrams: 30000,
        reps: 10,
        completedAt: new Date("2026-10-01T10:15:00.000Z"),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items).toHaveLength(1);
      expect(items[0].exerciseNameSnapshot).toBe("Tríceps Corda A"); // menor order
      expect(items[0].workingSetsCount).toBe(2);
      expect(items[0].sets.map((s: any) => s.id)).toEqual([set1.id, set2.id]);
    });
  });

  // -------------------------------------------------------------
  // 45 & 46. TESTES — LOAD VOLUME & TOTAL REPS
  // -------------------------------------------------------------
  describe("45-46. Load Volume & Total Reps Calculation", () => {
    it("45. Calcula load volume corretamente: 100kg*5 + 100kg*5 + 110kg*3 = 1.330.000g (1330kg)", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Supino Inclinado ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se = await createTestSessionExercise(session.id, { exerciseId: exercise.id });

      const now = new Date();
      await createTestWorkoutSet(se.id, { order: 1, type: SetType.WORKING, weightInGrams: 100000, reps: 5, completedAt: now });
      await createTestWorkoutSet(se.id, { order: 2, type: SetType.WORKING, weightInGrams: 100000, reps: 5, completedAt: now });
      await createTestWorkoutSet(se.id, { order: 3, type: SetType.WORKING, weightInGrams: 110000, reps: 3, completedAt: now });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.loadVolumeGrams).toBe(1330000);
      expect(item.loadVolumeKg).toBe(1330);
    });

    it("46. Calcula total reps tratando reps = null como 0: 8 + 8 + null + 6 = 22", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Prancha e Isometria ${crypto.randomUUID().slice(0, 6)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se = await createTestSessionExercise(session.id, { exerciseId: exercise.id });

      const now = new Date();
      await createTestWorkoutSet(se.id, { order: 1, type: SetType.WORKING, reps: 8, completedAt: now });
      await createTestWorkoutSet(se.id, { order: 2, type: SetType.WORKING, reps: 8, completedAt: now });
      await createTestWorkoutSet(se.id, { order: 3, type: SetType.WORKING, reps: null, durationInSeconds: 45, completedAt: now });
      await createTestWorkoutSet(se.id, { order: 4, type: SetType.WORKING, reps: 6, completedAt: now });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const item = res.json().items[0];
      expect(item.totalReps).toBe(22);
      expect(item.workingSetsCount).toBe(4);
    });
  });

  // -------------------------------------------------------------
  // 47. TESTES — SNAPSHOT DE NOME
  // -------------------------------------------------------------
  describe("47. Exercise Name Renaming vs Snapshot", () => {
    it("retorna o nome atual no root e preserva exerciseNameSnapshot histórico do item", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: userA.id,
        name: `Supino Reto Original ${crypto.randomUUID().slice(0, 4)}`,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se = await createTestSessionExercise(session.id, {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      });
      await createTestWorkoutSet(se.id, {
        type: SetType.WORKING,
        weightInGrams: 80000,
        reps: 8,
        completedAt: new Date(),
      });

      // Renomear o exercício no catálogo
      const newName = `Supino Reto Barra Atualizado ${crypto.randomUUID().slice(0, 4)}`;
      await prisma.exercise.update({
        where: { id: exercise.id },
        data: { name: newName },
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}`,
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.exercise.name).toBe(newName);
      expect(data.items[0].exerciseNameSnapshot).toBe(exercise.name);
    });
  });

  // -------------------------------------------------------------
  // 48, 49, 50. TESTES — LEGACY FALLBACK & PREVENÇÃO DE COLISÃO
  // -------------------------------------------------------------
  describe("48-50. Legacy Fallback (exerciseId = null), Collision Prevention & No Fuzzy", () => {
    it("48. Inclui SessionExercise com exerciseId = null quando o snapshot coincide exatamente com o target", async () => {
      mockAuthUser(userA);

      const uniqueName = `Puxador Costas ${crypto.randomUUID().slice(0, 6)}`;
      const target = await createTestExercise({
        ownerUserId: null,
        name: uniqueName,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });

      // Registro legado: exerciseId = null, snapshot idêntico
      const seLegacy = await createTestSessionExercise(session.id, {
        exerciseId: null,
        exerciseNameSnapshot: uniqueName,
      });
      await createTestWorkoutSet(seLegacy.id, {
        type: SetType.WORKING,
        weightInGrams: 60000,
        reps: 10,
        completedAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${target.id}`,
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].sets[0].weightInGrams).toBe(60000);
    });

    it("49. Em colisão Global vs Custom com mesmo nome, o fallback legado pertence estritamente ao Custom", async () => {
      mockAuthUser(userA);

      const collisionName = `Supino Halteres Teste ${crypto.randomUUID().slice(0, 6)}`;

      // 1. Global
      const globalEx = await createTestExercise({
        ownerUserId: null,
        name: collisionName,
      });

      // 2. Custom do usuário com o mesmo nome
      const customEx = await createTestExercise({
        ownerUserId: userA.id,
        name: collisionName,
      });

      // 3. Sessão com SessionExercise legado (exerciseId = null)
      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const seLegacy = await createTestSessionExercise(session.id, {
        exerciseId: null,
        exerciseNameSnapshot: collisionName,
      });
      await createTestWorkoutSet(seLegacy.id, {
        type: SetType.WORKING,
        weightInGrams: 70000,
        reps: 8,
        completedAt: new Date(),
      });

      // GET customEx -> deve incluir a série legada (custom tem precedência)
      const resCustom = await app.inject({
        method: "GET",
        url: `/history/exercises/${customEx.id}`,
      });
      expect(resCustom.statusCode).toBe(200);
      expect(resCustom.json().items).toHaveLength(1);

      // GET globalEx -> NÃO deve incluir a série legada (evita dupla contagem!)
      const resGlobal = await app.inject({
        method: "GET",
        url: `/history/exercises/${globalEx.id}`,
      });
      expect(resGlobal.statusCode).toBe(200);
      expect(resGlobal.json().items).toHaveLength(0);
    });

    it("50. NUNCA associa com fuzzy matching (ex: Supino Reto com Halteres não entra em Supino Reto)", async () => {
      mockAuthUser(userA);

      const baseName = `Supino Reto Exato ${crypto.randomUUID().slice(0, 6)}`;
      const target = await createTestExercise({
        ownerUserId: null,
        name: baseName,
      });

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });

      // Legado com nome fuzzy / parcial
      const seFuzzy = await createTestSessionExercise(session.id, {
        exerciseId: null,
        exerciseNameSnapshot: `${baseName} com Halteres`,
      });
      await createTestWorkoutSet(seFuzzy.id, {
        type: SetType.WORKING,
        weightInGrams: 80000,
        reps: 8,
        completedAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/exercises/${target.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------
  // 51 & 52. TESTES — CURSOR PAGINATION & TIMELINE MUTÁVEL
  // -------------------------------------------------------------
  describe("51-52. Cursor Pagination & Mutable Timeline Protection", () => {
    it("51. Pagina sessões do exercício com cursor determinístico sem faltas ou duplicatas", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Elevacao Lateral ${crypto.randomUUID().slice(0, 6)}`,
      });

      const sessions = [];
      for (let i = 0; i < 5; i++) {
        const s = await createTestWorkoutSession(null, {
          athleteId: userA.id,
          completedAt: new Date(Date.UTC(2026, 9, 1, 8, i * 15)),
        });
        const se = await createTestSessionExercise(s.id, { exerciseId: exercise.id });
        await createTestWorkoutSet(se.id, {
          type: SetType.WORKING,
          weightInGrams: 12000,
          reps: 12,
          completedAt: new Date(),
        });
        sessions.push(s);
      }

      const expectedIdsDesc = sessions.map((s) => s.id).reverse();

      // Página 1 (limit 2)
      const res1 = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=2`,
      });
      expect(res1.statusCode).toBe(200);
      const p1 = res1.json();
      expect(p1.items).toHaveLength(2);
      expect(p1.items.map((i: any) => i.workoutSessionId)).toEqual([expectedIdsDesc[0], expectedIdsDesc[1]]);
      expect(p1.hasMore).toBe(true);
      expect(p1.nextCursor).not.toBeNull();

      // Página 2 (limit 2)
      const res2 = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=2&cursor=${p1.nextCursor}`,
      });
      expect(res2.statusCode).toBe(200);
      const p2 = res2.json();
      expect(p2.items).toHaveLength(2);
      expect(p2.items.map((i: any) => i.workoutSessionId)).toEqual([expectedIdsDesc[2], expectedIdsDesc[3]]);
      expect(p2.hasMore).toBe(true);

      // Página 3 (limit 2, última)
      const res3 = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=2&cursor=${p2.nextCursor}`,
      });
      expect(res3.statusCode).toBe(200);
      const p3 = res3.json();
      expect(p3.items).toHaveLength(1);
      expect(p3.items.map((i: any) => i.workoutSessionId)).toEqual([expectedIdsDesc[4]]);
      expect(p3.hasMore).toBe(false);
      expect(p3.nextCursor).toBeNull();
    });

    it("52. Nova sessão concluída após a página 1 não desloca nem duplica registros na página 2", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Crucifixo ${crypto.randomUUID().slice(0, 6)}`,
      });

      // 4 sessões antigas (10h, 11h, 12h, 13h)
      const s1 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const se1 = await createTestSessionExercise(s1.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(se1.id, { type: SetType.WORKING, reps: 10, completedAt: new Date() });

      const s2 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T11:00:00.000Z"),
      });
      const se2 = await createTestSessionExercise(s2.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(se2.id, { type: SetType.WORKING, reps: 10, completedAt: new Date() });

      const s3 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });
      const se3 = await createTestSessionExercise(s3.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(se3.id, { type: SetType.WORKING, reps: 10, completedAt: new Date() });

      const s4 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T13:00:00.000Z"),
      });
      const se4 = await createTestSessionExercise(s4.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(se4.id, { type: SetType.WORKING, reps: 10, completedAt: new Date() });

      // Página 1 (limit 2): retorna s4 (13h) e s3 (12h)
      const res1 = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=2`,
      });
      const p1 = res1.json();
      expect(p1.items.map((i: any) => i.workoutSessionId)).toEqual([s4.id, s3.id]);
      const cursorAfterP1 = p1.nextCursor;

      // Conclui uma NOVA sessão mais recente às 14h
      const sNew = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T14:00:00.000Z"),
      });
      const seNew = await createTestSessionExercise(sNew.id, { exerciseId: exercise.id });
      await createTestWorkoutSet(seNew.id, { type: SetType.WORKING, reps: 10, completedAt: new Date() });

      // Página 2 com cursor antigo: deve trazer estritamente s2 (11h) e s1 (10h)
      const res2 = await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=2&cursor=${cursorAfterP1}`,
      });
      const p2 = res2.json();
      expect(p2.items.map((i: any) => i.workoutSessionId)).toEqual([s2.id, s1.id]);
    });
  });

  // -------------------------------------------------------------
  // 53. TESTES — PERFORMANCE ANTI-N+1
  // -------------------------------------------------------------
  describe("53. Anti-N+1 Strategy Verification", () => {
    it("mantém quantidade constante de queries de banco independentemente do número de sessões da página", async () => {
      mockAuthUser(userA);

      const exercise = await createTestExercise({
        ownerUserId: null,
        name: `Remada Baixa ${crypto.randomUUID().slice(0, 6)}`,
      });

      // Criar 10 sessões
      for (let i = 0; i < 10; i++) {
        const s = await createTestWorkoutSession(null, {
          athleteId: userA.id,
          completedAt: new Date(Date.UTC(2026, 9, 1, 8, i * 5)),
        });
        const se = await createTestSessionExercise(s.id, { exerciseId: exercise.id });
        await createTestWorkoutSet(se.id, {
          type: SetType.WORKING,
          weightInGrams: 50000,
          reps: 10,
          completedAt: new Date(),
        });
      }

      const queryRawSpy = vi.spyOn(prisma, "$queryRaw");
      const findManySpy = vi.spyOn(prisma.sessionExercise, "findMany");

      // Requisição com limit 2
      await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=2`,
      });

      const queryRawCountP2 = queryRawSpy.mock.calls.length;
      const findManyCountP2 = findManySpy.mock.calls.length;

      queryRawSpy.mockClear();
      findManySpy.mockClear();

      // Requisição com limit 8
      await app.inject({
        method: "GET",
        url: `/history/exercises/${exercise.id}?limit=8`,
      });

      const queryRawCountP8 = queryRawSpy.mock.calls.length;
      const findManyCountP8 = findManySpy.mock.calls.length;

      // $queryRaw: 2 queries (1 loadPR + 1 page sessions)
      // findMany: 1 query para carregar sessionExercises e sets da página
      expect(queryRawCountP2).toBe(2);
      expect(findManyCountP2).toBe(1);

      expect(queryRawCountP8).toBe(2);
      expect(findManyCountP8).toBe(1);
    });
  });
});
