import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_MUSCLE_ORDER } from "../../src/domain/analytics-dates.js";
import {
  MuscleGroup,
  MuscleRole,
  SetType,
  WorkoutSessionOrigin,
} from "../../src/generated/prisma/enums.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { historyRoutes } from "../../src/routes/history.js";
import {
  cleanupTestExercises,
  cleanupTestUsers,
  createdTestExerciseIds,
  createTestExercise,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutSession,
  createTestWorkoutSet,
} from "../helpers/test-db.js";

describe("Muscle Training Analytics API — GET /history/analytics/muscles (Task 3.4)", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  let userA: { id: string; email: string; name: string };
  let userB: { id: string; email: string; name: string };

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(historyRoutes, { prefix: "/history" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    testUserIds.push(userA.id, userB.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
    if (createdTestExerciseIds.length > 0) {
      await cleanupTestExercises([...createdTestExerciseIds]);
      createdTestExerciseIds.length = 0;
    }
  });

  function mockAuthUser(user: { id: string; email: string; name: string }) {
    vi.spyOn(auth.api, "getSession").mockResolvedValue({
      session: {
        id: crypto.randomUUID(),
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
        token: "mock-token",
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  it("item 51: PRIMARY direto soma +1 directWorkingSet para cada working set concluída", async () => {
    mockAuthUser(userA);

    const chestEx = await createTestExercise({ name: "Supino Reto Teste", ownerUserId: userA.id });
    await prisma.exerciseMuscle.create({
      data: {
        exerciseId: chestEx.id,
        muscleGroup: MuscleGroup.CHEST,
        role: MuscleRole.PRIMARY,
      },
    });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: chestEx.id,
    });

    // 3 WORKING sets
    for (let i = 1; i <= 3; i++) {
      await createTestWorkoutSet(se.id, {
        order: i,
        type: SetType.WORKING,
        weightInGrams: 80000,
        reps: 10,
        completedAt: new Date("2026-09-15T13:00:00.000Z"),
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalWorkingSets).toBe(3);
    expect(body.classifiedWorkingSets).toBe(3);
    expect(body.unclassifiedWorkingSets).toBe(0);

    const chest = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.CHEST);
    expect(chest.directWorkingSets).toBe(3);
    expect(chest.indirectWorkingSets).toBe(0);
  });

  it("item 52: SECONDARY indireto não multiplica totalWorkingSets nem classifiedWorkingSets", async () => {
    mockAuthUser(userA);

    // Exercício composto: CHEST PRIMARY, TRICEPS SECONDARY, SHOULDERS SECONDARY
    const benchEx = await createTestExercise({ name: "Supino Composto Teste", ownerUserId: userA.id });
    await prisma.exerciseMuscle.createMany({
      data: [
        { exerciseId: benchEx.id, muscleGroup: MuscleGroup.CHEST, role: MuscleRole.PRIMARY },
        { exerciseId: benchEx.id, muscleGroup: MuscleGroup.TRICEPS, role: MuscleRole.SECONDARY },
        { exerciseId: benchEx.id, muscleGroup: MuscleGroup.SHOULDERS, role: MuscleRole.SECONDARY },
      ],
    });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: benchEx.id,
    });

    // 4 WORKING sets
    for (let i = 1; i <= 4; i++) {
      await createTestWorkoutSet(se.id, {
        order: i,
        type: SetType.WORKING,
        weightInGrams: 90000,
        reps: 8,
        completedAt: new Date("2026-09-15T13:00:00.000Z"),
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Invariante essencial: o treino teve 4 sets, NUNCA 12!
    expect(body.totalWorkingSets).toBe(4);
    expect(body.classifiedWorkingSets).toBe(4);
    expect(body.unclassifiedWorkingSets).toBe(0);

    const chest = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.CHEST);
    const triceps = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.TRICEPS);
    const shoulders = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.SHOULDERS);

    expect(chest.directWorkingSets).toBe(4);
    expect(chest.indirectWorkingSets).toBe(0);

    expect(triceps.directWorkingSets).toBe(0);
    expect(triceps.indirectWorkingSets).toBe(4);

    expect(shoulders.directWorkingSets).toBe(0);
    expect(shoulders.indirectWorkingSets).toBe(4);
  });

  it("item 53: exercício com múltiplos PRIMARY soma direta em ambos os grupos sem duplicar totalWorkingSets", async () => {
    mockAuthUser(userA);

    // Exercício: QUADRICEPS PRIMARY e GLUTES PRIMARY
    const squatEx = await createTestExercise({ name: "Agachamento Teste", ownerUserId: userA.id });
    await prisma.exerciseMuscle.createMany({
      data: [
        { exerciseId: squatEx.id, muscleGroup: MuscleGroup.QUADRICEPS, role: MuscleRole.PRIMARY },
        { exerciseId: squatEx.id, muscleGroup: MuscleGroup.GLUTES, role: MuscleRole.PRIMARY },
      ],
    });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: squatEx.id,
    });

    // 5 WORKING sets
    for (let i = 1; i <= 5; i++) {
      await createTestWorkoutSet(se.id, {
        order: i,
        type: SetType.WORKING,
        weightInGrams: 100000,
        reps: 6,
        completedAt: new Date("2026-09-15T13:00:00.000Z"),
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalWorkingSets).toBe(5);
    expect(body.classifiedWorkingSets).toBe(5);
    expect(body.unclassifiedWorkingSets).toBe(0);

    const quads = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.QUADRICEPS);
    const glutes = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.GLUTES);

    expect(quads.directWorkingSets).toBe(5);
    expect(glutes.directWorkingSets).toBe(5);
  });

  it("item 54: série WORKING em SessionExercise com exerciseId = null conta em unclassifiedWorkingSets", async () => {
    mockAuthUser(userA);

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    // exerciseId é null (exercício legado/livre)
    const se = await createTestSessionExercise(session.id, {
      exerciseId: null,
      exerciseNameSnapshot: "Exercício Sem Id",
    });

    await createTestWorkoutSet(se.id, {
      type: SetType.WORKING,
      weightInGrams: 50000,
      reps: 10,
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalWorkingSets).toBe(1);
    expect(body.classifiedWorkingSets).toBe(0);
    expect(body.unclassifiedWorkingSets).toBe(1);

    // Nenhum músculo recebe séries
    for (const m of body.muscles) {
      expect(m.directWorkingSets).toBe(0);
      expect(m.indirectWorkingSets).toBe(0);
    }
  });

  it("item 55: exercício válido sem músculos cadastrados conta como unclassifiedWorkingSets", async () => {
    mockAuthUser(userA);

    // Exercise criado sem nenhum ExerciseMuscle
    const emptyEx = await createTestExercise({ name: "Exercício Sem Músculos", ownerUserId: userA.id });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: emptyEx.id,
    });

    await createTestWorkoutSet(se.id, {
      type: SetType.WORKING,
      weightInGrams: 40000,
      reps: 12,
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalWorkingSets).toBe(1);
    expect(body.classifiedWorkingSets).toBe(0);
    expect(body.unclassifiedWorkingSets).toBe(1);
  });

  it("item 56: WARMUP nunca participa de analytics muscular (nem direct, nem indirect, nem totals)", async () => {
    mockAuthUser(userA);

    const chestEx = await createTestExercise({ name: "Supino Aquecimento", ownerUserId: userA.id });
    await prisma.exerciseMuscle.create({
      data: {
        exerciseId: chestEx.id,
        muscleGroup: MuscleGroup.CHEST,
        role: MuscleRole.PRIMARY,
      },
    });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: chestEx.id,
    });

    // Apenas séries WARMUP
    await createTestWorkoutSet(se.id, {
      type: SetType.WARMUP,
      weightInGrams: 30000,
      reps: 15,
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalWorkingSets).toBe(0);
    expect(body.classifiedWorkingSets).toBe(0);
    expect(body.unclassifiedWorkingSets).toBe(0);

    const chest = body.muscles.find((m: any) => m.muscleGroup === MuscleGroup.CHEST);
    expect(chest.directWorkingSets).toBe(0);
    expect(chest.indirectWorkingSets).toBe(0);
  });

  it("item 57: WorkoutSet sem completedAt (incompleto) não participa", async () => {
    mockAuthUser(userA);

    const chestEx = await createTestExercise({ name: "Supino Incompleto", ownerUserId: userA.id });
    await prisma.exerciseMuscle.create({
      data: {
        exerciseId: chestEx.id,
        muscleGroup: MuscleGroup.CHEST,
        role: MuscleRole.PRIMARY,
      },
    });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: chestEx.id,
    });

    await createTestWorkoutSet(se.id, {
      type: SetType.WORKING,
      weightInGrams: 80000,
      reps: 10,
      completedAt: null, // Não concluída!
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totalWorkingSets).toBe(0);
    expect(body.classifiedWorkingSets).toBe(0);
    expect(body.unclassifiedWorkingSets).toBe(0);
  });

  it("item 58: invariante totalWorkingSets === classifiedWorkingSets + unclassifiedWorkingSets é rigorosamente mantida", async () => {
    mockAuthUser(userA);

    // 1 exercício classificado
    const chestEx = await createTestExercise({ name: "Supino Invariante", ownerUserId: userA.id });
    await prisma.exerciseMuscle.create({
      data: {
        exerciseId: chestEx.id,
        muscleGroup: MuscleGroup.CHEST,
        role: MuscleRole.PRIMARY,
      },
    });

    // 1 exercício sem músculos
    const emptyEx = await createTestExercise({ name: "Leg Press Sem Músculo", ownerUserId: userA.id });

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });

    // 3 sets classificados
    const se1 = await createTestSessionExercise(session.id, { exerciseId: chestEx.id });
    for (let i = 0; i < 3; i++) {
      await createTestWorkoutSet(se1.id, {
        type: SetType.WORKING,
        weightInGrams: 70000,
        reps: 10,
        completedAt: new Date("2026-09-15T13:00:00.000Z"),
      });
    }

    // 2 sets em exercício sem músculos
    const se2 = await createTestSessionExercise(session.id, { exerciseId: emptyEx.id });
    for (let i = 0; i < 2; i++) {
      await createTestWorkoutSet(se2.id, {
        type: SetType.WORKING,
        weightInGrams: 150000,
        reps: 12,
        completedAt: new Date("2026-09-15T13:00:00.000Z"),
      });
    }

    // 1 set com exerciseId = null
    const se3 = await createTestSessionExercise(session.id, { exerciseId: null });
    await createTestWorkoutSet(se3.id, {
      type: SetType.WORKING,
      weightInGrams: 20000,
      reps: 15,
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.totalWorkingSets).toBe(6);
    expect(body.classifiedWorkingSets).toBe(3);
    expect(body.unclassifiedWorkingSets).toBe(3);

    // Teste explícito da invariante
    expect(body.totalWorkingSets).toBe(body.classifiedWorkingSets + body.unclassifiedWorkingSets);
  });

  it("item 59: todos os 13 MuscleGroups são retornados na ordem canônica estável mesmo zerados", async () => {
    mockAuthUser(userA);

    // Nenhuma sessão cadastrada para o período
    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.muscles).toHaveLength(13);
    expect(body.muscles).toHaveLength(CANONICAL_MUSCLE_ORDER.length);

    // Verifica que a ordem de retorno bate exatamente com a ordem canônica
    body.muscles.forEach((item: any, idx: number) => {
      expect(item.muscleGroup).toBe(CANONICAL_MUSCLE_ORDER[idx]);
      expect(item.directWorkingSets).toBe(0);
      expect(item.indirectWorkingSets).toBe(0);
    });
  });

  it("item 60: timezone em muscles inclui ou exclui sessão conforme data civil local", async () => {
    mockAuthUser(userA);

    const chestEx = await createTestExercise({ name: "Supino Noturno", ownerUserId: userA.id });
    await prisma.exerciseMuscle.create({
      data: {
        exerciseId: chestEx.id,
        muscleGroup: MuscleGroup.CHEST,
        role: MuscleRole.PRIMARY,
      },
    });

    // Sessão concluída em 2026-09-21T01:00:00.000Z.
    // Em America/Sao_Paulo (UTC-3), é Domingo 2026-09-20 às 22:00.
    // Se o range for 2026-09-14 a 2026-09-20 em America/Sao_Paulo, essa sessão DEVE entrar.
    // Se o range for 2026-09-21 a 2026-09-27, ela DEVE ser excluída.
    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-21T00:00:00.000Z"),
      completedAt: new Date("2026-09-21T01:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id, {
      exerciseId: chestEx.id,
    });
    await createTestWorkoutSet(se.id, {
      type: SetType.WORKING,
      weightInGrams: 80000,
      reps: 10,
      completedAt: new Date("2026-09-21T01:00:00.000Z"),
    });

    // Teste 1: janela que contém 2026-09-20 local
    const rInside = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });
    expect(rInside.statusCode).toBe(200);
    expect(rInside.json().totalWorkingSets).toBe(1);
    expect(rInside.json().classifiedWorkingSets).toBe(1);

    // Teste 2: janela que começa em 2026-09-21 local (deve excluir o treino que foi no dia 20 local)
    const rOutside = await app.inject({
      method: "GET",
      url: "/history/analytics/muscles?tz=America/Sao_Paulo&startDate=2026-09-21&endDate=2026-09-27",
      headers: { cookie: "mock-session" },
    });
    expect(rOutside.statusCode).toBe(200);
    expect(rOutside.json().totalWorkingSets).toBe(0);
  });
});
