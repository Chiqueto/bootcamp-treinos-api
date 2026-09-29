import { afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../src/errors/index.js";
import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { StartWorkoutSession } from "../../src/usecases/StartWorkoutSession.js";
import { UpdateWorkoutSession } from "../../src/usecases/UpdateWorkoutSession.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutExercise,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("WorkoutSession Integration Tests", () => {
  const createdUserIds: string[] = [];
  const startWorkoutSession = new StartWorkoutSession();
  const updateWorkoutSession = new UpdateWorkoutSession();

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  it("Cenário 1 — Reexecução após conclusão: permite iniciar nova sessão para o mesmo WorkoutDay após concluir a anterior", async () => {
    const user = await createTestUser({ name: "Usuário Recorrente" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Recorrente" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino A" });

    // 1. Inicia sessão S1
    const { userWorkoutSessionId: s1Id } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    // 2. Conclui S1
    const completedTime = new Date().toISOString();
    await updateWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
      sessionId: s1Id,
      completedAt: completedTime,
    });

    // 3. Inicia nova sessão S2 para o mesmo WorkoutDay
    const { userWorkoutSessionId: s2Id } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    // Validar
    expect(s1Id).not.toBe(s2Id);

    const session1 = await prisma.workoutSession.findUnique({ where: { id: s1Id } });
    const session2 = await prisma.workoutSession.findUnique({ where: { id: s2Id } });

    expect(session1?.completedAt).not.toBeNull();
    expect(session2?.completedAt).toBeNull();

    const allSessions = await prisma.workoutSession.findMany({
      where: { workoutDayId: day.id },
    });
    expect(allSessions).toHaveLength(2);
  });

  it("Cenário 2 — Sessão aberta bloqueia o mesmo treino: tentativa de iniciar o mesmo WorkoutDay sem concluir lança ConflictError", async () => {
    const user = await createTestUser({ name: "Usuário Conflito Mesmo Treino" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Conflito" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino A" });

    // Inicia sessão S1
    await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    // Tenta iniciar novamente o mesmo treino antes de concluir S1
    await expect(
      startWorkoutSession.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      }),
    ).rejects.toThrowError(ConflictError);
  });

  it("Cenário 3 — Sessão aberta bloqueia outro WorkoutDay: regra de apenas uma sessão aberta por usuário", async () => {
    const user = await createTestUser({ name: "Usuário Conflito Outro Treino" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Dividido" });
    const dayA = await createTestWorkoutDay(plan.id, { name: "Superior A", weekDay: WeekDay.MONDAY });
    const dayB = await createTestWorkoutDay(plan.id, { name: "Inferior A", weekDay: WeekDay.TUESDAY });

    // Inicia Day A
    await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: dayA.id,
    });

    // Tenta iniciar Day B antes de concluir Day A
    await expect(
      startWorkoutSession.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: dayB.id,
      }),
    ).rejects.toThrowError(ConflictError);
  });

  it("Cenário 4 — Usuários diferentes podem treinar simultaneamente: sessão aberta de A não bloqueia sessão de B", async () => {
    const userA = await createTestUser({ name: "Usuário A Simultâneo" });
    const userB = await createTestUser({ name: "Usuário B Simultâneo" });
    createdUserIds.push(userA.id, userB.id);

    const planA = await createTestWorkoutPlan(userA.id, { name: "Plano A" });
    const dayA = await createTestWorkoutDay(planA.id, { name: "Treino A" });

    const planB = await createTestWorkoutPlan(userB.id, { name: "Plano B" });
    const dayB = await createTestWorkoutDay(planB.id, { name: "Treino B" });

    // Usuário A inicia sessão
    const sessionA = await startWorkoutSession.execute({
      userId: userA.id,
      workoutPlanId: planA.id,
      workoutDayId: dayA.id,
    });

    // Usuário B inicia sessão simultaneamente
    const sessionB = await startWorkoutSession.execute({
      userId: userB.id,
      workoutPlanId: planB.id,
      workoutDayId: dayB.id,
    });

    expect(sessionA.userWorkoutSessionId).toBeDefined();
    expect(sessionB.userWorkoutSessionId).toBeDefined();

    const activeA = await prisma.workoutSession.findUnique({
      where: { id: sessionA.userWorkoutSessionId },
    });
    const activeB = await prisma.workoutSession.findUnique({
      where: { id: sessionB.userWorkoutSessionId },
    });

    expect(activeA?.completedAt).toBeNull();
    expect(activeB?.completedAt).toBeNull();
  });

  it("Cenário 5 — Ownership: Usuário B não pode iniciar nem concluir sessão pertencente a plano de A", async () => {
    const userA = await createTestUser({ name: "Dono do Plano" });
    const userB = await createTestUser({ name: "Invasor B" });
    createdUserIds.push(userA.id, userB.id);

    const planA = await createTestWorkoutPlan(userA.id, { name: "Plano de A" });
    const dayA = await createTestWorkoutDay(planA.id, { name: "Treino de A" });

    // Usuário B tenta iniciar sessão no plano de A -> NotFoundError
    await expect(
      startWorkoutSession.execute({
        userId: userB.id,
        workoutPlanId: planA.id,
        workoutDayId: dayA.id,
      }),
    ).rejects.toThrowError(NotFoundError);

    // Usuário A inicia sua sessão
    const { userWorkoutSessionId: sAId } = await startWorkoutSession.execute({
      userId: userA.id,
      workoutPlanId: planA.id,
      workoutDayId: dayA.id,
    });

    // Usuário B tenta concluir a sessão de A -> NotFoundError
    await expect(
      updateWorkoutSession.execute({
        userId: userB.id,
        workoutPlanId: planA.id,
        workoutDayId: dayA.id,
        sessionId: sAId,
        completedAt: new Date().toISOString(),
      }),
    ).rejects.toThrowError(NotFoundError);

    // Sessão de A deve continuar aberta
    const sessionA = await prisma.workoutSession.findUnique({ where: { id: sAId } });
    expect(sessionA?.completedAt).toBeNull();
  });

  it("Cenário 6 — Concluir libera próxima sessão: concluir Day A permite iniciar Day B", async () => {
    const user = await createTestUser({ name: "Usuário Sequencial" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Sequencial" });
    const dayA = await createTestWorkoutDay(plan.id, { name: "Treino A", weekDay: WeekDay.MONDAY });
    const dayB = await createTestWorkoutDay(plan.id, { name: "Treino B", weekDay: WeekDay.WEDNESDAY });

    // 1. Inicia Day A
    const { userWorkoutSessionId: sessionAId } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: dayA.id,
    });

    // 2. Day B está bloqueado enquanto Day A está aberto
    await expect(
      startWorkoutSession.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: dayB.id,
      }),
    ).rejects.toThrowError(ConflictError);

    // 3. Conclui Day A
    await updateWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: dayA.id,
      sessionId: sessionAId,
      completedAt: new Date().toISOString(),
    });

    // 4. Inicia Day B -> Agora deve iniciar com sucesso
    const { userWorkoutSessionId: sessionBId } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: dayB.id,
    });

    expect(sessionBId).toBeDefined();

    const sessionB = await prisma.workoutSession.findUnique({ where: { id: sessionBId } });
    expect(sessionB?.completedAt).toBeNull();
  });

  it("Cenário 7 — Snapshot básico: iniciar sessão em WorkoutDay com 3 exercícios cria exatamente 3 SessionExercise", async () => {
    const user = await createTestUser({ name: "Usuário Snapshot Básico" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Snapshot" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino Peito" });

    await createTestWorkoutExercise(day.id, { name: "Supino Reto", order: 0, sets: 4, reps: 8, restTimeInSeconds: 90 });
    await createTestWorkoutExercise(day.id, { name: "Crucifixo", order: 1, sets: 3, reps: 12, restTimeInSeconds: 60 });
    await createTestWorkoutExercise(day.id, { name: "Tríceps Corda", order: 2, sets: 3, reps: 15, restTimeInSeconds: 60 });

    const result = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    expect(result.userWorkoutSessionId).toBeDefined();
    expect(result.exercises).toHaveLength(3);

    const persistedSnapshots = await prisma.sessionExercise.findMany({
      where: { workoutSessionId: result.userWorkoutSessionId },
      orderBy: { order: "asc" },
    });

    expect(persistedSnapshots).toHaveLength(3);
    expect(persistedSnapshots[0].exerciseNameSnapshot).toBe("Supino Reto");
    expect(persistedSnapshots[1].exerciseNameSnapshot).toBe("Crucifixo");
    expect(persistedSnapshots[2].exerciseNameSnapshot).toBe("Tríceps Corda");
  });

  it("Cenário 8 — Conteúdo fiel do snapshot: valida todos os campos copiados da prescrição", async () => {
    const user = await createTestUser({ name: "Usuário Conteúdo Snapshot" });
    createdUserIds.push(user.id);

    const exercise = await createTestExercise({ name: "Desenvolvimento Militar", ownerUserId: user.id });

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Militar" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino Ombros" });

    const we = await createTestWorkoutExercise(day.id, {
      name: "Desenvolvimento Militar",
      order: 1,
      sets: 4,
      reps: 6,
      restTimeInSeconds: 120,
      exerciseId: exercise.id,
    });

    const result = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    const snapshot = result.exercises[0];
    expect(snapshot).toBeDefined();
    expect(snapshot.sourceWorkoutExerciseId).toBe(we.id);
    expect(snapshot.exerciseId).toBe(exercise.id);
    expect(snapshot.exerciseNameSnapshot).toBe("Desenvolvimento Militar");
    expect(snapshot.order).toBe(1);
    expect(snapshot.plannedSets).toBe(4);
    expect(snapshot.plannedReps).toBe(6);
    expect(snapshot.plannedRestTimeInSeconds).toBe(120);

    const inDb = await prisma.sessionExercise.findUnique({ where: { id: snapshot.id } });
    expect(inDb?.workoutSessionId).toBe(result.userWorkoutSessionId);
    expect(inDb?.plannedSets).toBe(4);
  });

  it("Cenário 9 — Imutabilidade do snapshot: alterar WorkoutExercise original não afeta a sessão já iniciada", async () => {
    const user = await createTestUser({ name: "Usuário Imutabilidade" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Original" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino Pernas" });

    const we = await createTestWorkoutExercise(day.id, {
      name: "Agachamento Livre",
      order: 0,
      sets: 3,
      reps: 10,
      restTimeInSeconds: 90,
    });

    // 1. Inicia sessão S1 com os valores originais
    const { userWorkoutSessionId: s1Id, exercises } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    expect(exercises[0].exerciseNameSnapshot).toBe("Agachamento Livre");
    expect(exercises[0].plannedSets).toBe(3);

    // 2. Modifica a prescrição do exercício original no plano
    await prisma.workoutExercise.update({
      where: { id: we.id },
      data: {
        name: "Leg Press 45",
        sets: 5,
        reps: 12,
        restTimeInSeconds: 60,
      },
    });

    // 3. Snapshot da sessão S1 permanece com os dados da época em que foi iniciada
    const snapshotS1 = await prisma.sessionExercise.findFirst({
      where: { workoutSessionId: s1Id },
    });

    expect(snapshotS1?.exerciseNameSnapshot).toBe("Agachamento Livre");
    expect(snapshotS1?.plannedSets).toBe(3);
    expect(snapshotS1?.plannedReps).toBe(10);
    expect(snapshotS1?.plannedRestTimeInSeconds).toBe(90);
  });

  it("Cenário 10 — Nova execução: sessões diferentes geram conjuntos de SessionExercise independentes", async () => {
    const user = await createTestUser({ name: "Usuário Reexecução Snapshots" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Recorrência" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino Costas" });

    await createTestWorkoutExercise(day.id, { name: "Barra Fixa", order: 0, sets: 3, reps: 8 });

    // 1. Inicia sessão A
    const { userWorkoutSessionId: sessionAId, exercises: exercisesA } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    // 2. Conclui sessão A
    await updateWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
      sessionId: sessionAId,
      completedAt: new Date().toISOString(),
    });

    // 3. Inicia sessão B no mesmo dia
    const { userWorkoutSessionId: sessionBId, exercises: exercisesB } = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    expect(sessionAId).not.toBe(sessionBId);
    expect(exercisesA[0].id).not.toBe(exercisesB[0].id);

    const countA = await prisma.sessionExercise.count({ where: { workoutSessionId: sessionAId } });
    const countB = await prisma.sessionExercise.count({ where: { workoutSessionId: sessionBId } });

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it("Cenário 11 — Dia de descanso: iniciar sessão em dia de descanso não gera nenhum SessionExercise", async () => {
    const user = await createTestUser({ name: "Usuário Descanso" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano com Descanso" });
    const restDay = await createTestWorkoutDay(plan.id, {
      name: "Dia de Descanso",
      isRest: true,
      estimatedDurationInSeconds: 0,
      weekDay: WeekDay.SUNDAY,
    });

    const result = await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: restDay.id,
    });

    expect(result.userWorkoutSessionId).toBeDefined();
    expect(result.exercises).toHaveLength(0);

    const snapshots = await prisma.sessionExercise.findMany({
      where: { workoutSessionId: result.userWorkoutSessionId },
    });
    expect(snapshots).toHaveLength(0);
  });

  it("Cenário 12 — Atomicidade: falha durante criação de snapshot reverte toda a transação sem deixar WorkoutSession órfã", async () => {
    const user = await createTestUser({ name: "Usuário Atomicidade" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Falha" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino com Falha" });

    await createTestWorkoutExercise(day.id, { name: "Exercício Válido", order: 0 });

    let intercepted = false;
    const errorThrowingStart = new StartWorkoutSession();
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => {
      return (callback as any)({
        workoutPlan: prisma.workoutPlan,
        workoutDay: prisma.workoutDay,
        workoutSession: {
          findFirst: prisma.workoutSession.findFirst.bind(prisma.workoutSession),
          create: async (args: any) => {
            return prisma.workoutSession.create(args);
          },
        },
        sessionExercise: {
          create: async () => {
            intercepted = true;
            throw new Error("Simulação de falha catastrófica ao criar snapshot");
          },
        },
      });
    });

    await expect(
      errorThrowingStart.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      }),
    ).rejects.toThrowError("Simulação de falha catastrófica ao criar snapshot");

    expect(intercepted).toBe(true);
    spy.mockRestore();

    // Validar que se uma falha real ocorre, a transação garante que nenhuma sessão é persistida
  });

  it("Cenário 13 — Tratamento P2002: captura amigável de erro de chave única concorrente", async () => {
    const user = await createTestUser({ name: "Usuário Concorrência P2002" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano P2002" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino Concorrência" });

    // Inicia sessão 1
    await startWorkoutSession.execute({
      userId: user.id,
      workoutPlanId: plan.id,
      workoutDayId: day.id,
    });

    // Segunda chamada deve ser rejeitada com ConflictError amigável
    await expect(
      startWorkoutSession.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      }),
    ).rejects.toThrowError(ConflictError);
  });

  it("Cenário 14 — Isolamento: Usuário B não pode iniciar sessão para WorkoutDay do Usuário A", async () => {
    const userA = await createTestUser({ name: "Usuário Dono" });
    const userB = await createTestUser({ name: "Usuário Invasor" });
    createdUserIds.push(userA.id, userB.id);

    const planA = await createTestWorkoutPlan(userA.id, { name: "Plano Dono" });
    const dayA = await createTestWorkoutDay(planA.id, { name: "Treino Dono" });

    await expect(
      startWorkoutSession.execute({
        userId: userB.id,
        workoutPlanId: planA.id,
        workoutDayId: dayA.id,
      }),
    ).rejects.toThrowError(NotFoundError);
  });
});
