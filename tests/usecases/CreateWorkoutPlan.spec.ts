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

  it("Cenário 3 — Estado legado inconsistente: múltiplos planos ativos antigos são todos desativados por updateMany", async () => {
    const userA = await createTestUser({ name: "Usuário A" });
    createdUserIds.push(userA.id);

    // Preparar propositalmente 2 planos ativos para o Usuário A
    const planLegacy1 = await createTestWorkoutPlan(userA.id, {
      name: "Plano Legado 1",
      isActive: true,
    });
    const planLegacy2 = await createTestWorkoutPlan(userA.id, {
      name: "Plano Legado 2",
      isActive: true,
    });

    // Executar criação de A3 para Usuário A
    const result = await createWorkoutPlan.execute({
      userId: userA.id,
      name: "Plano A3",
      workoutDays: defaultWorkoutDays,
    });

    // Validar que ambos os legados ficaram inativos
    const updatedLegacy1 = await prisma.workoutPlan.findUnique({
      where: { id: planLegacy1.id },
    });
    const updatedLegacy2 = await prisma.workoutPlan.findUnique({
      where: { id: planLegacy2.id },
    });
    const planA3 = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(updatedLegacy1?.isActive).toBe(false);
    expect(updatedLegacy2?.isActive).toBe(false);
    expect(planA3?.isActive).toBe(true);

    // Validar que somente A3 permanece ativo para A
    const activePlansA = await prisma.workoutPlan.findMany({
      where: {
        userId: userA.id,
        isActive: true,
      },
    });

    expect(activePlansA).toHaveLength(1);
    expect(activePlansA[0]?.id).toBe(result.id);
  });
});
