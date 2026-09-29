import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NotFoundError,
  ValidationError,
  WorkoutSessionAlreadyCompletedError,
} from "../../src/errors/index.js";
import { prisma } from "../../src/lib/db.js";
import { CreateWorkoutSet } from "../../src/usecases/CreateWorkoutSet.js";
import { DeleteWorkoutSet } from "../../src/usecases/DeleteWorkoutSet.js";
import { GetActiveWorkoutSession } from "../../src/usecases/GetActiveWorkoutSession.js";
import { GetWorkoutSession } from "../../src/usecases/GetWorkoutSession.js";
import { UpdateWorkoutSet } from "../../src/usecases/UpdateWorkoutSet.js";
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

describe("WorkoutSet Tracker (Fase 1 — Task 1.4)", () => {
  const testUserIds: string[] = [];
  let userA: { id: string };
  let userB: { id: string };
  let workoutPlanA: { id: string };
  let workoutDayA: { id: string };
  let sessionA: { id: string };
  let sessionExerciseA1: { id: string };
  let sessionExerciseA2: { id: string };

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    testUserIds.push(userA.id, userB.id);

    workoutPlanA = await createTestWorkoutPlan(userA.id);
    workoutDayA = await createTestWorkoutDay(workoutPlanA.id);

    sessionA = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });

    sessionExerciseA1 = await createTestSessionExercise(sessionA.id, {
      exerciseNameSnapshot: "Supino Reto",
      order: 1,
    });

    sessionExerciseA2 = await createTestSessionExercise(sessionA.id, {
      exerciseNameSnapshot: "Barra Fixa",
      order: 2,
    });
  });

  afterEach(async () => {
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
  });

  it("Cenário 1 — Create básico: cria série com 30000g, 8 reps, rir 2, WORKING e valida persistência", async () => {
    const useCase = new CreateWorkoutSet();

    const result = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      weightInGrams: 30000,
      reps: 8,
      rir: 2,
      notes: "Boa execução",
    });

    expect(result.id).toBeDefined();
    expect(result.order).toBe(1);
    expect(result.type).toBe("WORKING");
    expect(result.weightInGrams).toBe(30000);
    expect(result.reps).toBe(8);
    expect(result.rir).toBe(2);
    expect(result.durationInSeconds).toBeNull();
    expect(result.notes).toBe("Boa execução");
    expect(result.completedAt).toBeNull();

    // Validação direta no banco
    const dbSet = await prisma.workoutSet.findUnique({
      where: { id: result.id },
    });
    expect(dbSet).not.toBeNull();
    expect(dbSet?.weightInGrams).toBe(30000);
    expect(dbSet?.reps).toBe(8);
    expect(dbSet?.rir).toBe(2);
    expect(dbSet?.order).toBe(1);
  });

  it("Cenário 2 — Sem peso: registra barra fixa com reps 10 e weight null", async () => {
    const useCase = new CreateWorkoutSet();

    const result = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA2.id,
      type: "WORKING",
      weightInGrams: null,
      reps: 10,
    });

    expect(result.weightInGrams).toBeNull();
    expect(result.reps).toBe(10);
    expect(result.type).toBe("WORKING");

    const dbSet = await prisma.workoutSet.findUnique({
      where: { id: result.id },
    });
    expect(dbSet?.weightInGrams).toBeNull();
    expect(dbSet?.reps).toBe(10);
  });

  it("Cenário 3 — Isometria: registra prancha/isometria com duration 45s e reps null", async () => {
    const useCase = new CreateWorkoutSet();

    const result = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      durationInSeconds: 45,
      reps: null,
    });

    expect(result.durationInSeconds).toBe(45);
    expect(result.reps).toBeNull();

    const dbSet = await prisma.workoutSet.findUnique({
      where: { id: result.id },
    });
    expect(dbSet?.durationInSeconds).toBe(45);
    expect(dbSet?.reps).toBeNull();
  });

  it("Cenário 4 — Warmup: cria série do tipo WARMUP", async () => {
    const useCase = new CreateWorkoutSet();

    const result = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WARMUP",
      weightInGrams: 10000,
      reps: 15,
    });

    expect(result.type).toBe("WARMUP");
    expect(result.order).toBe(1);

    const dbSet = await prisma.workoutSet.findUnique({
      where: { id: result.id },
    });
    expect(dbSet?.type).toBe("WARMUP");
  });

  it("Cenário 5 — Ordenação: criar três séries e garantir order crescente sequencial no mesmo SessionExercise", async () => {
    const useCase = new CreateWorkoutSet();

    const set1 = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WARMUP",
      reps: 12,
    });

    const set2 = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      reps: 8,
    });

    const set3 = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      reps: 6,
    });

    expect(set1.order).toBe(1);
    expect(set2.order).toBe(2);
    expect(set3.order).toBe(3);
  });

  it("Cenário 6 — Exercícios independentes: série do exercício B não deve herdar order do exercício A", async () => {
    const useCase = new CreateWorkoutSet();

    await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      reps: 10,
    });
    await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      reps: 8,
    });

    // Exercício A2 começa a partir do order 1
    const setB1 = await useCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA2.id,
      type: "WORKING",
      reps: 5,
    });

    expect(setB1.order).toBe(1);
  });

  it("Cenário 7 — Update: alterar carga, reps e RIR da série", async () => {
    const createUseCase = new CreateWorkoutSet();
    const updateUseCase = new UpdateWorkoutSet();

    const set = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      weightInGrams: 20000,
      reps: 10,
      rir: 3,
    });

    const updated = await updateUseCase.execute({
      userId: userA.id,
      setId: set.id,
      weightInGrams: 25000,
      reps: 8,
      rir: 1,
      notes: "Subiu carga com boa forma",
    });

    expect(updated.weightInGrams).toBe(25000);
    expect(updated.reps).toBe(8);
    expect(updated.rir).toBe(1);
    expect(updated.notes).toBe("Subiu carga com boa forma");

    // Verificar banco
    const dbSet = await prisma.workoutSet.findUnique({
      where: { id: set.id },
    });
    expect(dbSet?.weightInGrams).toBe(25000);
    expect(dbSet?.reps).toBe(8);
    expect(dbSet?.rir).toBe(1);
  });

  it("Cenário 8 — Completar: completed=true deve preencher completedAt no servidor", async () => {
    const createUseCase = new CreateWorkoutSet();
    const updateUseCase = new UpdateWorkoutSet();

    const set = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      weightInGrams: 20000,
      reps: 10,
      completed: false,
    });

    expect(set.completedAt).toBeNull();

    const completed = await updateUseCase.execute({
      userId: userA.id,
      setId: set.id,
      completed: true,
    });

    expect(completed.completedAt).not.toBeNull();
    const completedDate = new Date(completed.completedAt!);
    expect(completedDate.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("Cenário 9 — Desfazer conclusão: completed=false deve retornar completedAt para null", async () => {
    const createUseCase = new CreateWorkoutSet();
    const updateUseCase = new UpdateWorkoutSet();

    const set = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      weightInGrams: 20000,
      reps: 10,
      completed: true,
    });

    expect(set.completedAt).not.toBeNull();

    const uncompleted = await updateUseCase.execute({
      userId: userA.id,
      setId: set.id,
      completed: false,
    });

    expect(uncompleted.completedAt).toBeNull();

    const dbSet = await prisma.workoutSet.findUnique({
      where: { id: set.id },
    });
    expect(dbSet?.completedAt).toBeNull();
  });

  it("Cenário 10 — Validação de conclusão: não permitir concluir série sem reps e sem durationInSeconds", async () => {
    const createUseCase = new CreateWorkoutSet();
    const updateUseCase = new UpdateWorkoutSet();

    // Criar com completed=true sem reps e sem duration -> lança erro
    await expect(
      createUseCase.execute({
        userId: userA.id,
        sessionExerciseId: sessionExerciseA1.id,
        weightInGrams: 30000,
        completed: true,
      }),
    ).rejects.toThrow(ValidationError);

    // Criar sem reps nem duration, depois tentar concluir no update -> lança erro
    const set = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      weightInGrams: 30000,
      completed: false,
    });

    await expect(
      updateUseCase.execute({
        userId: userA.id,
        setId: set.id,
        completed: true,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("Cenário 11 — Delete: remover série e garantir que somente aquela foi excluída", async () => {
    const createUseCase = new CreateWorkoutSet();
    const deleteUseCase = new DeleteWorkoutSet();

    const set1 = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      reps: 10,
    });

    const set2 = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      reps: 8,
    });

    const deleteResult = await deleteUseCase.execute({
      userId: userA.id,
      setId: set1.id,
    });

    expect(deleteResult.success).toBe(true);

    const dbSet1 = await prisma.workoutSet.findUnique({
      where: { id: set1.id },
    });
    expect(dbSet1).toBeNull();

    const dbSet2 = await prisma.workoutSet.findUnique({
      where: { id: set2.id },
    });
    expect(dbSet2).not.toBeNull();
    expect(dbSet2?.id).toBe(set2.id);
  });

  it("Cenário 12 — Ownership: Usuário B não consegue criar, ler, alterar ou remover série do Usuário A", async () => {
    const createUseCase = new CreateWorkoutSet();
    const updateUseCase = new UpdateWorkoutSet();
    const deleteUseCase = new DeleteWorkoutSet();
    const getUseCase = new GetWorkoutSession();

    const setA = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      reps: 10,
    });

    // Usuário B tenta criar série no SessionExercise do Usuário A -> NotFoundError
    await expect(
      createUseCase.execute({
        userId: userB.id,
        sessionExerciseId: sessionExerciseA1.id,
        reps: 12,
      }),
    ).rejects.toThrow(NotFoundError);

    // Usuário B tenta alterar série do Usuário A -> NotFoundError
    await expect(
      updateUseCase.execute({
        userId: userB.id,
        setId: setA.id,
        reps: 20,
      }),
    ).rejects.toThrow(NotFoundError);

    // Usuário B tenta excluir série do Usuário A -> NotFoundError
    await expect(
      deleteUseCase.execute({
        userId: userB.id,
        setId: setA.id,
      }),
    ).rejects.toThrow(NotFoundError);

    // Usuário B tenta ler sessão do Usuário A -> NotFoundError
    await expect(
      getUseCase.execute({
        userId: userB.id,
        sessionId: sessionA.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("Cenário 13 — Sessão concluída: não permitir mutações (Create, Update, Delete) após WorkoutSession.completedAt != null", async () => {
    const createUseCase = new CreateWorkoutSet();
    const updateUseCase = new UpdateWorkoutSet();
    const deleteUseCase = new DeleteWorkoutSet();

    const setA = await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      reps: 10,
    });

    // Finalizar sessão
    await prisma.workoutSession.update({
      where: { id: sessionA.id },
      data: { completedAt: new Date() },
    });

    // Tentativa de Create em sessão concluída -> WorkoutSessionAlreadyCompletedError
    await expect(
      createUseCase.execute({
        userId: userA.id,
        sessionExerciseId: sessionExerciseA1.id,
        reps: 8,
      }),
    ).rejects.toThrow(WorkoutSessionAlreadyCompletedError);

    // Tentativa de Update em sessão concluída -> WorkoutSessionAlreadyCompletedError
    await expect(
      updateUseCase.execute({
        userId: userA.id,
        setId: setA.id,
        reps: 15,
      }),
    ).rejects.toThrow(WorkoutSessionAlreadyCompletedError);

    // Tentativa de Delete em sessão concluída -> WorkoutSessionAlreadyCompletedError
    await expect(
      deleteUseCase.execute({
        userId: userA.id,
        setId: setA.id,
      }),
    ).rejects.toThrow(WorkoutSessionAlreadyCompletedError);
  });

  it("Cenário 14 — Recuperação: GetWorkoutSession retorna exercícios e séries corretamente ordenados", async () => {
    const createUseCase = new CreateWorkoutSet();
    const getUseCase = new GetWorkoutSession();

    // Exercício 1: duas séries
    await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WARMUP",
      reps: 12,
    });
    await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      weightInGrams: 30000,
      reps: 8,
      rir: 2,
    });

    // Exercício 2: uma série
    await createUseCase.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA2.id,
      type: "WORKING",
      reps: 10,
    });

    const result = await getUseCase.execute({
      userId: userA.id,
      sessionId: sessionA.id,
    });

    expect(result.id).toBe(sessionA.id);
    expect(result.sessionExercises.length).toBe(2);

    // Exercício 1 vem antes do 2
    expect(result.sessionExercises[0].id).toBe(sessionExerciseA1.id);
    expect(result.sessionExercises[0].order).toBe(1);
    expect(result.sessionExercises[0].sets.length).toBe(2);
    expect(result.sessionExercises[0].sets[0].order).toBe(1);
    expect(result.sessionExercises[0].sets[0].type).toBe("WARMUP");
    expect(result.sessionExercises[0].sets[1].order).toBe(2);
    expect(result.sessionExercises[0].sets[1].type).toBe("WORKING");

    // Exercício 2
    expect(result.sessionExercises[1].id).toBe(sessionExerciseA2.id);
    expect(result.sessionExercises[1].order).toBe(2);
    expect(result.sessionExercises[1].sets.length).toBe(1);
    expect(result.sessionExercises[1].sets[0].order).toBe(1);
  });

  it("Cenário 15 — Persistência e GetActiveWorkoutSession: dados vêm integralmente do banco após nova instanciação", async () => {
    const createUseCase1 = new CreateWorkoutSet();

    const createdSet = await createUseCase1.execute({
      userId: userA.id,
      sessionExerciseId: sessionExerciseA1.id,
      type: "WORKING",
      weightInGrams: 40000,
      reps: 6,
      rir: 1,
      durationInSeconds: 30,
      notes: "Série pesada persistida",
      completed: true,
    });

    // Nova instância limpa de GetActiveWorkoutSession
    const getActiveUseCase = new GetActiveWorkoutSession();
    const activeSession = await getActiveUseCase.execute({
      userId: userA.id,
    });

    expect(activeSession.id).toBe(sessionA.id);
    const ex1 = activeSession.sessionExercises.find(
      (e) => e.id === sessionExerciseA1.id,
    );
    expect(ex1).toBeDefined();
    expect(ex1?.sets.length).toBe(1);
    expect(ex1?.sets[0].id).toBe(createdSet.id);
    expect(ex1?.sets[0].weightInGrams).toBe(40000);
    expect(ex1?.sets[0].reps).toBe(6);
    expect(ex1?.sets[0].rir).toBe(1);
    expect(ex1?.sets[0].durationInSeconds).toBe(30);
    expect(ex1?.sets[0].notes).toBe("Série pesada persistida");
    expect(ex1?.sets[0].completedAt).not.toBeNull();
  });

  it("Cenário 16 — Validações de limites e tipos numéricos", async () => {
    const createUseCase = new CreateWorkoutSet();

    // Peso negativo
    await expect(
      createUseCase.execute({
        userId: userA.id,
        sessionExerciseId: sessionExerciseA1.id,
        weightInGrams: -100,
      }),
    ).rejects.toThrow(ValidationError);

    // Reps negativas
    await expect(
      createUseCase.execute({
        userId: userA.id,
        sessionExerciseId: sessionExerciseA1.id,
        reps: -5,
      }),
    ).rejects.toThrow(ValidationError);

    // RIR fora de 0..10
    await expect(
      createUseCase.execute({
        userId: userA.id,
        sessionExerciseId: sessionExerciseA1.id,
        rir: 11,
      }),
    ).rejects.toThrow(ValidationError);

    // Duração negativa
    await expect(
      createUseCase.execute({
        userId: userA.id,
        sessionExerciseId: sessionExerciseA1.id,
        durationInSeconds: -1,
      }),
    ).rejects.toThrow(ValidationError);
  });
});
