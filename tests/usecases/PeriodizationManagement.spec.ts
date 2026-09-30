import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ActiveBlockCannotBeRemovedError,
  ActivePlanCannotBeAttachedError,
  CompletedBlockCannotBeRemovedError,
  CompletedBlockImmutableError,
  InvalidReorderBlocksError,
  NotFoundError,
  PeriodizationAlreadyStartedError,
  PeriodizationCompletedError,
  PlanAlreadyInPeriodizationError,
  ValidationError,
} from "../../src/errors/index.js";
import { WeekDay } from "../../src/generated/prisma/enums.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { periodizationRoutes } from "../../src/routes/periodization.js";
import { AddWorkoutPlanToPeriodization } from "../../src/usecases/AddWorkoutPlanToPeriodization.js";
import { CreatePeriodization } from "../../src/usecases/CreatePeriodization.js";
import { CreateWorkoutPlanInPeriodization } from "../../src/usecases/CreateWorkoutPlanInPeriodization.js";
import { DeletePeriodization } from "../../src/usecases/DeletePeriodization.js";
import { GetPeriodization } from "../../src/usecases/GetPeriodization.js";
import { ListPeriodizations } from "../../src/usecases/ListPeriodizations.js";
import { RemoveWorkoutPlanFromPeriodization } from "../../src/usecases/RemoveWorkoutPlanFromPeriodization.js";
import { ReorderPeriodizationPlans } from "../../src/usecases/ReorderPeriodizationPlans.js";
import { UpdatePeriodization } from "../../src/usecases/UpdatePeriodization.js";
import { UpdatePeriodizationPlan } from "../../src/usecases/UpdatePeriodizationPlan.js";
import {
  cleanupTestUsers,
  createTestPeriodization,
  createTestPeriodizationPlan,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutExercise,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("Periodization Composition & Management (Task 2.3A)", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];

  const createPeriodization = new CreatePeriodization();
  const listPeriodizations = new ListPeriodizations();
  const getPeriodization = new GetPeriodization();
  const updatePeriodization = new UpdatePeriodization();
  const deletePeriodization = new DeletePeriodization();
  const addWorkoutPlanToPeriodization = new AddWorkoutPlanToPeriodization();
  const createWorkoutPlanInPeriodization =
    new CreateWorkoutPlanInPeriodization();
  const updatePeriodizationPlan = new UpdatePeriodizationPlan();
  const removeWorkoutPlanFromPeriodization =
    new RemoveWorkoutPlanFromPeriodization();
  const reorderPeriodizationPlans = new ReorderPeriodizationPlans();

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(periodizationRoutes, { prefix: "/periodizations" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
    vi.restoreAllMocks();
  });

  describe("CreatePeriodization", () => {
    it("1. Cria periodização como rascunho (inativa, sem timestamps de execução)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const result = await createPeriodization.execute({
        userId: user.id,
        name: "  Pré-Temporada Vôlei  ",
        goal: "Preparação física",
        notes: "Bloco inicial",
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe("Pré-Temporada Vôlei");
      expect(result.goal).toBe("Preparação física");
      expect(result.notes).toBe("Bloco inicial");
      expect(result.isActive).toBe(false);
      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.status).toBe("DRAFT");
    });

    it("2. Rejeita criação com nome vazio após trim", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      await expect(
        createPeriodization.execute({
          userId: user.id,
          name: "   ",
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("ListPeriodizations & Status Derivation", () => {
    it("3. Lista somente periodizações do usuário autenticado com estado derivado correto", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      testUserIds.push(userA.id, userB.id);

      // Periodização Draft
      await createTestPeriodization(userA.id, {
        name: "P1 Draft",
        isActive: false,
        startedAt: null,
        completedAt: null,
      });

      // Periodização Active
      await createTestPeriodization(userA.id, {
        name: "P2 Ativa",
        isActive: true,
        startedAt: new Date(),
        completedAt: null,
      });

      // Periodização Paused
      await createTestPeriodization(userA.id, {
        name: "P3 Pausada",
        isActive: false,
        startedAt: new Date(Date.now() - 86400000),
        completedAt: null,
      });

      // Periodização Completed
      await createTestPeriodization(userA.id, {
        name: "P4 Concluída",
        isActive: false,
        startedAt: new Date(Date.now() - 172800000),
        completedAt: new Date(),
      });

      // Periodização de outro usuário
      await createTestPeriodization(userB.id, {
        name: "P User B",
      });

      const list = await listPeriodizations.execute({ userId: userA.id });

      expect(list).toHaveLength(4);
      expect(list.map((p) => p.name)).not.toContain("P User B");

      const draft = list.find((p) => p.name === "P1 Draft")!;
      expect(draft.status).toBe("DRAFT");

      const active = list.find((p) => p.name === "P2 Ativa")!;
      expect(active.status).toBe("ACTIVE");

      const paused = list.find((p) => p.name === "P3 Pausada")!;
      expect(paused.status).toBe("PAUSED");

      const completed = list.find((p) => p.name === "P4 Concluída")!;
      expect(completed.status).toBe("COMPLETED");
    });
  });

  describe("GetPeriodization & Ownership", () => {
    it("4. Retorna periodização detalhada com planos ordenados por order ASC", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Vôlei",
      });

      const plan1 = await createTestWorkoutPlan(user.id, {
        name: "Base",
        isActive: false,
      });
      const plan2 = await createTestWorkoutPlan(user.id, {
        name: "Força",
        isActive: false,
      });

      await createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
        plannedStartDate: new Date("2026-10-15T00:00:00Z"),
      });
      await createTestPeriodizationPlan(periodization.id, plan1.id, {
        order: 1,
        plannedStartDate: new Date("2026-10-01T00:00:00Z"),
      });

      const result = await getPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(result.id).toBe(periodization.id);
      expect(result.plans).toHaveLength(2);
      expect(result.plans[0].order).toBe(1);
      expect(result.plans[0].workoutPlan.name).toBe("Base");
      expect(result.plans[1].order).toBe(2);
      expect(result.plans[1].workoutPlan.name).toBe("Força");
    });

    it("5. Retorna 404 NotFound ao buscar periodização de outro usuário", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      testUserIds.push(userA.id, userB.id);

      const periodizationA = await createTestPeriodization(userA.id);

      await expect(
        getPeriodization.execute({
          userId: userB.id,
          periodizationId: periodizationA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("UpdatePeriodization", () => {
    it("6. Atualiza apenas metadados e permite edição mesmo em periodização concluída", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Nome Antigo",
        startedAt: new Date(Date.now() - 86400000),
        completedAt: new Date(),
      });

      const updated = await updatePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        name: "Nome Novo",
        goal: "Novo Objetivo",
        notes: "Novas Notas",
      });

      expect(updated.name).toBe("Nome Novo");
      expect(updated.goal).toBe("Novo Objetivo");
      expect(updated.notes).toBe("Novas Notas");
      expect(updated.status).toBe("COMPLETED");
    });
  });

  describe("AddWorkoutPlanToPeriodization", () => {
    it("7. Adiciona plano inativo com cálculo automático de order e datas opcionais", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Fase 1",
        isActive: false,
      });

      const result = await addWorkoutPlanToPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        workoutPlanId: plan.id,
        plannedStartDate: "2026-10-01",
        plannedEndDate: "2026-10-28",
        notes: "4 semanas de base",
      });

      expect(result.order).toBe(1);
      expect(result.workoutPlanId).toBe(plan.id);
      expect(result.plannedStartDate).toBe("2026-10-01");
      expect(result.plannedEndDate).toBe("2026-10-28");
      expect(result.activatedAt).toBeNull();
      expect(result.completedAt).toBeNull();
    });

    it("8. Incrementa ordem automaticamente para o próximo plano (order = max + 1)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan1 = await createTestWorkoutPlan(user.id, { isActive: false });
      const plan2 = await createTestWorkoutPlan(user.id, { isActive: false });

      await addWorkoutPlanToPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        workoutPlanId: plan1.id,
      });

      const second = await addWorkoutPlanToPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        workoutPlanId: plan2.id,
      });

      expect(second.order).toBe(2);
    });

    it("9. Bloqueia associar plano de outro usuário (ownership cruzado -> 404)", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      testUserIds.push(userA.id, userB.id);

      const periodizationA = await createTestPeriodization(userA.id);
      const planB = await createTestWorkoutPlan(userB.id, { isActive: false });

      await expect(
        addWorkoutPlanToPeriodization.execute({
          userId: userA.id,
          periodizationId: periodizationA.id,
          workoutPlanId: planB.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("10. Bloqueia associar plano que já está ativo (ACTIVE_PLAN_CANNOT_BE_ATTACHED)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const activePlan = await createTestWorkoutPlan(user.id, {
        isActive: true,
      });

      await expect(
        addWorkoutPlanToPeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
          workoutPlanId: activePlan.id,
        }),
      ).rejects.toThrow(ActivePlanCannotBeAttachedError);
    });

    it("11. Bloqueia associar plano que já pertence a outra periodização (PLAN_ALREADY_IN_PERIODIZATION)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const p1 = await createTestPeriodization(user.id);
      const p2 = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });

      await addWorkoutPlanToPeriodization.execute({
        userId: user.id,
        periodizationId: p1.id,
        workoutPlanId: plan.id,
      });

      await expect(
        addWorkoutPlanToPeriodization.execute({
          userId: user.id,
          periodizationId: p2.id,
          workoutPlanId: plan.id,
        }),
      ).rejects.toThrow(PlanAlreadyInPeriodizationError);
    });

    it("12. Bloqueia adicionar plano em periodização concluída", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(Date.now() - 86400000),
        completedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });

      await expect(
        addWorkoutPlanToPeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
          workoutPlanId: plan.id,
        }),
      ).rejects.toThrow(PeriodizationCompletedError);
    });

    it("13. Em periodização ativa, permite adicionar novo plano ao final como bloco futuro", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const activePeriodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const block1 = await createTestWorkoutPlan(user.id, { isActive: false });
      await createTestPeriodizationPlan(activePeriodization.id, block1.id, {
        order: 1,
        activatedAt: new Date(),
      });

      const newFuturePlan = await createTestWorkoutPlan(user.id, {
        isActive: false,
      });

      const result = await addWorkoutPlanToPeriodization.execute({
        userId: user.id,
        periodizationId: activePeriodization.id,
        workoutPlanId: newFuturePlan.id,
      });

      expect(result.order).toBe(2);
      expect(result.activatedAt).toBeNull();
      expect(result.completedAt).toBeNull();
    });

    it("14. Rejeita datas com plannedEndDate anterior a plannedStartDate", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });

      await expect(
        addWorkoutPlanToPeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
          workoutPlanId: plan.id,
          plannedStartDate: "2026-10-20",
          plannedEndDate: "2026-10-10",
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("CreateWorkoutPlanInPeriodization", () => {
    it("15. Cria plano completo atomicamente dentro da periodização, sempre inativo", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);

      const result = await createWorkoutPlanInPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        name: "Plano Força Vôlei",
        workoutDays: [
          {
            name: "Treino A",
            weekDay: WeekDay.MONDAY,
            isRest: false,
            estimatedDurationInSeconds: 3600,
            exercises: [
              {
                order: 1,
                name: "Agachamento",
                sets: 4,
                reps: 6,
                restTimeInSeconds: 120,
              },
            ],
          },
        ],
        plannedStartDate: "2026-10-01",
        plannedEndDate: "2026-10-28",
        notes: "Criado diretamente na periodização",
      });

      expect(result.order).toBe(1);
      expect(result.workoutPlan.name).toBe("Plano Força Vôlei");
      expect(result.workoutPlan.isActive).toBe(false);
      expect(result.workoutPlan.workoutDays).toHaveLength(1);
      expect(result.workoutPlan.workoutDays[0].exercises).toHaveLength(1);

      // Confere persistência no banco
      const inDb = await prisma.workoutPlan.findUnique({
        where: { id: result.workoutPlanId },
      });
      expect(inDb).not.toBeNull();
      expect(inDb?.isActive).toBe(false);
    });

    it("16. Reverte tudo (rollback) se a periodização não pertencer ao usuário", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      testUserIds.push(userA.id, userB.id);

      const periodizationA = await createTestPeriodization(userA.id);

      await expect(
        createWorkoutPlanInPeriodization.execute({
          userId: userB.id,
          periodizationId: periodizationA.id,
          name: "Plano Inválido",
          workoutDays: [],
        }),
      ).rejects.toThrow(NotFoundError);

      // Nenhum plano deve ter sido criado
      const count = await prisma.workoutPlan.count({
        where: { userId: userB.id },
      });
      expect(count).toBe(0);
    });
  });

  describe("UpdatePeriodizationPlan", () => {
    it("17. Atualiza datas previstas e notas de bloco planejado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const pPlan = await createTestPeriodizationPlan(
        periodization.id,
        plan.id,
        {
          order: 1,
          plannedStartDate: new Date("2026-10-01T00:00:00Z"),
          plannedEndDate: new Date("2026-10-28T00:00:00Z"),
        },
      );

      const updated = await updatePeriodizationPlan.execute({
        userId: user.id,
        periodizationId: periodization.id,
        periodizationPlanId: pPlan.id,
        plannedEndDate: "2026-11-05",
        notes: "Prorrogado por 1 semana",
      });

      expect(updated.plannedEndDate).toBe("2026-11-05");
      expect(updated.notes).toBe("Prorrogado por 1 semana");
    });

    it("18. Bloqueia alteração de datas previstas em bloco já concluído (COMPLETED_BLOCK_IMMUTABLE)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(Date.now() - 86400000),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const completedBlock = await createTestPeriodizationPlan(
        periodization.id,
        plan.id,
        {
          order: 1,
          activatedAt: new Date(Date.now() - 86400000),
          completedAt: new Date(),
        },
      );

      await expect(
        updatePeriodizationPlan.execute({
          userId: user.id,
          periodizationId: periodization.id,
          periodizationPlanId: completedBlock.id,
          plannedEndDate: "2026-12-01",
        }),
      ).rejects.toThrow(CompletedBlockImmutableError);
    });
  });

  describe("RemoveWorkoutPlanFromPeriodization & Compaction", () => {
    it("19. Remove bloco planejado, preserva WorkoutPlan como standalone e compacta ordens", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan1 = await createTestWorkoutPlan(user.id, {
        name: "Base",
        isActive: false,
      });
      const plan2 = await createTestWorkoutPlan(user.id, {
        name: "Força",
        isActive: false,
      });
      const plan3 = await createTestWorkoutPlan(user.id, {
        name: "Potência",
        isActive: false,
      });

      await createTestPeriodizationPlan(periodization.id, plan1.id, { order: 1 });
      const pPlan2 = await createTestPeriodizationPlan(
        periodization.id,
        plan2.id,
        { order: 2 },
      );
      await createTestPeriodizationPlan(periodization.id, plan3.id, { order: 3 });

      // Remove bloco 2 (Força)
      const res = await removeWorkoutPlanFromPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        periodizationPlanId: pPlan2.id,
      });

      expect(res.success).toBe(true);

      // WorkoutPlan 'Força' continua existindo no banco!
      const plan2InDb = await prisma.workoutPlan.findUnique({
        where: { id: plan2.id },
      });
      expect(plan2InDb).not.toBeNull();
      expect(plan2InDb?.isActive).toBe(false);

      // Blocos remanescentes devem ser 1 (Base) e 2 (Potência compactado)
      const remainingPlans = await prisma.periodizationPlan.findMany({
        where: { periodizationId: periodization.id },
        orderBy: { order: "asc" },
      });

      expect(remainingPlans).toHaveLength(2);
      expect(remainingPlans[0].workoutPlanId).toBe(plan1.id);
      expect(remainingPlans[0].order).toBe(1);
      expect(remainingPlans[1].workoutPlanId).toBe(plan3.id);
      expect(remainingPlans[1].order).toBe(2); // Era 3, virou 2!
    });

    it("20. Bloqueia remoção de bloco ativo ou concluído", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(),
      });
      const plan1 = await createTestWorkoutPlan(user.id, { isActive: false });
      const plan2 = await createTestWorkoutPlan(user.id, { isActive: false });

      const activeBlock = await createTestPeriodizationPlan(
        periodization.id,
        plan1.id,
        {
          order: 1,
          activatedAt: new Date(),
          completedAt: null,
        },
      );

      const completedBlock = await createTestPeriodizationPlan(
        periodization.id,
        plan2.id,
        {
          order: 2,
          activatedAt: new Date(Date.now() - 10000),
          completedAt: new Date(),
        },
      );

      await expect(
        removeWorkoutPlanFromPeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
          periodizationPlanId: activeBlock.id,
        }),
      ).rejects.toThrow(ActiveBlockCannotBeRemovedError);

      await expect(
        removeWorkoutPlanFromPeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
          periodizationPlanId: completedBlock.id,
        }),
      ).rejects.toThrow(CompletedBlockCannotBeRemovedError);
    });

    it("20b. Remove bloco intermediário de lista maior (6 blocos) com compactação em duas fases sem colisão", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const planIds: string[] = [];
      const periodizationPlans = [];

      for (let i = 1; i <= 6; i++) {
        const p = await createTestWorkoutPlan(user.id, {
          name: `Bloco ${i}`,
          isActive: false,
        });
        planIds.push(p.id);
        const pp = await createTestPeriodizationPlan(periodization.id, p.id, {
          order: i,
        });
        periodizationPlans.push(pp);
      }

      // Remove o bloco 3 (ordem 3)
      const res = await removeWorkoutPlanFromPeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
        periodizationPlanId: periodizationPlans[2].id,
      });

      expect(res.success).toBe(true);

      const remaining = await prisma.periodizationPlan.findMany({
        where: { periodizationId: periodization.id },
        orderBy: { order: "asc" },
      });

      expect(remaining).toHaveLength(5);
      expect(remaining.map((p) => p.order)).toEqual([1, 2, 3, 4, 5]);
      expect(remaining[0].workoutPlanId).toBe(planIds[0]); // Bloco 1 (ordem 1)
      expect(remaining[1].workoutPlanId).toBe(planIds[1]); // Bloco 2 (ordem 2)
      expect(remaining[2].workoutPlanId).toBe(planIds[3]); // Bloco 4 (ordem 3)
      expect(remaining[3].workoutPlanId).toBe(planIds[4]); // Bloco 5 (ordem 4)
      expect(remaining[4].workoutPlanId).toBe(planIds[5]); // Bloco 6 (ordem 5)
    });
  });

  describe("ReorderPeriodizationPlans", () => {
    it("21. Reordena blocos planejados completamente em draft", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan1 = await createTestWorkoutPlan(user.id, { isActive: false });
      const plan2 = await createTestWorkoutPlan(user.id, { isActive: false });
      const plan3 = await createTestWorkoutPlan(user.id, { isActive: false });

      const pp1 = await createTestPeriodizationPlan(periodization.id, plan1.id, {
        order: 1,
      });
      const pp2 = await createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
      });
      const pp3 = await createTestPeriodizationPlan(periodization.id, plan3.id, {
        order: 3,
      });

      // Inverte a ordem: pp3 -> 1, pp1 -> 2, pp2 -> 3
      const reordered = await reorderPeriodizationPlans.execute({
        userId: user.id,
        periodizationId: periodization.id,
        periodizationPlanIds: [pp3.id, pp1.id, pp2.id],
      });

      expect(reordered[0].id).toBe(pp3.id);
      expect(reordered[0].order).toBe(1);
      expect(reordered[1].id).toBe(pp1.id);
      expect(reordered[1].order).toBe(2);
      expect(reordered[2].id).toBe(pp2.id);
      expect(reordered[2].order).toBe(3);
    });

    it("22. Em periodização em andamento, reordena apenas blocos futuros mantendo histórico e ativo fixos", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(Date.now() - 86400000),
      });

      const pCompleted = await createTestWorkoutPlan(user.id, { isActive: false });
      const pActive = await createTestWorkoutPlan(user.id, { isActive: false });
      const pFuture1 = await createTestWorkoutPlan(user.id, { isActive: false });
      const pFuture2 = await createTestWorkoutPlan(user.id, { isActive: false });

      const ppCompleted = await createTestPeriodizationPlan(
        periodization.id,
        pCompleted.id,
        {
          order: 1,
          activatedAt: new Date(Date.now() - 86400000),
          completedAt: new Date(Date.now() - 3600000),
        },
      );
      const ppActive = await createTestPeriodizationPlan(
        periodization.id,
        pActive.id,
        {
          order: 2,
          activatedAt: new Date(),
        },
      );
      const ppFuture1 = await createTestPeriodizationPlan(
        periodization.id,
        pFuture1.id,
        { order: 3 },
      );
      const ppFuture2 = await createTestPeriodizationPlan(
        periodization.id,
        pFuture2.id,
        { order: 4 },
      );

      // Reordena apenas ppFuture2 e ppFuture1
      const reordered = await reorderPeriodizationPlans.execute({
        userId: user.id,
        periodizationId: periodization.id,
        periodizationPlanIds: [ppFuture2.id, ppFuture1.id],
      });

      expect(reordered).toHaveLength(4);
      expect(reordered[0].id).toBe(ppCompleted.id);
      expect(reordered[0].order).toBe(1);
      expect(reordered[1].id).toBe(ppActive.id);
      expect(reordered[1].order).toBe(2);
      expect(reordered[2].id).toBe(ppFuture2.id);
      expect(reordered[2].order).toBe(3);
      expect(reordered[3].id).toBe(ppFuture1.id);
      expect(reordered[3].order).toBe(4);
    });

    it("23. Rejeita tentativa de reordenar blocos ativos ou históricos", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(),
      });
      const p1 = await createTestWorkoutPlan(user.id, { isActive: false });
      const p2 = await createTestWorkoutPlan(user.id, { isActive: false });

      const pp1 = await createTestPeriodizationPlan(periodization.id, p1.id, {
        order: 1,
        activatedAt: new Date(),
      });
      const pp2 = await createTestPeriodizationPlan(periodization.id, p2.id, {
        order: 2,
      });

      await expect(
        reorderPeriodizationPlans.execute({
          userId: user.id,
          periodizationId: periodization.id,
          periodizationPlanIds: [pp2.id, pp1.id], // pp1 é ativo!
        }),
      ).rejects.toThrow(InvalidReorderBlocksError);
    });
  });

  describe("DeletePeriodization", () => {
    it("24. Exclui rascunho de periodização nunca iniciado e preserva WorkoutPlans como standalone", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: null,
        completedAt: null,
      });
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Sobrevivente",
        isActive: false,
      });

      await createTestPeriodizationPlan(periodization.id, plan.id, { order: 1 });

      const res = await deletePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.success).toBe(true);

      // Periodização foi removida
      const pInDb = await prisma.periodization.findUnique({
        where: { id: periodization.id },
      });
      expect(pInDb).toBeNull();

      // WorkoutPlan permanece intacto no banco!
      const planInDb = await prisma.workoutPlan.findUnique({
        where: { id: plan.id },
      });
      expect(planInDb).not.toBeNull();
      expect(planInDb?.name).toBe("Plano Sobrevivente");
    });

    it("25. Bloqueia exclusão de periodização já iniciada (PERIODIZATION_ALREADY_STARTED)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(),
      });

      await expect(
        deletePeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(PeriodizationAlreadyStartedError);
    });
  });

  describe("HTTP Routes (app.inject)", () => {
    it("26. POST /periodizations e GET /periodizations/:id via HTTP", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: user.id },
        session: { id: "test-session" },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      // POST /periodizations
      const postRes = await app.inject({
        method: "POST",
        url: "/periodizations",
        payload: {
          name: "Periodização HTTP",
          goal: "Meta de teste",
        },
      });

      expect(postRes.statusCode).toBe(201);
      const postBody = postRes.json();
      expect(postBody.id).toBeDefined();
      expect(postBody.name).toBe("Periodização HTTP");
      expect(postBody.status).toBe("DRAFT");

      // GET /periodizations/:id
      const getRes = await app.inject({
        method: "GET",
        url: `/periodizations/${postBody.id}`,
      });

      expect(getRes.statusCode).toBe(200);
      const getBody = getRes.json();
      expect(getBody.id).toBe(postBody.id);
      expect(getBody.plans).toEqual([]);
    });

    it("27. POST /periodizations/:id/plans/create cria plano e associa via HTTP", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: user.id },
        session: { id: "test-session" },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      const res = await app.inject({
        method: "POST",
        url: `/periodizations/${periodization.id}/plans/create`,
        payload: {
          name: "Plano Criado via HTTP",
          workoutDays: [
            {
              name: "Dia 1",
              weekDay: WeekDay.MONDAY,
              isRest: false,
              estimatedDurationInSeconds: 3600,
              exercises: [
                {
                  order: 1,
                  name: "Supino",
                  sets: 3,
                  reps: 10,
                  restTimeInSeconds: 90,
                },
              ],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.order).toBe(1);
      expect(body.workoutPlan.name).toBe("Plano Criado via HTTP");
      expect(body.workoutPlan.isActive).toBe(false);
    });
  });
});
