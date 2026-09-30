import { afterEach, describe, expect, it } from "vitest";

import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { CreateWorkoutPlan } from "../../src/usecases/CreateWorkoutPlan.js";
import {
  cleanupTestUsers,
  createTestUser,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("CreateWorkoutPlan Integration Tests", () => {
  const createdUserIds: string[] = [];
  const createWorkoutPlan = new CreateWorkoutPlan();

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  const defaultWorkoutDays = [
    {
      name: "Treino A",
      weekDay: WeekDay.MONDAY,
      isRest: false,
      estimatedDurationInSeconds: 3600,
      coverImageUrl: null,
      exercises: [
        {
          order: 0,
          name: "Supino Reto",
          sets: 4,
          reps: 10,
          restTimeInSeconds: 90,
        },
      ],
    },
  ];

  it("Cenário 1 — Isolamento entre usuários: criação de plano para Usuário A não desativa plano do Usuário B", async () => {
    const userA = await createTestUser({ name: "Usuário A" });
    const userB = await createTestUser({ name: "Usuário B" });
    createdUserIds.push(userA.id, userB.id);

    // Preparar planos ativos A1 e B1
    const planA1 = await createTestWorkoutPlan(userA.id, {
      name: "Plano A1",
      isActive: true,
    });
    const planB1 = await createTestWorkoutPlan(userB.id, {
      name: "Plano B1",
      isActive: true,
    });

    // Executar CreateWorkoutPlan para Usuário A
    const result = await createWorkoutPlan.execute({
      userId: userA.id,
      name: "Plano A2",
      workoutDays: defaultWorkoutDays,
    });

    // Validar estado de A1 e do novo plano A2
    const updatedA1 = await prisma.workoutPlan.findUnique({
      where: { id: planA1.id },
    });
    const planA2 = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(updatedA1?.isActive).toBe(false);
    expect(planA2?.isActive).toBe(true);
    expect(planA2?.userId).toBe(userA.id);

    // Validar que B1 continua ativo e nenhum dado do Usuário B foi alterado
    const updatedB1 = await prisma.workoutPlan.findUnique({
      where: { id: planB1.id },
    });

    expect(updatedB1?.isActive).toBe(true);
    expect(updatedB1?.name).toBe("Plano B1");
    expect(updatedB1?.userId).toBe(userB.id);
    expect(updatedB1?.updatedAt.getTime()).toBe(planB1.updatedAt.getTime());
  });

  it("Cenário 2 — Rotação de plano do mesmo usuário: apenas um plano permanece ativo após criar novo", async () => {
    const userA = await createTestUser({ name: "Usuário A" });
    createdUserIds.push(userA.id);

    // Preparar plano ativo A1
    const planA1 = await createTestWorkoutPlan(userA.id, {
      name: "Plano A1",
      isActive: true,
    });

    // Executar criação de A2 para Usuário A
    const result = await createWorkoutPlan.execute({
      userId: userA.id,
      name: "Plano A2",
      workoutDays: defaultWorkoutDays,
    });

    // Validar que A1 ficou inativo e A2 ficou ativo
    const updatedA1 = await prisma.workoutPlan.findUnique({
      where: { id: planA1.id },
    });
    const planA2 = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(updatedA1?.isActive).toBe(false);
    expect(planA2?.isActive).toBe(true);

    // Validar que existe SOMENTE um plano ativo para o Usuário A
    const activePlansA = await prisma.workoutPlan.findMany({
      where: {
        userId: userA.id,
        isActive: true,
      },
    });

    expect(activePlansA).toHaveLength(1);
    expect(activePlansA[0]?.id).toBe(result.id);
  });

  it("Cenário 3 — Criação com activate: false não desativa o plano ativo atual e cria o novo inativo", async () => {
    const userA = await createTestUser({ name: "Usuário A" });
    createdUserIds.push(userA.id);

    // Preparar plano ativo A1
    const planA1 = await createTestWorkoutPlan(userA.id, {
      name: "Plano A1",
      isActive: true,
    });

    // Executar criação de A2 com activate: false
    const result = await createWorkoutPlan.execute({
      userId: userA.id,
      name: "Plano A2 (Inativo)",
      activate: false,
      workoutDays: defaultWorkoutDays,
    });

    // Validar que A1 continua ativo e A2 foi criado inativo
    const updatedA1 = await prisma.workoutPlan.findUnique({
      where: { id: planA1.id },
    });
    const planA2 = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(updatedA1?.isActive).toBe(true);
    expect(planA2?.isActive).toBe(false);
    expect(result.isActive).toBe(false);

    // Validar que apenas A1 continua como ativo
    const activePlansA = await prisma.workoutPlan.findMany({
      where: {
        userId: userA.id,
        isActive: true,
      },
    });

    expect(activePlansA).toHaveLength(1);
    expect(activePlansA[0]?.id).toBe(planA1.id);
  });

  it("Cenário 4 — Criação com activate: true explícito desativa o plano ativo atual e ativa o novo", async () => {
    const userA = await createTestUser({ name: "Usuário A" });
    createdUserIds.push(userA.id);

    const planA1 = await createTestWorkoutPlan(userA.id, {
      name: "Plano A1",
      isActive: true,
    });

    const result = await createWorkoutPlan.execute({
      userId: userA.id,
      name: "Plano A2",
      activate: true,
      workoutDays: defaultWorkoutDays,
    });

    const updatedA1 = await prisma.workoutPlan.findUnique({
      where: { id: planA1.id },
    });
    const planA2 = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(updatedA1?.isActive).toBe(false);
    expect(planA2?.isActive).toBe(true);
    expect(result.isActive).toBe(true);
  });

  it("Cenário 5 — Constraint de banco: não permitir 2 WorkoutPlans ativos para o mesmo usuário no PostgreSQL", async () => {
    const userA = await createTestUser({ name: "Usuário A" });
    createdUserIds.push(userA.id);

    // Primeiro plano ativo criado com sucesso
    await createTestWorkoutPlan(userA.id, {
      name: "Plano A1",
      isActive: true,
    });

    // Tentativa direta de inserir segundo plano ativo para o mesmo usuário no banco deve falhar
    await expect(
      createTestWorkoutPlan(userA.id, {
        name: "Plano A2 Ilegal",
        isActive: true,
      }),
    ).rejects.toThrow();
  });
});
