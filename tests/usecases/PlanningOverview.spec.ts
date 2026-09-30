import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { InconsistentPlanningStateError } from "../../src/errors/index.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { planningRoutes } from "../../src/routes/planning.js";
import { PlanningOverviewResponseSchema } from "../../src/schemas/index.js";
import { GetPlanningOverview } from "../../src/usecases/GetPlanningOverview.js";
import {
  cleanupTestUsers,
  createTestPeriodization,
  createTestPeriodizationPlan,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("Planning Overview API (Task 2.4 & 2.4B Hardening)", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  const getPlanningOverview = new GetPlanningOverview();

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(planningRoutes, { prefix: "/planning" });
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

  describe("Active Context Scenarios & Synchronization Hardening", () => {
    it("1. Nenhum contexto ativo: retorna type NONE quando não há plano nem periodização ativos", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      // Usuário com plano inativo e periodização rascunho
      await createTestWorkoutPlan(user.id, {
        name: "Plano Inativo",
        isActive: false,
      });
      await createTestPeriodization(user.id, {
        name: "Periodização Rascunho",
        isActive: false,
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      expect(overview.activeContext).toEqual({ type: "NONE" });
      expect(overview.plans).toHaveLength(1);
      expect(overview.plans[0].name).toBe("Plano Inativo");
      expect(overview.periodizations).toHaveLength(1);
      expect(overview.periodizations[0].name).toBe("Periodização Rascunho");
    });

    it("2. Plano realmente standalone ativo: retorna type STANDALONE_PLAN com contagem de workoutDaysCount", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const activePlan = await createTestWorkoutPlan(user.id, {
        name: "Upper/Lower",
        isActive: true,
      });

      // Cria 4 workout days para o plano ativo
      await createTestWorkoutDay(activePlan.id, { name: "Upper 1" });
      await createTestWorkoutDay(activePlan.id, { name: "Lower 1" });
      await createTestWorkoutDay(activePlan.id, { name: "Upper 2" });
      await createTestWorkoutDay(activePlan.id, { name: "Lower 2" });

      // Outro plano inativo
      await createTestWorkoutPlan(user.id, {
        name: "Full Body Antigo",
        isActive: false,
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      expect(overview.activeContext.type).toBe("STANDALONE_PLAN");
      if (overview.activeContext.type === "STANDALONE_PLAN") {
        expect(overview.activeContext.plan.id).toBe(activePlan.id);
        expect(overview.activeContext.plan.name).toBe("Upper/Lower");
        expect(overview.activeContext.plan.workoutDaysCount).toBe(4);
        expect(overview.activeContext.plan.createdAt).toBeDefined();
      }
    });

    it("3. Periodização ativa + plano ativo correto → OK", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Pré-Temporada",
        goal: "Potência e Força",
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      // Bloco 1: Concluído
      const plan1 = await createTestWorkoutPlan(user.id, { name: "Base", isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan1.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: new Date("2026-09-30T23:59:59.000Z"),
        plannedStartDate: new Date("2026-09-01"),
        plannedEndDate: new Date("2026-09-30"),
      });

      // Bloco 2: Ativo em andamento
      const plan2 = await createTestWorkoutPlan(user.id, { name: "Força", isActive: true });
      const block2 = await createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
        activatedAt: new Date("2026-10-01T00:00:00.000Z"),
        completedAt: null,
        plannedStartDate: new Date("2026-10-01"),
        plannedEndDate: new Date("2026-10-28"),
      });

      // Bloco 3: Planejado
      const plan3 = await createTestWorkoutPlan(user.id, { name: "Potência", isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan3.id, {
        order: 3,
        activatedAt: null,
        completedAt: null,
        plannedStartDate: new Date("2026-10-29"),
        plannedEndDate: new Date("2026-11-25"),
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      expect(overview.activeContext.type).toBe("PERIODIZATION");
      if (overview.activeContext.type === "PERIODIZATION") {
        const p = overview.activeContext.periodization;
        expect(p.id).toBe(periodization.id);
        expect(p.name).toBe("Pré-Temporada");
        expect(p.goal).toBe("Potência e Força");
        expect(p.totalBlocks).toBe(3);
        expect(p.completedBlocks).toBe(1);
        expect(p.currentBlock.id).toBe(block2.id);
        expect(p.currentBlock.order).toBe(2);
        expect(p.currentBlock.workoutPlanId).toBe(plan2.id);
        expect(p.currentBlock.workoutPlanName).toBe("Força");
        expect(p.currentBlock.plannedStartDate).toBe("2026-10-01");
        expect(p.currentBlock.plannedEndDate).toBe("2026-10-28");
      }
    });

    it("4. Hardening: periodização ativa sem bloco aberto → INCONSISTENT_PLANNING_STATE", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      // Periodização com isActive=true mas sem nenhum bloco aberto
      await createTestPeriodization(user.id, {
        name: "Periodização Sem Bloco Aberto",
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      await expect(
        getPlanningOverview.execute({ userId: user.id }),
      ).rejects.toThrow(InconsistentPlanningStateError);

      try {
        await getPlanningOverview.execute({ userId: user.id });
      } catch (err: any) {
        expect(err.code).toBe("INCONSISTENT_PLANNING_STATE");
      }
    });

    it("5. Hardening: periodização ativa + nenhum WorkoutPlan ativo → INCONSISTENT_PLANNING_STATE", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Ativa Mas Plano Inativo",
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      // Bloco aberto cadastrado, mas WorkoutPlan está com isActive = false (desalinhado!)
      const plan = await createTestWorkoutPlan(user.id, { name: "Plano Desalinhado", isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: null,
      });

      await expect(
        getPlanningOverview.execute({ userId: user.id }),
      ).rejects.toThrow(InconsistentPlanningStateError);
    });

    it("6. Hardening: periodização ativa + WorkoutPlan ativo diferente do bloco → INCONSISTENT_PLANNING_STATE", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Ativa",
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      // Bloco aberto aponta para planA, mas planA está inativo
      const planA = await createTestWorkoutPlan(user.id, { name: "Plano do Bloco", isActive: false });
      await createTestPeriodizationPlan(periodization.id, planA.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: null,
      });

      // Usuário tem planB ativo (outro plano standalone)
      await createTestWorkoutPlan(user.id, { name: "Plano Standalone Concorrente", isActive: true });

      await expect(
        getPlanningOverview.execute({ userId: user.id }),
      ).rejects.toThrow(InconsistentPlanningStateError);
    });

    it("7. Hardening: periodização pausada + plano de bloco ativo → INCONSISTENT_PLANNING_STATE", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      // Periodização pausada (isActive: false)
      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Pausada",
        isActive: false,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      // Plano associado à periodização pausada está incorretamente com isActive = true
      const plan = await createTestWorkoutPlan(user.id, { name: "Plano Associado Incorretamente Ativo", isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: null,
      });

      // Não há periodização ativa, mas o plano ativo pertence a periodização
      await expect(
        getPlanningOverview.execute({ userId: user.id }),
      ).rejects.toThrow(InconsistentPlanningStateError);
    });
  });

  describe("Periodizations List and Paused State", () => {
    it("8. Periodização pausada correta: status PAUSED preserva currentBlock identificado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Temporada Vôlei Pausada",
        isActive: false, // Pausada
        startedAt: new Date("2026-08-01T00:00:00.000Z"),
        completedAt: null,
      });

      const plan1 = await createTestWorkoutPlan(user.id, { name: "Base", isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan1.id, {
        order: 1,
        activatedAt: new Date("2026-08-01T00:00:00.000Z"),
        completedAt: new Date("2026-08-31T00:00:00.000Z"),
      });

      const plan2 = await createTestWorkoutPlan(user.id, {
        name: "Força",
        isActive: false, // Inativo porque a periodização está pausada (estado correto)
      });
      const block2 = await createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: null, // Bloco aberto congelado na pausa
        plannedStartDate: new Date("2026-09-01"),
        plannedEndDate: new Date("2026-09-30"),
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      expect(overview.activeContext.type).toBe("NONE");
      expect(overview.periodizations).toHaveLength(1);

      const summary = overview.periodizations[0];
      expect(summary.status).toBe("PAUSED");
      expect(summary.isActive).toBe(false);
      expect(summary.totalBlocks).toBe(2);
      expect(summary.completedBlocks).toBe(1);
      expect(summary.currentBlock).not.toBeNull();
      expect(summary.currentBlock?.id).toBe(block2.id);
      expect(summary.currentBlock?.order).toBe(2);
      expect(summary.currentBlock?.workoutPlanName).toBe("Força");
      expect(summary.currentBlock?.plannedStartDate).toBe("2026-09-01");
      expect(summary.currentBlock?.plannedEndDate).toBe("2026-09-30");
    });

    it("9. Periodização concluída manualmente: blocos futuros não iniciados não contam como completed", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Encerrada Cedo",
        isActive: false,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-03-01T00:00:00.000Z"),
      });

      // 4 blocos totais: 2 executados, 2 nunca iniciados
      const p1 = await createTestWorkoutPlan(user.id, { name: "Base", isActive: false });
      await createTestPeriodizationPlan(periodization.id, p1.id, {
        order: 1,
        activatedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-31T00:00:00.000Z"),
      });

      const p2 = await createTestWorkoutPlan(user.id, { name: "Força", isActive: false });
      await createTestPeriodizationPlan(periodization.id, p2.id, {
        order: 2,
        activatedAt: new Date("2026-02-01T00:00:00.000Z"),
        completedAt: new Date("2026-03-01T00:00:00.000Z"),
      });

      const p3 = await createTestWorkoutPlan(user.id, { name: "Potência (Ignorado)", isActive: false });
      await createTestPeriodizationPlan(periodization.id, p3.id, {
        order: 3,
        activatedAt: null,
        completedAt: null,
      });

      const p4 = await createTestWorkoutPlan(user.id, { name: "Pico (Ignorado)", isActive: false });
      await createTestPeriodizationPlan(periodization.id, p4.id, {
        order: 4,
        activatedAt: null,
        completedAt: null,
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      const summary = overview.periodizations[0];
      expect(summary.status).toBe("COMPLETED");
      expect(summary.totalBlocks).toBe(4);
      expect(summary.completedBlocks).toBe(2);
      expect(summary.currentBlock).toBeNull();
    });
  });

  describe("WorkoutPlans List and Periodization Metadata", () => {
    it("10. WorkoutPlans: plano associado retorna contexto e status derivados; standalone retorna periodization=null", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Macro 2026",
        isActive: false,
      });

      // Plano associado em status PLANNED
      const planPlanned = await createTestWorkoutPlan(user.id, { name: "Fase 1 Planned", isActive: false });
      const blockPlanned = await createTestPeriodizationPlan(periodization.id, planPlanned.id, {
        order: 1,
        activatedAt: null,
        completedAt: null,
      });

      // Plano associado em status ACTIVE (na periodização)
      const planActive = await createTestWorkoutPlan(user.id, { name: "Fase 2 Active", isActive: false });
      const blockActive = await createTestPeriodizationPlan(periodization.id, planActive.id, {
        order: 2,
        activatedAt: new Date("2026-09-10T00:00:00.000Z"),
        completedAt: null,
      });

      // Plano associado em status COMPLETED
      const planCompleted = await createTestWorkoutPlan(user.id, { name: "Fase 0 Completed", isActive: false });
      const blockCompleted = await createTestPeriodizationPlan(periodization.id, planCompleted.id, {
        order: 3,
        activatedAt: new Date("2026-08-01T00:00:00.000Z"),
        completedAt: new Date("2026-08-31T00:00:00.000Z"),
      });

      // Plano Standalone puro
      const standalonePlan = await createTestWorkoutPlan(user.id, { name: "Meu Treino Avulso", isActive: false });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      const map = new Map(overview.plans.map((p) => [p.name, p]));

      // Standalone puro
      const standaloneResult = map.get("Meu Treino Avulso")!;
      expect(standaloneResult.periodization).toBeNull();

      // Planned
      const plannedResult = map.get("Fase 1 Planned")!;
      expect(plannedResult.periodization).toEqual({
        id: periodization.id,
        name: "Macro 2026",
        periodizationPlanId: blockPlanned.id,
        order: 1,
        status: "PLANNED",
      });

      // Active
      const activeResult = map.get("Fase 2 Active")!;
      expect(activeResult.periodization).toEqual({
        id: periodization.id,
        name: "Macro 2026",
        periodizationPlanId: blockActive.id,
        order: 2,
        status: "ACTIVE",
      });

      // Completed
      const completedResult = map.get("Fase 0 Completed")!;
      expect(completedResult.periodization).toEqual({
        id: periodization.id,
        name: "Macro 2026",
        periodizationPlanId: blockCompleted.id,
        order: 3,
        status: "COMPLETED",
      });
    });
  });

  describe("Deterministic Ordering", () => {
    it("11. Ordenação de planos: ativo sempre primeiro, depois por createdAt decrescente", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const oldInactive = await prisma.workoutPlan.create({
        data: {
          name: "Plano Antigo Inativo",
          userId: user.id,
          isActive: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const recentInactive = await prisma.workoutPlan.create({
        data: {
          name: "Plano Recente Inativo",
          userId: user.id,
          isActive: false,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      });

      const midActive = await prisma.workoutPlan.create({
        data: {
          name: "Plano Ativo Meio",
          userId: user.id,
          isActive: true,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      const planIds = overview.plans.map((p) => p.id);
      expect(planIds).toEqual([midActive.id, recentInactive.id, oldInactive.id]);
    });

    it("12. Ordenação de periodizações: ACTIVE > PAUSED > DRAFT > COMPLETED, depois createdAt DESC", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      // Criar bloco ativo para permitir ACTIVE passar no guard
      const pActivePlan = await createTestWorkoutPlan(user.id, { name: "Active Block WP", isActive: true });

      const pDraft = await prisma.periodization.create({
        data: {
          name: "Periodização Draft",
          userId: user.id,
          isActive: false,
          startedAt: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      });

      const pCompleted = await prisma.periodization.create({
        data: {
          name: "Periodização Completed",
          userId: user.id,
          isActive: false,
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          completedAt: new Date("2026-02-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      const pPaused = await prisma.periodization.create({
        data: {
          name: "Periodização Paused",
          userId: user.id,
          isActive: false,
          startedAt: new Date("2026-03-01T00:00:00.000Z"),
          completedAt: null,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      });

      const pActive = await prisma.periodization.create({
        data: {
          name: "Periodização Active",
          userId: user.id,
          isActive: true,
          startedAt: new Date("2026-04-01T00:00:00.000Z"),
          completedAt: null,
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      });
      await createTestPeriodizationPlan(pActive.id, pActivePlan.id, {
        order: 1,
        activatedAt: new Date("2026-04-01T00:00:00.000Z"),
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      const periodizationNames = overview.periodizations.map((p) => p.name);
      expect(periodizationNames).toEqual([
        "Periodização Active",
        "Periodização Paused",
        "Periodização Draft",
        "Periodização Completed",
      ]);
    });
  });

  describe("Date Handling without Server Timezone Dependency", () => {
    it("13. Datas planejadas retornam estritamente como string YYYY-MM-DD", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Prazos",
        isActive: true,
        startedAt: new Date("2026-10-01T00:00:00.000Z"),
      });

      const plan = await createTestWorkoutPlan(user.id, { name: "Bloco Prazos", isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-10-01T00:00:00.000Z"),
        plannedStartDate: new Date("2026-10-01"),
        plannedEndDate: new Date("2026-10-28"),
      });

      const overview = await getPlanningOverview.execute({ userId: user.id });

      if (overview.activeContext.type === "PERIODIZATION") {
        const block = overview.activeContext.periodization.currentBlock;
        expect(block.plannedStartDate).toBe("2026-10-01");
        expect(block.plannedEndDate).toBe("2026-10-28");
        // Verifica que são strings YYYY-MM-DD puras (sem timestamp)
        expect(block.plannedStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(block.plannedEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe("User Isolation and Read-Only Guarantee", () => {
    it("14. Isolamento completo entre usuários: dados do Usuário B nunca aparecem para o Usuário A", async () => {
      const userA = await createTestUser({ name: "User A" });
      const userB = await createTestUser({ name: "User B" });
      testUserIds.push(userA.id, userB.id);

      // Usuário A: 1 plano, 0 periodizações
      await createTestWorkoutPlan(userA.id, { name: "Plano do Usuário A", isActive: true });

      // Usuário B: 2 planos, 1 periodização
      const bPlan = await createTestWorkoutPlan(userB.id, { name: "Plano do Usuário B", isActive: true });
      const bPer = await createTestPeriodization(userB.id, { name: "Periodização do Usuário B", isActive: true, startedAt: new Date() });
      await createTestPeriodizationPlan(bPer.id, bPlan.id, { order: 1, activatedAt: new Date() });

      const overviewA = await getPlanningOverview.execute({ userId: userA.id });
      const overviewB = await getPlanningOverview.execute({ userId: userB.id });

      expect(overviewA.plans).toHaveLength(1);
      expect(overviewA.plans[0].name).toBe("Plano do Usuário A");
      expect(overviewA.periodizations).toHaveLength(0);

      expect(overviewB.plans).toHaveLength(1);
      expect(overviewB.plans[0].name).toBe("Plano do Usuário B");
      expect(overviewB.periodizations).toHaveLength(1);
      expect(overviewB.periodizations[0].name).toBe("Periodização do Usuário B");
    });

    it("15. Garantia de Read-Only: a chamada de overview não altera nenhum registro no banco", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, { name: "Plano Imutável", isActive: true });
      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Imutável",
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
      });

      const initialPlan = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
      const initialPer = await prisma.periodization.findUniqueOrThrow({ where: { id: periodization.id } });

      await getPlanningOverview.execute({ userId: user.id });

      const afterPlan = await prisma.workoutPlan.findUniqueOrThrow({ where: { id: plan.id } });
      const afterPer = await prisma.periodization.findUniqueOrThrow({ where: { id: periodization.id } });

      expect(afterPlan.updatedAt.getTime()).toBe(initialPlan.updatedAt.getTime());
      expect(afterPer.updatedAt.getTime()).toBe(initialPer.updatedAt.getTime());
      expect(afterPlan.isActive).toBe(initialPlan.isActive);
      expect(afterPer.isActive).toBe(initialPer.isActive);
    });
  });

  describe("HTTP Integration: GET /planning/overview", () => {
    it("16. Retorna 401 para requisições não autenticadas", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/planning/overview",
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it("17. Retorna 200 com contrato Zod válido para usuário autenticado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      await createTestWorkoutPlan(user.id, { name: "Plano HTTP", isActive: true });

      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        session: {
          id: "session-test",
          userId: user.id,
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date(),
          updatedAt: new Date(),
          token: "token",
        },
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as any);

      const response = await app.inject({
        method: "GET",
        url: "/planning/overview",
        headers: {
          cookie: "better-auth.session_token=valid-token",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Validação explícita com o schema Zod oficial
      const parsed = PlanningOverviewResponseSchema.safeParse(body);
      expect(parsed.success).toBe(true);

      expect(body.activeContext.type).toBe("STANDALONE_PLAN");
      expect(body.plans).toHaveLength(1);
      expect(body.plans[0].name).toBe("Plano HTTP");
    });

    it("18. Retorna 409 com INCONSISTENT_PLANNING_STATE em caso de descompasso de estado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      // Cria periodização ativa sem WorkoutPlan ativo (descompasso)
      const periodization = await createTestPeriodization(user.id, {
        name: "Periodização Inconsistente HTTP",
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
      });
      const plan = await createTestWorkoutPlan(user.id, { name: "Plano Inativo", isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00.000Z"),
        completedAt: null,
      });

      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        session: {
          id: "session-test-inconsistent",
          userId: user.id,
          expiresAt: new Date(Date.now() + 60000),
          createdAt: new Date(),
          updatedAt: new Date(),
          token: "token",
        },
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as any);

      const response = await app.inject({
        method: "GET",
        url: "/planning/overview",
        headers: {
          cookie: "better-auth.session_token=valid-token",
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("INCONSISTENT_PLANNING_STATE");
    });
  });
});
