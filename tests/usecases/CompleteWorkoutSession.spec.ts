import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, PendingWorkoutSetsError } from "../../src/errors/index.js";
import { prisma } from "../../src/lib/db.js";
import { CompleteWorkoutSession } from "../../src/usecases/CompleteWorkoutSession.js";
import { GetActiveWorkoutSession } from "../../src/usecases/GetActiveWorkoutSession.js";
import {
  cleanupTestUsers,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
  createTestWorkoutSession,
  createTestWorkoutSet,
} from "../helpers/test-db.js";

describe("CompleteWorkoutSession Use Case", () => {
  const testUserIds: string[] = [];
  const completeWorkoutSession = new CompleteWorkoutSession();
  const getActiveWorkoutSession = new GetActiveWorkoutSession();

  let userA: { id: string };
  let userB: { id: string };
  let workoutPlanA: { id: string };
  let workoutDayA: { id: string };

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    testUserIds.push(userA.id, userB.id);

    workoutPlanA = await createTestWorkoutPlan(userA.id);
    workoutDayA = await createTestWorkoutDay(workoutPlanA.id);
  });

  afterEach(async () => {
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
  });

  it("conclui sessão do próprio usuário com sucesso e servidor define completedAt", async () => {
    const beforeCall = new Date();
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });

    const result = await completeWorkoutSession.execute({
      userId: userA.id,
      sessionId: session.id,
    });

    const afterCall = new Date();

    expect(result.id).toBe(session.id);
    expect(result.completedAt).toBeDefined();

    const completedAtDate = new Date(result.completedAt);
    expect(completedAtDate.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime() - 1000);
    expect(completedAtDate.getTime()).toBeLessThanOrEqual(afterCall.getTime() + 1000);

    const updatedInDb = await prisma.workoutSession.findUnique({
      where: { id: session.id },
    });
    expect(updatedInDb?.completedAt).not.toBeNull();
  });

  it("não permite que usuário B conclua a sessão de A (retorna NotFound)", async () => {
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });

    await expect(
      completeWorkoutSession.execute({
        userId: userB.id,
        sessionId: session.id,
      }),
    ).rejects.toThrow(NotFoundError);

    const inDb = await prisma.workoutSession.findUnique({
      where: { id: session.id },
    });
    expect(inDb?.completedAt).toBeNull();
  });

  it("sessão inexistente retorna NotFound", async () => {
    await expect(
      completeWorkoutSession.execute({
        userId: userA.id,
        sessionId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("sessão já concluída é idempotente e preserva o completedAt original", async () => {
    const originalCompletedAt = new Date(Date.now() - 3600000); // 1 hora atrás
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(Date.now() - 7200000),
      completedAt: originalCompletedAt,
    });

    const result = await completeWorkoutSession.execute({
      userId: userA.id,
      sessionId: session.id,
    });

    expect(result.id).toBe(session.id);
    expect(new Date(result.completedAt).getTime()).toBe(originalCompletedAt.getTime());

    const inDb = await prisma.workoutSession.findUnique({
      where: { id: session.id },
    });
    expect(inDb?.completedAt?.getTime()).toBe(originalCompletedAt.getTime());
  });

  it("sessão com zero séries pode ser concluída normalmente", async () => {
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });
    await createTestSessionExercise(session.id, {
      plannedSets: 3,
    });

    const result = await completeWorkoutSession.execute({
      userId: userA.id,
      sessionId: session.id,
    });

    expect(result.id).toBe(session.id);
    expect(result.completedAt).toBeDefined();
  });

  it("sessão com séries concluídas (mesmo inferior a plannedSets) pode ser concluída", async () => {
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });
    const sessionExercise = await createTestSessionExercise(session.id, {
      plannedSets: 4,
    });

    // 2 séries concluídas de 4 planejadas
    await createTestWorkoutSet(sessionExercise.id, {
      order: 1,
      reps: 8,
      completedAt: new Date(),
    });
    await createTestWorkoutSet(sessionExercise.id, {
      order: 2,
      reps: 8,
      completedAt: new Date(),
    });

    const result = await completeWorkoutSession.execute({
      userId: userA.id,
      sessionId: session.id,
    });

    expect(result.id).toBe(session.id);
    expect(result.completedAt).toBeDefined();
  });

  it("sessão com WorkoutSet pendente (completedAt === null) NÃO pode ser concluída", async () => {
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });
    const sessionExercise = await createTestSessionExercise(session.id);

    // Série pendente
    await createTestWorkoutSet(sessionExercise.id, {
      order: 1,
      reps: 10,
      completedAt: null,
    });

    await expect(
      completeWorkoutSession.execute({
        userId: userA.id,
        sessionId: session.id,
      }),
    ).rejects.toThrow(PendingWorkoutSetsError);

    // Confirma que a sessão não foi concluída
    const inDb = await prisma.workoutSession.findUnique({
      where: { id: session.id },
    });
    expect(inDb?.completedAt).toBeNull();
  });

  it("depois de concluir, usuário pode iniciar nova sessão e GET /workout-sessions/active deixa de retornar aquela sessão", async () => {
    const session = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });

    // Antes de concluir, getActiveWorkoutSession retorna a sessão
    const activeBefore = await getActiveWorkoutSession.execute({ userId: userA.id });
    expect(activeBefore.id).toBe(session.id);

    // Conclui a sessão
    await completeWorkoutSession.execute({
      userId: userA.id,
      sessionId: session.id,
    });

    // Agora getActiveWorkoutSession deve lançar NotFoundError
    await expect(
      getActiveWorkoutSession.execute({ userId: userA.id }),
    ).rejects.toThrow(NotFoundError);

    // Usuário agora pode criar uma nova sessão ativa sem colidir com índice parcial único
    const newSession = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });

    expect(newSession.id).toBeDefined();
    const activeAfter = await getActiveWorkoutSession.execute({ userId: userA.id });
    expect(activeAfter.id).toBe(newSession.id);
  });
});
