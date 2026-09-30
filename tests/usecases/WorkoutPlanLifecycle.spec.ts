import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ActivePeriodizationError,
  ActiveWorkoutSessionError,
  NotFoundError,
  PlanBelongsToPeriodizationError,
  PlanIsActivePeriodizationBlockError,
} from "../../src/errors/index.js";
import { WeekDay } from "../../src/generated/prisma/enums.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { WorkoutPlanRoutes } from "../../src/routes/workout-plan.js";
import { ActivateWorkoutPlan } from "../../src/usecases/ActivateWorkoutPlan.js";
import { CreateWorkoutPlan } from "../../src/usecases/CreateWorkoutPlan.js";
import { DeactivateWorkoutPlan } from "../../src/usecases/DeactivateWorkoutPlan.js";
import { DuplicateWorkoutPlan } from "../../src/usecases/DuplicateWorkoutPlan.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestPeriodization,
  createTestPeriodizationPlan,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutExercise,
  createTestWorkoutPlan,
  createTestWorkoutSession,
} from "../helpers/test-db.js";

describe("WorkoutPlan Lifecycle & Duplication (Task 2.2)", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];

  const activateWorkoutPlan = new ActivateWorkoutPlan();
  const deactivateWorkoutPlan = new DeactivateWorkoutPlan();
  const duplicateWorkoutPlan = new DuplicateWorkoutPlan();
  const createWorkoutPlan = new CreateWorkoutPlan();

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(WorkoutPlanRoutes);
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

  describe("ActivateWorkoutPlan", () => {
    it("1. Ativa plano standalone com sucesso", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Inativo",
        isActive: false,
      });

      const result = await activateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: plan.id,
      });

      expect(result.id).toBe(plan.id);
      expect(result.isActive).toBe(true);

      const refreshed = await prisma.workoutPlan.findUnique({
        where: { id: plan.id },
      });
      expect(refreshed?.isActive).toBe(true);
    });

    it("2. Desativa standalone anterior ao ativar o novo", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan1 = await createTestWorkoutPlan(user.id, {
        name: "Plano 1 Ativo",
        isActive: true,
      });
      const plan2 = await createTestWorkoutPlan(user.id, {
        name: "Plano 2 Inativo",
        isActive: false,
      });

      await activateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: plan2.id,
      });

      const refreshed1 = await prisma.workoutPlan.findUnique({
        where: { id: plan1.id },
      });
      const refreshed2 = await prisma.workoutPlan.findUnique({
        where: { id: plan2.id },
      });

      expect(refreshed1?.isActive).toBe(false);
      expect(refreshed2?.isActive).toBe(true);
    });

    it("3. Ownership: lança NotFoundError para plano de outro usuário", async () => {
      const userA = await createTestUser({ name: "User A" });
      const userB = await createTestUser({ name: "User B" });
      testUserIds.push(userA.id, userB.id);

      const planA = await createTestWorkoutPlan(userA.id, { isActive: false });

      await expect(
        activateWorkoutPlan.execute({
          userId: userB.id,
          workoutPlanId: planA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("4. Idempotência: retorna sucesso sem alterações se o plano já estiver ativo", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Já Ativo",
        isActive: true,
      });

      const result = await activateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: plan.id,
      });

      expect(result.isActive).toBe(true);
    });

    it("5. Bloqueia ativação se houver WorkoutSession ativa (open)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const planActive = await createTestWorkoutPlan(user.id, { isActive: true });
      const day = await createTestWorkoutDay(planActive.id);
      const planToActivate = await createTestWorkoutPlan(user.id, { isActive: false });

      // Inicia sessão e deixa aberta
      await createTestWorkoutSession(day.id, {
        athleteId: user.id,
        completedAt: null,
      });

      await expect(
        activateWorkoutPlan.execute({
          userId: user.id,
          workoutPlanId: planToActivate.id,
        }),
      ).rejects.toThrow(ActiveWorkoutSessionError);
    });

    it("6. Bloqueia ativação direta de plano pertencente a Periodization", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, { name: "Pré-Temporada" });
      const planInPer = await createTestWorkoutPlan(user.id, {
        name: "Força",
        isActive: false,
      });
      await createTestPeriodizationPlan(per.id, planInPer.id, { order: 1 });

      await expect(
        activateWorkoutPlan.execute({
          userId: user.id,
          workoutPlanId: planInPer.id,
        }),
      ).rejects.toThrow(PlanBelongsToPeriodizationError);
    });

    it("7. Pausa Periodization ativa ao ativar outro standalone e preserva timestamps do bloco", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const startedAt = new Date("2026-02-01T10:00:00Z");
      const blockActivatedAt = new Date("2026-02-01T10:05:00Z");

      const per = await createTestPeriodization(user.id, {
        name: "Periodização Ativa",
        isActive: true,
        startedAt,
      });

      const planInPer = await createTestWorkoutPlan(user.id, {
        name: "Plano do Bloco",
        isActive: true,
      });

      const pPlan = await createTestPeriodizationPlan(per.id, planInPer.id, {
        order: 1,
        activatedAt: blockActivatedAt,
        completedAt: null,
      });

      const standalonePlan = await createTestWorkoutPlan(user.id, {
        name: "Standalone a Ativar",
        isActive: false,
      });

      const result = await activateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: standalonePlan.id,
      });

      expect(result.isActive).toBe(true);

      // Periodização foi pausada, não concluída
      const refreshedPer = await prisma.periodization.findUnique({
        where: { id: per.id },
      });
      expect(refreshedPer?.isActive).toBe(false);
      expect(refreshedPer?.completedAt).toBeNull();
      expect(refreshedPer?.startedAt?.toISOString()).toBe(startedAt.toISOString());

      // Plano da periodização ficou inativo
      const refreshedPlanInPer = await prisma.workoutPlan.findUnique({
        where: { id: planInPer.id },
      });
      expect(refreshedPlanInPer?.isActive).toBe(false);

      // Bloco preservou timestamps
      const refreshedPPlan = await prisma.periodizationPlan.findUnique({
        where: { id: pPlan.id },
      });
      expect(refreshedPPlan?.activatedAt?.toISOString()).toBe(blockActivatedAt.toISOString());
      expect(refreshedPPlan?.completedAt).toBeNull();

      // Standalone ficou ativo
      const refreshedStandalone = await prisma.workoutPlan.findUnique({
        where: { id: standalonePlan.id },
      });
      expect(refreshedStandalone?.isActive).toBe(true);
    });
  });

  describe("DeactivateWorkoutPlan", () => {
    it("8. Desativa plano standalone ativo e aceita usuário ficar sem plano ativo", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano a Desativar",
        isActive: true,
      });

      const result = await deactivateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: plan.id,
      });

      expect(result.isActive).toBe(false);

      const activePlans = await prisma.workoutPlan.findMany({
        where: { userId: user.id, isActive: true },
      });
      expect(activePlans).toHaveLength(0);
    });

    it("9. Idempotência: desativar plano já inativo retorna sucesso sem erro", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Já Inativo",
        isActive: false,
      });

      const result = await deactivateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: plan.id,
      });

      expect(result.isActive).toBe(false);
    });

    it("10. Ownership: lança NotFoundError para plano de outro usuário", async () => {
      const userA = await createTestUser({ name: "User A" });
      const userB = await createTestUser({ name: "User B" });
      testUserIds.push(userA.id, userB.id);

      const planA = await createTestWorkoutPlan(userA.id, { isActive: true });

      await expect(
        deactivateWorkoutPlan.execute({
          userId: userB.id,
          workoutPlanId: planA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("11. Bloqueia desativação se houver sessão de treino aberta", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, { isActive: true });
      const day = await createTestWorkoutDay(plan.id);

      await createTestWorkoutSession(day.id, {
        athleteId: user.id,
        completedAt: null,
      });

      await expect(
        deactivateWorkoutPlan.execute({
          userId: user.id,
          workoutPlanId: plan.id,
        }),
      ).rejects.toThrow(ActiveWorkoutSessionError);
    });

    it("12. Bloqueia desativação direta de plano que é bloco de Periodization ativa", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, {
        name: "Periodização Ativa",
        isActive: true,
        startedAt: new Date(),
      });
      const planInPer = await createTestWorkoutPlan(user.id, {
        name: "Bloco Ativo",
        isActive: true,
      });
      await createTestPeriodizationPlan(per.id, planInPer.id, {
        order: 1,
        activatedAt: new Date(),
        completedAt: null,
      });

      await expect(
        deactivateWorkoutPlan.execute({
          userId: user.id,
          workoutPlanId: planInPer.id,
        }),
      ).rejects.toThrow(PlanIsActivePeriodizationBlockError);
    });
  });

  describe("CreateWorkoutPlan with Active Periodization Protection", () => {
    it("13. activate: false continua funcionando normalmente durante Periodization ativa", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      await createTestPeriodization(user.id, {
        name: "Periodização Ativa",
        isActive: true,
        startedAt: new Date(),
      });

      const result = await createWorkoutPlan.execute({
        userId: user.id,
        name: "Plano Draft Criado Inativo",
        activate: false,
        workoutDays: defaultWorkoutDays,
      });

      expect(result.id).toBeDefined();
      expect(result.isActive).toBe(false);
    });

    it("14. activate: true (ou omitido) durante Periodization ativa retorna 409 (ActivePeriodizationError)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      await createTestPeriodization(user.id, {
        name: "Periodização Ativa",
        isActive: true,
        startedAt: new Date(),
      });

      // Default (omitido) -> activate=true
      await expect(
        createWorkoutPlan.execute({
          userId: user.id,
          name: "Tentativa Ativa Omitida",
          workoutDays: defaultWorkoutDays,
        }),
      ).rejects.toThrow(ActivePeriodizationError);

      // Explícito activate=true
      await expect(
        createWorkoutPlan.execute({
          userId: user.id,
          name: "Tentativa Ativa Explícita",
          activate: true,
          workoutDays: defaultWorkoutDays,
        }),
      ).rejects.toThrow(ActivePeriodizationError);
    });
  });

  describe("DuplicateWorkoutPlan", () => {
    it("15. Duplica plano completo, copiando WorkoutDays, WorkoutExercises e preservando canonical exerciseId", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const canonicalExercise = await createTestExercise({
        name: "Agachamento Livre Canônico",
        ownerUserId: user.id,
      });

      const originalPlan = await createTestWorkoutPlan(user.id, {
        name: "Plano Original Completo",
        isActive: true,
      });

      const dayA = await createTestWorkoutDay(originalPlan.id, {
        name: "Inferiores Força",
        weekDay: WeekDay.TUESDAY,
        isRest: false,
        estimatedDurationInSeconds: 4200,
        coverImageUrl: "https://example.com/cover.jpg",
      });

      await createTestWorkoutExercise(dayA.id, {
        name: "Agachamento Livre",
        order: 0,
        sets: 5,
        reps: 5,
        restTimeInSeconds: 180,
        exerciseId: canonicalExercise.id,
      });

      // Duplicar com nome customizado
      const duplicated = await duplicateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: originalPlan.id,
        name: "Inferiores - Bloco 2",
      });

      expect(duplicated.id).not.toBe(originalPlan.id);
      expect(duplicated.name).toBe("Inferiores - Bloco 2");
      // Cópia sempre nasce inativa
      expect(duplicated.isActive).toBe(false);

      // WorkoutDays copiados
      expect(duplicated.workoutDays).toHaveLength(1);
      const dupDay = duplicated.workoutDays[0]!;
      expect(dupDay.name).toBe("Inferiores Força");
      expect(dupDay.weekDay).toBe(WeekDay.TUESDAY);
      expect(dupDay.isRest).toBe(false);
      expect(dupDay.estimatedDurationInSeconds).toBe(4200);
      expect(dupDay.coverImageUrl).toBe("https://example.com/cover.jpg");

      // WorkoutExercises copiados
      expect(dupDay.exercises).toHaveLength(1);
      const dupEx = dupDay.exercises[0]!;
      expect(dupEx.name).toBe("Agachamento Livre");
      expect(dupEx.order).toBe(0);
      expect(dupEx.sets).toBe(5);
      expect(dupEx.reps).toBe(5);
      expect(dupEx.restTimeInSeconds).toBe(180);
      // Preservou o mesmo exerciseId canônico do catálogo!
      expect(dupEx.exerciseId).toBe(canonicalExercise.id);
    });

    it("16. Nome padrão é '{nome original} - Cópia' quando não informado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const originalPlan = await createTestWorkoutPlan(user.id, {
        name: "Hipertrofia ABC",
        isActive: false,
      });

      const duplicated = await duplicateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: originalPlan.id,
      });

      expect(duplicated.name).toBe("Hipertrofia ABC - Cópia");
    });

    it("17. Cópia não duplica sessões de treino nem pertence a Periodization", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const per = await createTestPeriodization(user.id, { name: "Periodização" });
      const originalPlan = await createTestWorkoutPlan(user.id, {
        name: "Plano em Periodização",
        isActive: false,
      });
      await createTestPeriodizationPlan(per.id, originalPlan.id, { order: 1 });

      const day = await createTestWorkoutDay(originalPlan.id);
      await createTestWorkoutSession(day.id, {
        athleteId: user.id,
        completedAt: new Date(),
      });

      const duplicated = await duplicateWorkoutPlan.execute({
        userId: user.id,
        workoutPlanId: originalPlan.id,
      });

      // Cópia não tem PeriodizationPlan
      const periodizationLink = await prisma.periodizationPlan.findUnique({
        where: { workoutPlanId: duplicated.id },
      });
      expect(periodizationLink).toBeNull();

      // Cópia não tem sessões
      const sessions = await prisma.workoutSession.findMany({
        where: { workoutDay: { workoutPlanId: duplicated.id } },
      });
      expect(sessions).toHaveLength(0);
    });

    it("18. Ownership: tentar duplicar plano de outro usuário lança NotFoundError", async () => {
      const userA = await createTestUser({ name: "User A" });
      const userB = await createTestUser({ name: "User B" });
      testUserIds.push(userA.id, userB.id);

      const planA = await createTestWorkoutPlan(userA.id, { name: "Plano de A" });

      await expect(
        duplicateWorkoutPlan.execute({
          userId: userB.id,
          workoutPlanId: planA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("HTTP Routes (activate, deactivate, duplicate)", () => {
    it("19. POST /:id/activate retorna 200 com resumo e código de erro 409 tipado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Inativo",
        isActive: false,
      });

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: "test-session-id",
          userId: user.id,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          token: "test-token",
        },
      } as any);

      const response = await app.inject({
        method: "POST",
        url: `/${plan.id}/activate`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(plan.id);
      expect(body.isActive).toBe(true);
    });

    it("20. POST /:id/deactivate retorna 200 com resumo", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Ativo",
        isActive: true,
      });

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: "test-session-id",
          userId: user.id,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          token: "test-token",
        },
      } as any);

      const response = await app.inject({
        method: "POST",
        url: `/${plan.id}/deactivate`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(plan.id);
      expect(body.isActive).toBe(false);
    });

    it("21. POST /:id/duplicate retorna 201 com novo plano completo", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano a Duplicar",
        isActive: true,
      });
      const day = await createTestWorkoutDay(plan.id);
      await createTestWorkoutExercise(day.id);

      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: "test-session-id",
          userId: user.id,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          token: "test-token",
        },
      } as any);

      const response = await app.inject({
        method: "POST",
        url: `/${plan.id}/duplicate`,
        payload: {
          name: "Plano Duplicado HTTP",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.name).toBe("Plano Duplicado HTTP");
      expect(body.isActive).toBe(false);
      expect(body.workoutDays).toHaveLength(1);
    });
  });
});
