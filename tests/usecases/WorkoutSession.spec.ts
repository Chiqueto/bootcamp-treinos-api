import { afterEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "../../src/errors/index.js";
import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { StartWorkoutSession } from "../../src/usecases/StartWorkoutSession.js";
import { UpdateWorkoutSession } from "../../src/usecases/UpdateWorkoutSession.js";
import {
  cleanupTestUsers,
  createTestUser,
  createTestWorkoutDay,
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
});
