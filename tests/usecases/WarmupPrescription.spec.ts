import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getSystemPrompt } from "../../src/ai/system-prompt.js";
import { aiExerciseSchema, getAiTools } from "../../src/ai/tools.js";
import { WeekDay, WorkoutSessionOrigin } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { CreatePeriodizationDraftFromAI } from "../../src/usecases/CreatePeriodizationDraftFromAI.js";
import { CreateWorkoutPlan } from "../../src/usecases/CreateWorkoutPlan.js";
import { DuplicateWorkoutPlan } from "../../src/usecases/DuplicateWorkoutPlan.js";
import { GetWorkoutSession } from "../../src/usecases/GetWorkoutSession.js";
import { StartFreeWorkoutSession } from "../../src/usecases/StartFreeWorkoutSession.js";
import { StartWorkoutSession } from "../../src/usecases/StartWorkoutSession.js";
import {
  cleanupTestUsers,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutExercise,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("Warmup Prescription & AI Support (Task 2.8.2)", () => {
  const testUserIds: string[] = [];

  afterEach(async () => {
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Parte A: Warmup Persistence & Snapshots", () => {
    it("CreateWorkoutPlan sem warmupSets -> persiste warmupSets = 0 por padrão", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const createWorkoutPlan = new CreateWorkoutPlan();
      const plan = await createWorkoutPlan.execute({
        userId: user.id,
        name: "Plano Sem Warmup Informado",
        workoutDays: [
          {
            name: "Treino A",
            weekDay: WeekDay.MONDAY,
            isRest: false,
            estimatedDurationInSeconds: 3600,
            exercises: [
              {
                order: 1,
                name: "Supino Reto",
                sets: 3,
                reps: 10,
                restTimeInSeconds: 60,
              },
            ],
          },
        ],
      });

      expect(plan.workoutDays[0].exercises[0].warmupSets).toBe(0);
      expect(plan.workoutDays[0].exercises[0].sets).toBe(3);

      const dbExercise = await prisma.workoutExercise.findFirst({
        where: { name: "Supino Reto", workoutDay: { workoutPlanId: plan.id } },
      });
      expect(dbExercise?.warmupSets).toBe(0);
      expect(dbExercise?.sets).toBe(3);
    });

    it("CreateWorkoutPlan com warmupSets -> persiste valor informado", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const createWorkoutPlan = new CreateWorkoutPlan();
      const plan = await createWorkoutPlan.execute({
        userId: user.id,
        name: "Plano Com Warmup",
        workoutDays: [
          {
            name: "Treino Pernas",
            weekDay: WeekDay.TUESDAY,
            isRest: false,
            estimatedDurationInSeconds: 4000,
            exercises: [
              {
                order: 1,
                name: "Agachamento Livre",
                warmupSets: 2,
                sets: 4,
                reps: 6,
                restTimeInSeconds: 120,
              },
              {
                order: 2,
                name: "Extensora",
                warmupSets: 0,
                sets: 3,
                reps: 12,
                restTimeInSeconds: 60,
              },
            ],
          },
        ],
      });

      expect(plan.workoutDays[0].exercises[0].warmupSets).toBe(2);
      expect(plan.workoutDays[0].exercises[0].sets).toBe(4);
      expect(plan.workoutDays[0].exercises[1].warmupSets).toBe(0);
      expect(plan.workoutDays[0].exercises[1].sets).toBe(3);

      const squat = await prisma.workoutExercise.findFirst({
        where: { name: "Agachamento Livre", workoutDay: { workoutPlanId: plan.id } },
      });
      expect(squat?.warmupSets).toBe(2);
      expect(squat?.sets).toBe(4);
    });

    it("DuplicateWorkoutPlan -> copia fielmente warmupSets", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, { name: "Original", isActive: false });
      const day = await createTestWorkoutDay(plan.id, { name: "Superior" });
      await createTestWorkoutExercise(day.id, {
        name: "Desenvolvimento Halteres",
        warmupSets: 2,
        sets: 3,
        reps: 8,
        restTimeInSeconds: 90,
      });

      const duplicateUseCase = new DuplicateWorkoutPlan();
      const duplicated = await duplicateUseCase.execute({
        userId: user.id,
        workoutPlanId: plan.id,
      });

      expect(duplicated.workoutDays[0].exercises[0].warmupSets).toBe(2);
      expect(duplicated.workoutDays[0].exercises[0].sets).toBe(3);

      const duplicatedDb = await prisma.workoutExercise.findFirst({
        where: { name: "Desenvolvimento Halteres", workoutDay: { workoutPlanId: duplicated.id } },
      });
      expect(duplicatedDb?.warmupSets).toBe(2);
      expect(duplicatedDb?.sets).toBe(3);
    });

    it("CreatePeriodizationDraftFromAI -> persiste warmupSets nos blocos e planos criados", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const createPeriodizationDraft = new CreatePeriodizationDraftFromAI();
      const draft = await createPeriodizationDraft.execute({
        userId: user.id,
        name: "Periodização Força",
        blocks: [
          {
            plan: {
              name: "Bloco 1 - Base",
              workoutDays: [
                {
                  name: "Segunda - Supino",
                  weekDay: WeekDay.MONDAY,
                  isRest: false,
                  estimatedDurationInSeconds: 3600,
                  exercises: [
                    {
                      order: 1,
                      name: "Supino Reto",
                      warmupSets: 2,
                      sets: 3,
                      reps: 6,
                      restTimeInSeconds: 90,
                    },
                  ],
                },
                { name: "Terça", weekDay: WeekDay.TUESDAY, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
                { name: "Quarta", weekDay: WeekDay.WEDNESDAY, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
                { name: "Quinta", weekDay: WeekDay.THURSDAY, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
                { name: "Sexta", weekDay: WeekDay.FRIDAY, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
                { name: "Sábado", weekDay: WeekDay.SATURDAY, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
                { name: "Domingo", weekDay: WeekDay.SUNDAY, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
              ],
            },
          },
        ],
      });

      const planId = draft.blocks[0].workoutPlanId;
      const dbExercise = await prisma.workoutExercise.findFirst({
        where: { name: "Supino Reto", workoutDay: { workoutPlanId: planId } },
      });
      expect(dbExercise?.warmupSets).toBe(2);
      expect(dbExercise?.sets).toBe(3);
    });

    it("StartWorkoutSession -> faz snapshot de plannedWarmupSets = exercise.warmupSets", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, { name: "Plano Ativo", isActive: true });
      const day = await createTestWorkoutDay(plan.id, { name: "Dia de Perna" });
      await createTestWorkoutExercise(day.id, {
        name: "Leg Press",
        warmupSets: 3,
        sets: 4,
        reps: 12,
        restTimeInSeconds: 90,
      });

      const startSession = new StartWorkoutSession();
      const sessionResult = await startSession.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      expect(sessionResult.exercises[0].plannedWarmupSets).toBe(3);
      expect(sessionResult.exercises[0].plannedSets).toBe(4);

      const getSession = new GetWorkoutSession();
      const sessionData = await getSession.execute({
        userId: user.id,
        sessionId: sessionResult.userWorkoutSessionId,
      });

      expect(sessionData.sessionExercises[0].plannedWarmupSets).toBe(3);
      expect(sessionData.sessionExercises[0].plannedSets).toBe(4);
    });

    it("FREE session -> não inventa plannedWarmupSets (permanece nulo)", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const startFree = new StartFreeWorkoutSession();
      const freeSession = await startFree.execute({ userId: user.id });

      expect(freeSession.origin).toBe(WorkoutSessionOrigin.FREE);

      const getSession = new GetWorkoutSession();
      const sessionData = await getSession.execute({
        userId: user.id,
        sessionId: freeSession.workoutSessionId,
      });

      expect(sessionData.sessionExercises).toHaveLength(0);
    });
  });

  describe("Parte B: AI Tool Schemas & System Prompt Rules", () => {
    it("aiExerciseSchema aceita warmupSets e define default 0", () => {
      const parsedWithWarmup = aiExerciseSchema.parse({
        order: 1,
        name: "Levantamento Terra",
        warmupSets: 3,
        sets: 3,
        reps: 5,
        restTimeInSeconds: 180,
      });
      expect(parsedWithWarmup.warmupSets).toBe(3);
      expect(parsedWithWarmup.sets).toBe(3);

      const parsedWithoutWarmup = aiExerciseSchema.parse({
        order: 2,
        name: "Rosca Martelo",
        sets: 3,
        reps: 12,
        restTimeInSeconds: 60,
      });
      expect(parsedWithoutWarmup.warmupSets).toBe(0);
    });

    it("aiExerciseSchema rejeita warmupSets negativo ou não-inteiro", () => {
      expect(() =>
        aiExerciseSchema.parse({
          order: 1,
          name: "Agachamento",
          warmupSets: -1,
          sets: 3,
          reps: 10,
          restTimeInSeconds: 60,
        }),
      ).toThrow();

      expect(() =>
        aiExerciseSchema.parse({
          order: 1,
          name: "Agachamento",
          warmupSets: 1.5,
          sets: 3,
          reps: 10,
          restTimeInSeconds: 60,
        }),
      ).toThrow();
    });

    it("proposeWorkoutPlan e createWorkoutPlanDraft preservam warmupSets", async () => {
      const user = await createTestUser();
      testUserIds.push(user.id);

      const tools = getAiTools(user.id);

      const workoutPlanInput = {
        name: "Plano IA com Aquecimento",
        workoutDays: [
          {
            name: "Treino Superior",
            weekDay: "MONDAY" as const,
            isRest: false,
            estimatedDurationInSeconds: 3600,
            exercises: [
              {
                order: 1,
                name: "Supino Reto com Barra",
                warmupSets: 2,
                sets: 3,
                reps: 8,
                restTimeInSeconds: 90,
              },
            ],
          },
          { name: "Terça", weekDay: "TUESDAY" as const, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
          { name: "Quarta", weekDay: "WEDNESDAY" as const, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
          { name: "Quinta", weekDay: "THURSDAY" as const, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
          { name: "Sexta", weekDay: "FRIDAY" as const, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
          { name: "Sábado", weekDay: "SATURDAY" as const, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
          { name: "Domingo", weekDay: "SUNDAY" as const, isRest: true, estimatedDurationInSeconds: 0, exercises: [] },
        ],
      };

      // 1. Proposta pura
      const proposed = await (tools.proposeWorkoutPlan.execute as any)(workoutPlanInput, {
        toolCallId: "call_prop_1",
      });
      expect(proposed.status).toBe("PROPOSED");
      expect(proposed.plan.workoutDays[0].exercises[0].warmupSets).toBe(2);

      // 2. Draft de escrita
      const draftResult = await (tools.createWorkoutPlanDraft.execute as any)(workoutPlanInput, {
        toolCallId: "call_draft_1",
      });
      expect(draftResult.status).toBe("SAVED_DRAFT");

      const savedDb = await prisma.workoutExercise.findFirst({
        where: { name: "Supino Reto com Barra", workoutDay: { workoutPlanId: draftResult.planId } },
      });
      expect(savedDb?.warmupSets).toBe(2);
      expect(savedDb?.sets).toBe(3);
    });

    it("SYSTEM_PROMPT contém diretrizes de parcimônia e semântica de warmupSets", () => {
      const prompt = getSystemPrompt("Carlos");
      expect(prompt).toContain("warmupSets");
      expect(prompt).toContain("parcimônia");
      expect(prompt).toContain("compostos");
      expect(prompt).toContain("isoladores");
    });
  });
});
