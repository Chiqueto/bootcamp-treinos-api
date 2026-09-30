import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  WorkoutSessionAlreadyCompletedError,
} from "../../src/errors/index.js";
import { prisma } from "../../src/lib/db.js";
import { AddExerciseToWorkoutSession } from "../../src/usecases/AddExerciseToWorkoutSession.js";
import { CompleteWorkoutSession } from "../../src/usecases/CompleteWorkoutSession.js";
import { CreateExercise } from "../../src/usecases/CreateExercise.js";
import { CreateWorkoutSet } from "../../src/usecases/CreateWorkoutSet.js";
import { GetWorkoutSession } from "../../src/usecases/GetWorkoutSession.js";
import { ListExercises } from "../../src/usecases/ListExercises.js";
import { RemoveExerciseFromWorkoutSession } from "../../src/usecases/RemoveExerciseFromWorkoutSession.js";
import { StartFreeWorkoutSession } from "../../src/usecases/StartFreeWorkoutSession.js";
import { StartWorkoutSession } from "../../src/usecases/StartWorkoutSession.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutExercise,
  createTestWorkoutPlan,
  createTestWorkoutSession,
  createTestWorkoutSet,
} from "../helpers/test-db.js";

describe("Task 1.8 — Treino Avulso & Catálogo de Exercícios", () => {
  const testUserIds: string[] = [];
  const startFreeWorkoutSession = new StartFreeWorkoutSession();
  const startWorkoutSession = new StartWorkoutSession();
  const listExercises = new ListExercises();
  const createExercise = new CreateExercise();
  const addExerciseToWorkoutSession = new AddExerciseToWorkoutSession();
  const removeExerciseFromWorkoutSession = new RemoveExerciseFromWorkoutSession();
  const getWorkoutSession = new GetWorkoutSession();
  const completeWorkoutSession = new CompleteWorkoutSession();
  const createWorkoutSet = new CreateWorkoutSet();

  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    testUserIds.push(userA.id, userB.id);
  });

  afterEach(async () => {
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
  });

  describe("1. StartFreeWorkoutSession", () => {
    it("cria WorkoutSession avulsa com workoutDayId = null e status ativo", async () => {
      const result = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      expect(result.userWorkoutSessionId).toBeDefined();
      expect(result.workoutSessionId).toBe(result.userWorkoutSessionId);
      expect(result.workoutDayId).toBeNull();
      expect(result.completedAt).toBeNull();

      const inDb = await prisma.workoutSession.findUnique({
        where: { id: result.userWorkoutSessionId },
      });
      expect(inDb).not.toBeNull();
      expect(inDb?.workoutDayId).toBeNull();
      expect(inDb?.athleteId).toBe(userA.id);
    });

    it("usuário não pode iniciar avulsa se já possui sessão ativa (lança ConflictError)", async () => {
      await startFreeWorkoutSession.execute({ userId: userA.id });

      await expect(
        startFreeWorkoutSession.execute({ userId: userA.id }),
      ).rejects.toThrow(ConflictError);
    });

    it("após finalizar sessão avulsa, pode iniciar outra normalmente", async () => {
      const session1 = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      await completeWorkoutSession.execute({
        userId: userA.id,
        sessionId: session1.userWorkoutSessionId,
      });

      const session2 = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      expect(session2.userWorkoutSessionId).not.toBe(session1.userWorkoutSessionId);
      expect(session2.workoutDayId).toBeNull();
    });

    it("sessão planejada continua funcionando normalmente", async () => {
      const plan = await createTestWorkoutPlan(userA.id);
      const day = await createTestWorkoutDay(plan.id);
      await createTestWorkoutExercise(day.id, { name: "Agachamento" });

      const result = await startWorkoutSession.execute({
        userId: userA.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      expect(result.userWorkoutSessionId).toBeDefined();
      expect(result.exercises.length).toBe(1);

      const inDb = await prisma.workoutSession.findUnique({
        where: { id: result.userWorkoutSessionId },
      });
      expect(inDb?.workoutDayId).toBe(day.id);
    });
  });

  describe("2. Catálogo de Exercícios (ListExercises & CreateExercise)", () => {
    it("listar retorna globais + exercícios próprios, e não lista personalizados de outros usuários", async () => {
      // Exercício global
      const globalEx = await createTestExercise({
        name: "Flexão de Braço",
        ownerUserId: null,
      });
      // Exercício próprio do usuário A
      const userAEx = await createTestExercise({
        name: "Remada Curvada User A",
        ownerUserId: userA.id,
      });
      // Exercício do usuário B
      await createTestExercise({
        name: "Desenvolvimento User B",
        ownerUserId: userB.id,
      });

      const listForA = await listExercises.execute({ userId: userA.id });
      const ids = listForA.map((e) => e.id);

      expect(ids).toContain(globalEx.id);
      expect(ids).toContain(userAEx.id);
      expect(listForA.some((e) => e.ownerUserId === userB.id)).toBe(false);
    });

    it("filtra exercícios por busca case-insensitive", async () => {
      await createTestExercise({ name: "Supino Reto Barra", ownerUserId: userA.id });
      await createTestExercise({ name: "SUPINO INCLINADO HALTER", ownerUserId: userA.id });
      await createTestExercise({ name: "Leg Press 45", ownerUserId: userA.id });

      const filtered = await listExercises.execute({
        userId: userA.id,
        query: "supino",
      });

      expect(filtered.length).toBeGreaterThanOrEqual(2);
      expect(filtered.every((e) => e.name.toLowerCase().includes("supino"))).toBe(true);
    });

    it("criar Exercise personalizado associa ownerUserId ao usuário", async () => {
      const created = await createExercise.execute({
        userId: userA.id,
        name: "Crossover Polia Alta",
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("Crossover Polia Alta");
      expect(created.ownerUserId).toBe(userA.id);

      const inDb = await prisma.exercise.findUnique({
        where: { id: created.id },
      });
      expect(inDb?.ownerUserId).toBe(userA.id);
    });

    it("impede duplicata case-insensitive e com espaços nas bordas para o mesmo usuário", async () => {
      await createExercise.execute({
        userId: userA.id,
        name: "Tríceps Corda",
      });

      // Tentativa 1: lowercase
      await expect(
        createExercise.execute({
          userId: userA.id,
          name: "tríceps corda",
        }),
      ).rejects.toThrow(ConflictError);

      // Tentativa 2: espaços nas bordas
      await expect(
        createExercise.execute({
          userId: userA.id,
          name: "   TRÍCEPS CORDA   ",
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("3. Adicionar Exercício à Sessão Avulsa", () => {
    it("adiciona Exercise global à sessão avulsa com campos snapshot corretos", async () => {
      const globalEx = await createTestExercise({
        name: "Barra Fixa",
        ownerUserId: null,
      });

      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      const added = await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: globalEx.id,
      });

      expect(added.id).toBeDefined();
      expect(added.exerciseNameSnapshot).toBe(globalEx.name);
      expect(added.order).toBe(1);
      expect(added.plannedSets).toBeNull();
      expect(added.plannedReps).toBeNull();
      expect(added.plannedRestTimeInSeconds).toBeNull();

      const inDb = await prisma.sessionExercise.findUnique({
        where: { id: added.id },
      });
      expect(inDb?.sourceWorkoutExerciseId).toBeNull();
      expect(inDb?.exerciseId).toBe(globalEx.id);
    });

    it("adiciona Exercise próprio do usuário à sessão avulsa", async () => {
      const customEx = await createExercise.execute({
        userId: userA.id,
        name: "Elevação Lateral Halter",
      });

      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      const added = await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: customEx.id,
      });

      expect(added.exerciseNameSnapshot).toBe("Elevação Lateral Halter");
    });

    it("impede adicionar Exercise de outro usuário (lança NotFoundError)", async () => {
      const otherUserEx = await createTestExercise({
        name: "Exclusivo User B",
        ownerUserId: userB.id,
      });

      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      await expect(
        addExerciseToWorkoutSession.execute({
          userId: userA.id,
          sessionId: session.userWorkoutSessionId,
          exerciseId: otherUserEx.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("mantém ordem incremental dos exercícios (order = 1, 2, 3...)", async () => {
      const ex1 = await createTestExercise({ name: "Ex 1", ownerUserId: null });
      const ex2 = await createTestExercise({ name: "Ex 2", ownerUserId: null });

      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      const add1 = await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: ex1.id,
      });
      const add2 = await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: ex2.id,
      });

      expect(add1.order).toBe(1);
      expect(add2.order).toBe(2);
    });

    it("não permite adicionar exercício a uma sessão planejada (lança ValidationError)", async () => {
      const plan = await createTestWorkoutPlan(userA.id);
      const day = await createTestWorkoutDay(plan.id);
      const plannedSession = await startWorkoutSession.execute({
        userId: userA.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      const ex = await createTestExercise({ name: "Ex Qualquer", ownerUserId: null });

      await expect(
        addExerciseToWorkoutSession.execute({
          userId: userA.id,
          sessionId: plannedSession.userWorkoutSessionId,
          exerciseId: ex.id,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("não permite adicionar exercício após conclusão da sessão", async () => {
      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });
      await completeWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
      });

      const ex = await createTestExercise({ name: "Ex Pos", ownerUserId: null });

      await expect(
        addExerciseToWorkoutSession.execute({
          userId: userA.id,
          sessionId: session.userWorkoutSessionId,
          exerciseId: ex.id,
        }),
      ).rejects.toThrow(WorkoutSessionAlreadyCompletedError);
    });
  });

  describe("4. Remover Exercício Avulso & Cascata", () => {
    it("remove SessionExercise de sessão avulsa e exclui suas séries via cascata", async () => {
      const ex = await createTestExercise({ name: "Rosca Direta", ownerUserId: null });
      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      const added = await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: ex.id,
      });

      // Cria série
      const set = await createWorkoutSet.execute({
        userId: userA.id,
        sessionExerciseId: added.id,
        type: "WORKING",
        weightInGrams: 20000,
        reps: 10,
      });

      // Remove exercício
      const res = await removeExerciseFromWorkoutSession.execute({
        userId: userA.id,
        sessionExerciseId: added.id,
      });

      expect(res.success).toBe(true);

      const inDbEx = await prisma.sessionExercise.findUnique({
        where: { id: added.id },
      });
      expect(inDbEx).toBeNull();

      const inDbSet = await prisma.workoutSet.findUnique({
        where: { id: set.id },
      });
      expect(inDbSet).toBeNull();
    });

    it("não permite remover exercício de sessão planejada (lança ValidationError)", async () => {
      const plan = await createTestWorkoutPlan(userA.id);
      const day = await createTestWorkoutDay(plan.id);
      await createTestWorkoutExercise(day.id, { name: "Agachamento Planejado" });

      const plannedSession = await startWorkoutSession.execute({
        userId: userA.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      const sessionExId = plannedSession.exercises[0].id;

      await expect(
        removeExerciseFromWorkoutSession.execute({
          userId: userA.id,
          sessionExerciseId: sessionExId,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("não permite remover exercício após conclusão da sessão avulsa", async () => {
      const ex = await createTestExercise({ name: "Elevação Frontal", ownerUserId: null });
      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });
      const added = await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: ex.id,
      });

      await completeWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
      });

      await expect(
        removeExerciseFromWorkoutSession.execute({
          userId: userA.id,
          sessionExerciseId: added.id,
        }),
      ).rejects.toThrow(WorkoutSessionAlreadyCompletedError);
    });
  });

  describe("5. Recuperação & Finalização da Sessão Avulsa", () => {
    it("GetWorkoutSession recupera sessão avulsa com workoutDayId = null e exercícios adicionados", async () => {
      const ex = await createTestExercise({ name: "Puxada Frontal", ownerUserId: null });
      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });
      await addExerciseToWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
        exerciseId: ex.id,
      });

      const retrieved = await getWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
      });

      expect(retrieved.id).toBe(session.userWorkoutSessionId);
      expect(retrieved.workoutDayId).toBeNull();
      expect(retrieved.sessionExercises.length).toBe(1);
      expect(retrieved.sessionExercises[0].exerciseNameSnapshot).toBe("Puxada Frontal");
    });

    it("CompleteWorkoutSession finaliza sessão avulsa normalmente (mesmo com zero séries)", async () => {
      const session = await startFreeWorkoutSession.execute({
        userId: userA.id,
      });

      const completed = await completeWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.userWorkoutSessionId,
      });

      expect(completed.id).toBe(session.userWorkoutSessionId);
      expect(completed.workoutDayId).toBeNull();
      expect(completed.completedAt).toBeDefined();

      const inDb = await prisma.workoutSession.findUnique({
        where: { id: session.userWorkoutSessionId },
      });
      expect(inDb?.completedAt).not.toBeNull();
    });
  });
});
