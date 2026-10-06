/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAiTools } from "../../src/ai/tools.js";
import { InvalidTimezoneError, NotFoundError } from "../../src/errors/index.js";
import {
  MuscleGroup,
  MuscleRole,
  SetType,
} from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutPlan,
  createTestWorkoutSession,
  createTestWorkoutSet,
} from "../helpers/test-db.js";

describe("Coach Training Context Tools — Task 3.4.1", () => {
  const userIds: string[] = [];
  const globalExerciseIds: string[] = [];

  let userA: Awaited<ReturnType<typeof createTestUser>>;
  let userB: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    userIds.push(userA.id, userB.id);

    // Mantém o cleanup central cobrindo também sessões FREE de ambos os usuários.
    await createTestWorkoutPlan(userA.id, {
      name: "Plano de suporte ao cleanup",
    });
  });

  afterEach(async () => {
    await cleanupTestUsers(userIds);
    userIds.length = 0;

    if (globalExerciseIds.length > 0) {
      await prisma.exerciseMuscle.deleteMany({
        where: { exerciseId: { in: globalExerciseIds } },
      });
      await prisma.exercise.deleteMany({
        where: { id: { in: globalExerciseIds }, ownerUserId: null },
      });
      globalExerciseIds.length = 0;
    }
  });

  async function modelCounts() {
    const [
      workoutPlans,
      periodizations,
      workoutSessions,
      workoutSets,
      exercises,
    ] = await Promise.all([
      prisma.workoutPlan.count(),
      prisma.periodization.count(),
      prisma.workoutSession.count(),
      prisma.workoutSet.count(),
      prisma.exercise.count(),
    ]);

    return {
      workoutPlans,
      periodizations,
      workoutSessions,
      workoutSets,
      exercises,
    };
  }

  it("searchExercises retorna globais e custom próprios, exclui terceiros e prioriza prefixo normalizado", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const globalExercise = await createTestExercise({
      name: `Supíno Global ${suffix}`,
      ownerUserId: null,
    });
    globalExerciseIds.push(globalExercise.id);
    const ownExercise = await createTestExercise({
      name: `Supino Custom ${suffix}`,
      ownerUserId: userA.id,
    });
    const otherExercise = await createTestExercise({
      name: `Supino Terceiro ${suffix}`,
      ownerUserId: userB.id,
    });

    const tools: any = getAiTools(userA.id);
    const result = await tools.searchExercises.execute({
      query: "supino",
      limit: 15,
    });
    const ids = result.exercises.map((exercise: { id: string }) => exercise.id);

    expect(ids).toContain(globalExercise.id);
    expect(ids).toContain(ownExercise.id);
    expect(ids).not.toContain(otherExercise.id);
    expect(
      result.exercises.find(
        (exercise: { id: string }) => exercise.id === globalExercise.id,
      ),
    ).toMatchObject({ ownerUserId: null, isCustom: false });
    expect(
      result.exercises.find(
        (exercise: { id: string }) => exercise.id === ownExercise.id,
      ),
    ).toMatchObject({ ownerUserId: userA.id, isCustom: true });
  });

  it("encadeia searchExercises -> getExerciseEvolution com contratos compatíveis e isolamento por atleta", async () => {
    const exercise = await createTestExercise({
      name: `Remada Chain ${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: userA.id,
    });

    const ownSession = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      completedAt: new Date("2026-10-01T12:00:00.000Z"),
    });
    const ownSessionExercise = await createTestSessionExercise(ownSession.id, {
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
    });
    await createTestWorkoutSet(ownSessionExercise.id, {
      type: SetType.WORKING,
      weightInGrams: 80000,
      reps: 8,
      rir: 2,
      completedAt: new Date("2026-10-01T11:55:00.000Z"),
    });

    const otherSession = await createTestWorkoutSession(null, {
      athleteId: userB.id,
      completedAt: new Date("2026-10-02T12:00:00.000Z"),
    });
    const otherSessionExercise = await createTestSessionExercise(
      otherSession.id,
      {
        exerciseId: exercise.id,
        exerciseNameSnapshot: exercise.name,
      },
    );
    await createTestWorkoutSet(otherSessionExercise.id, {
      type: SetType.WORKING,
      weightInGrams: 120000,
      reps: 5,
      completedAt: new Date("2026-10-02T11:55:00.000Z"),
    });

    const tools: any = getAiTools(userA.id);
    const search = await tools.searchExercises.execute({
      query: "Remada Chain",
      limit: 8,
    });
    const found = search.exercises.find(
      (candidate: { id: string }) => candidate.id === exercise.id,
    );
    const evolution = await tools.getExerciseEvolution.execute({
      exerciseId: found.id,
      limit: 6,
    });

    expect(evolution.exercise.id).toBe(exercise.id);
    expect(evolution.sessions).toHaveLength(1);
    expect(evolution.sessions[0].workoutSessionId).toBe(ownSession.id);
    expect(evolution.loadPR).toMatchObject({ weightKg: 80, reps: 8, rir: 2 });
    expect(evolution).not.toHaveProperty("nextCursor");
    expect(evolution).not.toHaveProperty("progressScore");
  });

  it("getRecentTrainingHistory e getWorkoutHistorySession retornam snapshots compactos com ownership", async () => {
    const ownSession = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      workoutPlanNameSnapshot: "Plano Histórico",
      workoutDayNameSnapshot: "Upper A",
      startedAt: new Date("2026-10-03T10:00:00.000Z"),
      completedAt: new Date("2026-10-03T11:00:00.000Z"),
    });
    const ownExercise = await createTestSessionExercise(ownSession.id, {
      exerciseNameSnapshot: "Supino Snapshot",
      plannedSets: 3,
      plannedReps: 8,
    });
    await createTestWorkoutSet(ownExercise.id, {
      type: SetType.WORKING,
      weightInGrams: 85000,
      reps: 7,
      rir: 1,
      completedAt: new Date("2026-10-03T10:30:00.000Z"),
    });

    const otherSession = await createTestWorkoutSession(null, {
      athleteId: userB.id,
      completedAt: new Date("2026-10-04T11:00:00.000Z"),
    });

    const tools: any = getAiTools(userA.id);
    const recent = await tools.getRecentTrainingHistory.execute({ limit: 5 });
    expect(recent.sessions).toHaveLength(1);
    expect(recent.sessions[0]).toMatchObject({
      id: ownSession.id,
      workoutPlanNameSnapshot: "Plano Histórico",
      workoutDayNameSnapshot: "Upper A",
      workingSetsCount: 1,
      totalLoadVolumeKg: 595,
      durationInSeconds: 3600,
    });
    expect(recent.sessions[0]).not.toHaveProperty("startedAt");
    expect(recent).not.toHaveProperty("nextCursor");

    const detail = await tools.getWorkoutHistorySession.execute({
      sessionId: ownSession.id,
    });
    expect(detail.exercises[0].planned).toMatchObject({
      workingSets: 3,
      reps: 8,
    });
    expect(detail.exercises[0].sets[0]).toMatchObject({
      weightInGrams: 85000,
      reps: 7,
      rir: 1,
    });

    await expect(
      tools.getWorkoutHistorySession.execute({ sessionId: otherSession.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("propaga timezone às analytics, retorna TIMEZONE_REQUIRED quando ausente e rejeita IANA inválido", async () => {
    const exercise = await createTestExercise({
      name: `Peito Analytics ${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: userA.id,
    });
    await prisma.exerciseMuscle.create({
      data: {
        exerciseId: exercise.id,
        muscleGroup: MuscleGroup.CHEST,
        role: MuscleRole.PRIMARY,
      },
    });
    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-10-01T10:00:00.000Z"),
      completedAt: new Date("2026-10-01T11:00:00.000Z"),
    });
    const sessionExercise = await createTestSessionExercise(session.id, {
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
    });
    await createTestWorkoutSet(sessionExercise.id, {
      type: SetType.WORKING,
      weightInGrams: 50000,
      reps: 10,
      completedAt: new Date("2026-10-01T10:30:00.000Z"),
    });

    const tools: any = getAiTools(userA.id, { timezone: "America/Sao_Paulo" });
    const weekly = await tools.getWeeklyTrainingAnalytics.execute({
      weeksCount: 4,
    });
    const muscles = await tools.getMuscleTrainingAnalytics.execute({
      startDate: "2026-10-01",
      endDate: "2026-10-01",
    });

    expect(weekly.timezone).toBe("America/Sao_Paulo");
    expect(weekly.weeks).toHaveLength(4);
    expect(muscles.timezone).toBe("America/Sao_Paulo");
    expect(muscles.totalWorkingSets).toBe(1);
    expect(
      muscles.muscles.find(
        (item: { muscleGroup: MuscleGroup }) =>
          item.muscleGroup === MuscleGroup.CHEST,
      ),
    ).toMatchObject({ directWorkingSets: 1 });

    const toolsWithoutTimezone: any = getAiTools(userA.id);
    await expect(
      toolsWithoutTimezone.getWeeklyTrainingAnalytics.execute({
        weeksCount: 4,
      }),
    ).resolves.toEqual({
      status: "TIMEZONE_REQUIRED",
      message: "Não há timezone disponível para calcular este período.",
    });
    await expect(
      toolsWithoutTimezone.getMuscleTrainingAnalytics.execute({
        startDate: "2026-10-01",
        endDate: "2026-10-01",
      }),
    ).resolves.toEqual({
      status: "TIMEZONE_REQUIRED",
      message: "Não há timezone disponível para calcular este período.",
    });
    expect(() => getAiTools(userA.id, { timezone: "GMT-3" })).toThrow(
      InvalidTimezoneError,
    );
  });

  it("todas as novas tools permanecem read-only", async () => {
    const exercise = await createTestExercise({
      name: `Read Only ${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: userA.id,
    });
    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      completedAt: new Date("2026-10-01T11:00:00.000Z"),
    });
    const sessionExercise = await createTestSessionExercise(session.id, {
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
    });
    await createTestWorkoutSet(sessionExercise.id, {
      type: SetType.WORKING,
      reps: 10,
      completedAt: new Date("2026-10-01T10:30:00.000Z"),
    });

    const before = await modelCounts();
    const tools: any = getAiTools(userA.id, { timezone: "UTC" });

    for (const toolName of [
      "getRecentTrainingHistory",
      "getWorkoutHistorySession",
      "searchExercises",
      "getExerciseEvolution",
      "getWeeklyTrainingAnalytics",
      "getMuscleTrainingAnalytics",
    ]) {
      expect(tools[toolName].needsApproval).toBeFalsy();
    }

    await tools.getRecentTrainingHistory.execute({ limit: 5 });
    await tools.getWorkoutHistorySession.execute({ sessionId: session.id });
    await tools.searchExercises.execute({ query: "Read Only", limit: 8 });
    await tools.getExerciseEvolution.execute({
      exerciseId: exercise.id,
      limit: 6,
    });
    await tools.getWeeklyTrainingAnalytics.execute({ weeksCount: 4 });
    await tools.getMuscleTrainingAnalytics.execute({
      startDate: "2026-10-01",
      endDate: "2026-10-01",
    });

    expect(await modelCounts()).toEqual(before);
  });
});
