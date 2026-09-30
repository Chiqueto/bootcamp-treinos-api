import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ActiveWorkoutSessionError,
  NoOpenBlockError,
  NotFoundError,
  PeriodizationCompletedError,
  PeriodizationHasNoPlansError,
  PeriodizationNotActiveError,
  PeriodizationNotStartedError,
} from "../../src/errors/index.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { periodizationRoutes } from "../../src/routes/periodization.js";
import { ActivatePeriodization } from "../../src/usecases/ActivatePeriodization.js";
import { AdvancePeriodizationPlan } from "../../src/usecases/AdvancePeriodizationPlan.js";
import { CompletePeriodization } from "../../src/usecases/CompletePeriodization.js";
import { DeactivatePeriodization } from "../../src/usecases/DeactivatePeriodization.js";
import {
  cleanupTestUsers,
  createTestPeriodization,
  createTestPeriodizationPlan,
  createTestUser,
  createTestWorkoutPlan,
  createTestWorkoutSession,
} from "../helpers/test-db.js";

describe("Periodization Lifecycle Operations (Task 2.3B)", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];

  const activatePeriodization = new ActivatePeriodization();
  const deactivatePeriodization = new DeactivatePeriodization();
  const advancePeriodizationPlan = new AdvancePeriodizationPlan();
  const completePeriodization = new CompletePeriodization();

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

  describe("ActivatePeriodization", () => {
    it("1. Ativa draft: preenche startedAt, ativa primeiro bloco e seu WorkoutPlan", async () => {
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

      await createTestPeriodizationPlan(periodization.id, plan1.id, { order: 1 });
      await createTestPeriodizationPlan(periodization.id, plan2.id, { order: 2 });

      const res = await activatePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("ACTIVE");
      expect(res.startedAt).not.toBeNull();
      expect(res.completedAt).toBeNull();
      expect(res.currentBlock).not.toBeNull();
      expect(res.currentBlock?.order).toBe(1);
      expect(res.currentBlock?.workoutPlanId).toBe(plan1.id);
      expect(res.currentBlock?.workoutPlanName).toBe("Base");

      // Confere no banco
      const p1InDb = await prisma.workoutPlan.findUnique({
        where: { id: plan1.id },
      });
      expect(p1InDb?.isActive).toBe(true);

      const p2InDb = await prisma.workoutPlan.findUnique({
        where: { id: plan2.id },
      });
      expect(p2InDb?.isActive).toBe(false);
    });

    it("2. Bloqueia ativação de periodização vazia (PERIODIZATION_HAS_NO_PLANS)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const emptyPeriodization = await createTestPeriodization(user.id);

      await expect(
        activatePeriodization.execute({
          userId: user.id,
          periodizationId: emptyPeriodization.id,
        }),
      ).rejects.toThrow(PeriodizationHasNoPlansError);
    });

    it("3. Bloqueia ativação de periodização concluída (PERIODIZATION_COMPLETED)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      const completedPeriodization = await createTestPeriodization(user.id, {
        startedAt: new Date(Date.now() - 86400000),
        completedAt: new Date(),
      });
      await createTestPeriodizationPlan(completedPeriodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(Date.now() - 86400000),
        completedAt: new Date(),
      });

      await expect(
        activatePeriodization.execute({
          userId: user.id,
          periodizationId: completedPeriodization.id,
        }),
      ).rejects.toThrow(PeriodizationCompletedError);
    });

    it("4. Valida ownership estrito (404 para periodização de outro usuário)", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      testUserIds.push(userA.id, userB.id);

      const pA = await createTestPeriodization(userA.id);

      await expect(
        activatePeriodization.execute({
          userId: userB.id,
          periodizationId: pA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("5. Desativa standalone anterior ao ativar a periodização", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const standalone = await createTestWorkoutPlan(user.id, {
        name: "Standalone Ativo",
        isActive: true,
      });

      const periodization = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Bloco Periodização",
        isActive: false,
      });
      await createTestPeriodizationPlan(periodization.id, plan.id, { order: 1 });

      await activatePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      const standaloneInDb = await prisma.workoutPlan.findUnique({
        where: { id: standalone.id },
      });
      expect(standaloneInDb?.isActive).toBe(false);

      const planInDb = await prisma.workoutPlan.findUnique({
        where: { id: plan.id },
      });
      expect(planInDb?.isActive).toBe(true);
    });

    it("6. Pausa atomicamente outra periodização ativa ao ativar uma nova, preservando timestamps", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      // Periodização A ativa
      const originalStartedAtA = new Date("2026-09-01T10:00:00Z");
      const originalActivatedAtA = new Date("2026-09-01T10:00:00Z");
      const periodizationA = await createTestPeriodization(user.id, {
        name: "Periodização A",
        isActive: true,
        startedAt: originalStartedAtA,
      });
      const planA = await createTestWorkoutPlan(user.id, {
        name: "Plano A",
        isActive: true,
      });
      const ppA = await createTestPeriodizationPlan(periodizationA.id, planA.id, {
        order: 1,
        activatedAt: originalActivatedAtA,
      });

      // Periodização B inativa
      const periodizationB = await createTestPeriodization(user.id, {
        name: "Periodização B",
        isActive: false,
      });
      const planB = await createTestWorkoutPlan(user.id, {
        name: "Plano B",
        isActive: false,
      });
      await createTestPeriodizationPlan(periodizationB.id, planB.id, { order: 1 });

      // Ativa Periodização B
      const resB = await activatePeriodization.execute({
        userId: user.id,
        periodizationId: periodizationB.id,
      });

      expect(resB.status).toBe("ACTIVE");

      // Periodização A foi pausada (não concluída!)
      const dbA = await prisma.periodization.findUniqueOrThrow({
        where: { id: periodizationA.id },
      });
      expect(dbA.isActive).toBe(false);
      expect(dbA.completedAt).toBeNull();
      expect(dbA.startedAt?.toISOString()).toBe(originalStartedAtA.toISOString());

      // Plano de A desativado
      const dbPlanA = await prisma.workoutPlan.findUniqueOrThrow({
        where: { id: planA.id },
      });
      expect(dbPlanA.isActive).toBe(false);

      // Bloco de A permanece aberto e com timestamp original
      const dbPpA = await prisma.periodizationPlan.findUniqueOrThrow({
        where: { id: ppA.id },
      });
      expect(dbPpA.completedAt).toBeNull();
      expect(dbPpA.activatedAt?.toISOString()).toBe(
        originalActivatedAtA.toISOString(),
      );

      // Plano de B ativo
      const dbPlanB = await prisma.workoutPlan.findUniqueOrThrow({
        where: { id: planB.id },
      });
      expect(dbPlanB.isActive).toBe(true);
    });

    it("7. Retoma periodização pausada preservando startedAt e activatedAt do bloco", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const fixedStartedAt = new Date("2026-08-01T12:00:00Z");
      const fixedActivatedAt = new Date("2026-08-15T12:00:00Z");

      const pausedPeriodization = await createTestPeriodization(user.id, {
        isActive: false,
        startedAt: fixedStartedAt,
      });
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Força Bloco 2",
        isActive: false,
      });
      await createTestPeriodizationPlan(pausedPeriodization.id, plan.id, {
        order: 1,
        activatedAt: fixedActivatedAt,
        completedAt: null,
      });

      const res = await activatePeriodization.execute({
        userId: user.id,
        periodizationId: pausedPeriodization.id,
      });

      expect(res.status).toBe("ACTIVE");
      expect(res.startedAt).toBe(fixedStartedAt.toISOString());
      expect(res.currentBlock?.activatedAt).toBe(fixedActivatedAt.toISOString());
      expect(res.currentBlock?.workoutPlanName).toBe("Força Bloco 2");

      const planInDb = await prisma.workoutPlan.findUnique({
        where: { id: plan.id },
      });
      expect(planInDb?.isActive).toBe(true);
    });

    it("8. Idempotência ao ativar periodização que já está ativa", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const plan = await createTestWorkoutPlan(user.id, {
        isActive: true,
      });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00Z"),
      });

      const res = await activatePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("ACTIVE");
      expect(res.startedAt).toBe("2026-09-01T00:00:00.000Z");
    });

    it("9. Bloqueia ativação com sessão de treino aberta (ACTIVE_WORKOUT_SESSION)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan.id, { order: 1 });

      // Cria sessão aberta
      await createTestWorkoutSession(null, { athleteId: user.id });

      await expect(
        activatePeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(ActiveWorkoutSessionError);
    });
  });

  describe("DeactivatePeriodization", () => {
    it("10. Pausa periodização ativa e desativa WorkoutPlan do bloco aberto", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const startedAt = new Date("2026-09-10T08:00:00Z");
      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt,
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: startedAt,
      });

      const res = await deactivatePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("PAUSED");
      expect(res.completedAt).toBeNull();
      expect(res.currentBlock).not.toBeNull(); // Bloco continua aberto para retorno
      expect(res.currentBlock?.order).toBe(1);

      const planInDb = await prisma.workoutPlan.findUnique({
        where: { id: plan.id },
      });
      expect(planInDb?.isActive).toBe(false);
    });

    it("11. Idempotência ao pausar periodização já pausada", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: false,
        startedAt: new Date("2026-09-10T08:00:00Z"),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-10T08:00:00Z"),
      });

      const res = await deactivatePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("PAUSED");
    });

    it("12. Bloqueia pausa de periodização em DRAFT (PERIODIZATION_NOT_STARTED)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const draft = await createTestPeriodization(user.id, {
        startedAt: null,
      });

      await expect(
        deactivatePeriodization.execute({
          userId: user.id,
          periodizationId: draft.id,
        }),
      ).rejects.toThrow(PeriodizationNotStartedError);
    });

    it("13. Bloqueia pausa com sessão de treino aberta", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
      });

      await createTestWorkoutSession(null, { athleteId: user.id });

      await expect(
        deactivatePeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(ActiveWorkoutSessionError);
    });
  });

  describe("AdvancePeriodizationPlan", () => {
    it("14. Avança de bloco: conclui bloco atual e ativa o próximo bloco", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const plan1 = await createTestWorkoutPlan(user.id, {
        name: "Base",
        isActive: true,
      });
      const plan2 = await createTestWorkoutPlan(user.id, {
        name: "Força",
        isActive: false,
      });

      const pp1 = await createTestPeriodizationPlan(periodization.id, plan1.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const pp2 = await createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
      });

      const res = await advancePeriodizationPlan.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("ACTIVE");
      expect(res.currentBlock?.order).toBe(2);
      expect(res.currentBlock?.workoutPlanName).toBe("Força");

      // Bloco 1 concluído e plano 1 inativo
      const pp1InDb = await prisma.periodizationPlan.findUnique({
        where: { id: pp1.id },
      });
      expect(pp1InDb?.completedAt).not.toBeNull();
      const p1InDb = await prisma.workoutPlan.findUnique({
        where: { id: plan1.id },
      });
      expect(p1InDb?.isActive).toBe(false);

      // Bloco 2 ativado e plano 2 ativo
      const pp2InDb = await prisma.periodizationPlan.findUnique({
        where: { id: pp2.id },
      });
      expect(pp2InDb?.activatedAt).not.toBeNull();
      expect(pp2InDb?.completedAt).toBeNull();
      const p2InDb = await prisma.workoutPlan.findUnique({
        where: { id: plan2.id },
      });
      expect(p2InDb?.isActive).toBe(true);
    });

    it("15. Avanço no último bloco encerra e conclui a periodização", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const plan = await createTestWorkoutPlan(user.id, {
        name: "Último Bloco",
        isActive: true,
      });

      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00Z"),
      });

      const res = await advancePeriodizationPlan.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("COMPLETED");
      expect(res.completedAt).not.toBeNull();
      expect(res.currentBlock).toBeNull();

      // Confere banco
      const pInDb = await prisma.periodization.findUnique({
        where: { id: periodization.id },
      });
      expect(pInDb?.isActive).toBe(false);
      expect(pInDb?.completedAt).not.toBeNull();

      const planInDb = await prisma.workoutPlan.findUnique({
        where: { id: plan.id },
      });
      expect(planInDb?.isActive).toBe(false);
    });

    it("16. Bloqueia advance se a periodização estiver inativa (PERIODIZATION_NOT_ACTIVE)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: false,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
      });

      await expect(
        advancePeriodizationPlan.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(PeriodizationNotActiveError);
    });

    it("17. Bloqueia advance se não houver bloco aberto (NO_OPEN_BLOCK)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      // Bloco sem activatedAt
      await createTestPeriodizationPlan(periodization.id, plan.id, { order: 1 });

      await expect(
        advancePeriodizationPlan.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(NoOpenBlockError);
    });

    it("18. Bloqueia advance com sessão de treino aberta", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
      });

      await createTestWorkoutSession(null, { athleteId: user.id });

      await expect(
        advancePeriodizationPlan.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(ActiveWorkoutSessionError);
    });
  });

  describe("CompletePeriodization", () => {
    it("19. Encerramento manual: conclui bloco aberto e preserva blocos futuros planejados", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const plan1 = await createTestWorkoutPlan(user.id, { isActive: true });
      const plan2 = await createTestWorkoutPlan(user.id, { isActive: false });

      const pp1 = await createTestPeriodizationPlan(periodization.id, plan1.id, {
        order: 1,
        activatedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const pp2 = await createTestPeriodizationPlan(periodization.id, plan2.id, {
        order: 2,
      });

      const res = await completePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("COMPLETED");
      expect(res.completedAt).not.toBeNull();
      expect(res.currentBlock).toBeNull();

      // Bloco 1 concluído
      const pp1InDb = await prisma.periodizationPlan.findUnique({
        where: { id: pp1.id },
      });
      expect(pp1InDb?.completedAt).not.toBeNull();

      // Bloco 2 futuro não executado preservado como rascunho
      const pp2InDb = await prisma.periodizationPlan.findUnique({
        where: { id: pp2.id },
      });
      expect(pp2InDb?.activatedAt).toBeNull();
      expect(pp2InDb?.completedAt).toBeNull();
    });

    it("20. Bloqueia complete em periodização DRAFT (PERIODIZATION_NOT_STARTED)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const draft = await createTestPeriodization(user.id, {
        startedAt: null,
      });

      await expect(
        completePeriodization.execute({
          userId: user.id,
          periodizationId: draft.id,
        }),
      ).rejects.toThrow(PeriodizationNotStartedError);
    });

    it("21. Idempotência ao chamar complete em periodização já concluída", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const fixedCompletedAt = new Date("2026-09-20T10:00:00Z");
      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date("2026-09-01T10:00:00Z"),
        completedAt: fixedCompletedAt,
      });

      const res = await completePeriodization.execute({
        userId: user.id,
        periodizationId: periodization.id,
      });

      expect(res.status).toBe("COMPLETED");
      expect(res.completedAt).toBe(fixedCompletedAt.toISOString());
    });

    it("22. Bloqueia complete com sessão de treino aberta", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        startedAt: new Date(),
      });
      await createTestWorkoutSession(null, { athleteId: user.id });

      await expect(
        completePeriodization.execute({
          userId: user.id,
          periodizationId: periodization.id,
        }),
      ).rejects.toThrow(ActiveWorkoutSessionError);
    });
  });

  describe("HTTP Routes (app.inject)", () => {
    it("23. POST /periodizations/:id/activate via HTTP", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id);
      const plan = await createTestWorkoutPlan(user.id, { isActive: false });
      await createTestPeriodizationPlan(periodization.id, plan.id, { order: 1 });

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: user.id },
        session: { id: "test-session" },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      const res = await app.inject({
        method: "POST",
        url: `/periodizations/${periodization.id}/activate`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ACTIVE");
      expect(body.currentBlock?.order).toBe(1);
    });

    it("24. POST /periodizations/:id/deactivate via HTTP", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
      });

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: user.id },
        session: { id: "test-session" },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      const res = await app.inject({
        method: "POST",
        url: `/periodizations/${periodization.id}/deactivate`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("PAUSED");
    });

    it("25. POST /periodizations/:id/advance via HTTP", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
      });

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: user.id },
        session: { id: "test-session" },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      const res = await app.inject({
        method: "POST",
        url: `/periodizations/${periodization.id}/advance`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("COMPLETED");
    });

    it("26. POST /periodizations/:id/complete via HTTP", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const periodization = await createTestPeriodization(user.id, {
        isActive: true,
        startedAt: new Date(),
      });
      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      await createTestPeriodizationPlan(periodization.id, plan.id, {
        order: 1,
        activatedAt: new Date(),
      });

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: user.id },
        session: { id: "test-session" },
      } as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);

      const res = await app.inject({
        method: "POST",
        url: `/periodizations/${periodization.id}/complete`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("COMPLETED");
      expect(body.currentBlock).toBeNull();
    });
  });
});
