import { afterEach, describe, expect, it } from "vitest";

import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { CreateWorkoutPlan } from "../../src/usecases/CreateWorkoutPlan.js";
import {
  cleanupTestUsers,
  createTestPeriodization,
  createTestPeriodizationPlan,
  createTestUser,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("Periodization Persistence & Domain Invariants (Task 2.1B)", () => {
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

  it("1. Criar plano com comportamento legado (activate omitido) cria ativo e desativa plano anterior", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const plan1 = await createTestWorkoutPlan(user.id, {
      name: "Plano Anterior",
      isActive: true,
    });

    const result = await createWorkoutPlan.execute({
      userId: user.id,
      name: "Novo Plano Legado",
      workoutDays: defaultWorkoutDays,
    });

    const updatedPlan1 = await prisma.workoutPlan.findUnique({
      where: { id: plan1.id },
    });
    const createdPlan = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(updatedPlan1?.isActive).toBe(false);
    expect(createdPlan?.isActive).toBe(true);
    expect(result.isActive).toBe(true);
  });

  it("2. Criar plano com activate: true desativa plano atual e ativa o novo", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const plan1 = await createTestWorkoutPlan(user.id, {
      name: "Plano 1",
      isActive: true,
    });

    const result = await createWorkoutPlan.execute({
      userId: user.id,
      name: "Plano 2 Ativo",
      activate: true,
      workoutDays: defaultWorkoutDays,
    });

    const updatedPlan1 = await prisma.workoutPlan.findUnique({
      where: { id: plan1.id },
    });
    expect(updatedPlan1?.isActive).toBe(false);
    expect(result.isActive).toBe(true);
  });

  it("3. Criar plano com activate: false cria plano inativo", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const result = await createWorkoutPlan.execute({
      userId: user.id,
      name: "Plano Draft",
      activate: false,
      workoutDays: defaultWorkoutDays,
    });

    const createdPlan = await prisma.workoutPlan.findUnique({
      where: { id: result.id },
    });

    expect(createdPlan?.isActive).toBe(false);
    expect(result.isActive).toBe(false);
  });

  it("4. activate: false não desativa o plano ativo atual", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const planActive = await createTestWorkoutPlan(user.id, {
      name: "Plano Ativo Atual",
      isActive: true,
    });

    const result = await createWorkoutPlan.execute({
      userId: user.id,
      name: "Plano Bloco Inativo",
      activate: false,
      workoutDays: defaultWorkoutDays,
    });

    const refreshedActive = await prisma.workoutPlan.findUnique({
      where: { id: planActive.id },
    });

    expect(refreshedActive?.isActive).toBe(true);
    expect(result.isActive).toBe(false);
  });

  it("5. Não permitir 2 WorkoutPlans ativos para o mesmo usuário no banco", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    await createTestWorkoutPlan(user.id, {
      name: "Plano Ativo 1",
      isActive: true,
    });

    // Tentativa direta no banco de criar segundo plano ativo para o mesmo usuário
    await expect(
      createTestWorkoutPlan(user.id, {
        name: "Plano Ativo 2 Ilegal",
        isActive: true,
      }),
    ).rejects.toThrow();
  });

  it("6. Usuários diferentes podem ter seus próprios planos ativos simultaneamente", async () => {
    const userA = await createTestUser({ name: "User A" });
    const userB = await createTestUser({ name: "User B" });
    createdUserIds.push(userA.id, userB.id);

    const planA = await createTestWorkoutPlan(userA.id, {
      name: "Plano A",
      isActive: true,
    });
    const planB = await createTestWorkoutPlan(userB.id, {
      name: "Plano B",
      isActive: true,
    });

    expect(planA.isActive).toBe(true);
    expect(planB.isActive).toBe(true);

    const activeA = await prisma.workoutPlan.findMany({
      where: { userId: userA.id, isActive: true },
    });
    const activeB = await prisma.workoutPlan.findMany({
      where: { userId: userB.id, isActive: true },
    });

    expect(activeA).toHaveLength(1);
    expect(activeB).toHaveLength(1);
  });

  it("7. Não permitir 2 Periodizations ativas para o mesmo usuário", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    await createTestPeriodization(user.id, {
      name: "Periodização 1",
      isActive: true,
      startedAt: new Date(),
    });

    await expect(
      createTestPeriodization(user.id, {
        name: "Periodização 2 Ilegal",
        isActive: true,
        startedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("8. Não permitir 2 blocos abertos (activatedAt!=null && completedAt==null) na mesma periodização", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const periodization = await createTestPeriodization(user.id, {
      name: "Periodização Bloco Único",
    });

    const plan1 = await createTestWorkoutPlan(user.id, {
      name: "Plano 1",
      isActive: false,
    });
    const plan2 = await createTestWorkoutPlan(user.id, {
      name: "Plano 2",
      isActive: false,
    });

    // Primeiro bloco aberto
    await createTestPeriodizationPlan(periodization.id, plan1.id, {
      order: 1,
      activatedAt: new Date("2026-01-01T10:00:00Z"),
      completedAt: null,
    });

    // Segundo bloco aberto na MESMA periodização deve falhar no banco
    await expect(
      createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
        activatedAt: new Date("2026-02-01T10:00:00Z"),
        completedAt: null,
      }),
    ).rejects.toThrow();
  });

  it("9. Mesmo WorkoutPlan não pode pertencer a duas periodizações diferentes (unicidade global de workoutPlanId)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const per1 = await createTestPeriodization(user.id, { name: "P1" });
    const per2 = await createTestPeriodization(user.id, { name: "P2" });

    const plan = await createTestWorkoutPlan(user.id, {
      name: "Plano Compartilhado Não Permitido",
      isActive: false,
    });

    // Associar ao per1
    await createTestPeriodizationPlan(per1.id, plan.id, { order: 1 });

    // Tentar associar o mesmo plano ao per2 deve violar a unicidade
    await expect(
      createTestPeriodizationPlan(per2.id, plan.id, { order: 1 }),
    ).rejects.toThrow();
  });

  it("10. Mesma ordem não pode aparecer duas vezes na mesma periodização", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const per = await createTestPeriodization(user.id, { name: "P Ordem" });
    const plan1 = await createTestWorkoutPlan(user.id, {
      name: "Plano 1",
      isActive: false,
    });
    const plan2 = await createTestWorkoutPlan(user.id, {
      name: "Plano 2",
      isActive: false,
    });

    await createTestPeriodizationPlan(per.id, plan1.id, { order: 1 });

    await expect(
      createTestPeriodizationPlan(per.id, plan2.id, { order: 1 }),
    ).rejects.toThrow();
  });

  it("11. order <= 0 é rejeitado pelo CHECK de banco", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const per = await createTestPeriodization(user.id, { name: "P Order Check" });
    const plan = await createTestWorkoutPlan(user.id, {
      name: "Plano Order Zero",
      isActive: false,
    });

    await expect(
      createTestPeriodizationPlan(per.id, plan.id, { order: 0 }),
    ).rejects.toThrow();

    await expect(
      createTestPeriodizationPlan(per.id, plan.id, { order: -1 }),
    ).rejects.toThrow();
  });

  it("12. Fim previsto anterior ao início previsto é rejeitado pelo CHECK de banco", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const per = await createTestPeriodization(user.id, { name: "P Dates Check" });
    const plan = await createTestWorkoutPlan(user.id, {
      name: "Plano Datas Inválidas",
      isActive: false,
    });

    await expect(
      createTestPeriodizationPlan(per.id, plan.id, {
        order: 1,
        plannedStartDate: new Date("2026-03-10"),
        plannedEndDate: new Date("2026-03-01"), // anterior ao início!
      }),
    ).rejects.toThrow();
  });

  it("13. Bloco com completedAt < activatedAt é rejeitado pelo CHECK de banco", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    const per = await createTestPeriodization(user.id, { name: "P Real Timestamps" });
    const plan = await createTestWorkoutPlan(user.id, {
      name: "Plano Timestamps Inválidos",
      isActive: false,
    });

    await expect(
      createTestPeriodizationPlan(per.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-04-10T12:00:00Z"),
        completedAt: new Date("2026-04-01T12:00:00Z"), // antes de activatedAt!
      }),
    ).rejects.toThrow();
  });

  it("14. Periodização concluída não pode permanecer ativa (CHECK de banco)", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);

    // Tentativa de criar ou atualizar Periodization com isActive=true E completedAt!=null
    await expect(
      createTestPeriodization(user.id, {
        name: "P Concluída e Ativa Ilegal",
        isActive: true,
        completedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  // Task 2.1C — Hardening de Estado da Periodização
  describe("Task 2.1C Hardening Checks", () => {
    it("15. PeriodizationPlan: completedAt sem activatedAt é rejeitado pelo CHECK de banco", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, {
        name: "P Hardening 1",
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Hardening 1",
        isActive: false,
      });

      await expect(
        createTestPeriodizationPlan(per.id, plan.id, {
          order: 1,
          activatedAt: null,
          completedAt: new Date(),
        }),
      ).rejects.toThrow();
    });

    it("16. PeriodizationPlan: activatedAt sem completedAt é aceito (bloco ativo em andamento)", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, {
        name: "P Hardening 2",
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Hardening 2",
        isActive: false,
      });

      const pPlan = await createTestPeriodizationPlan(per.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
        completedAt: null,
      });

      expect(pPlan.id).toBeDefined();
      expect(pPlan.activatedAt).not.toBeNull();
      expect(pPlan.completedAt).toBeNull();
    });

    it("17. PeriodizationPlan: activatedAt + completedAt válido (completedAt >= activatedAt) é aceito", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, {
        name: "P Hardening 3",
        startedAt: new Date("2026-01-01T10:00:00Z"),
      });
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Hardening 3",
        isActive: false,
      });

      const pPlan = await createTestPeriodizationPlan(per.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-01-01T10:00:00Z"),
        completedAt: new Date("2026-01-15T10:00:00Z"),
      });

      expect(pPlan.id).toBeDefined();
      expect(pPlan.activatedAt).not.toBeNull();
      expect(pPlan.completedAt).not.toBeNull();
    });

    it("18. Periodization: isActive=true e startedAt=null é rejeitado pelo CHECK de banco", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      await expect(
        createTestPeriodization(user.id, {
          name: "P Ativa Sem StartedAt Ilegal",
          isActive: true,
          startedAt: null,
        }),
      ).rejects.toThrow();
    });

    it("19. Periodization: completedAt preenchido e startedAt=null é rejeitado pelo CHECK de banco", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      await expect(
        createTestPeriodization(user.id, {
          name: "P Concluída Sem StartedAt Ilegal",
          isActive: false,
          startedAt: null,
          completedAt: new Date(),
        }),
      ).rejects.toThrow();
    });

    it("20. Periodization: startedAt preenchido e isActive=true é aceito", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, {
        name: "P Ativa Válida",
        isActive: true,
        startedAt: new Date(),
        completedAt: null,
      });

      expect(per.id).toBeDefined();
      expect(per.isActive).toBe(true);
      expect(per.startedAt).not.toBeNull();
      expect(per.completedAt).toBeNull();
    });

    it("21. Periodization: startedAt + completedAt + isActive=false é aceito (periodização concluída)", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, {
        name: "P Concluída Válida",
        isActive: false,
        startedAt: new Date("2026-01-01T10:00:00Z"),
        completedAt: new Date("2026-02-01T10:00:00Z"),
      });

      expect(per.id).toBeDefined();
      expect(per.isActive).toBe(false);
      expect(per.startedAt).not.toBeNull();
      expect(per.completedAt).not.toBeNull();
    });
  });
});
