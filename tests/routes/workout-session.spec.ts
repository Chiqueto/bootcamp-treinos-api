import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { workoutSessionRoutes } from "../../src/routes/workout-session.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
  createTestWorkoutSession,
} from "../helpers/test-db.js";

describe("WorkoutSession & WorkoutSet HTTP Routes", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  let userA: { id: string; email: string; name: string };
  let userB: { id: string; email: string; name: string };
  let workoutPlanA: { id: string };
  let workoutDayA: { id: string };
  let sessionA: { id: string };
  let sessionExerciseA1: { id: string };

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(workoutSessionRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    testUserIds.push(userA.id, userB.id);

    workoutPlanA = await createTestWorkoutPlan(userA.id);
    workoutDayA = await createTestWorkoutDay(workoutPlanA.id);
    sessionA = await createTestWorkoutSession(workoutDayA.id, {
      athleteId: userA.id,
      startedAt: new Date(),
      completedAt: null,
    });
    sessionExerciseA1 = await createTestSessionExercise(sessionA.id, {
      exerciseNameSnapshot: "Supino Reto",
      order: 1,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
  });

  function mockAuthUser(user: { id: string; email: string; name: string }) {
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
        id: "sess-test",
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
        token: "tok-test",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as any);
  }

  it("POST /session-exercises/:sessionExerciseId/sets — retorna 201 e cria série", async () => {
    mockAuthUser(userA);

    const response = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        type: "WORKING",
        weightInGrams: 30000,
        reps: 8,
        rir: 2,
        notes: "Série pesada",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.id).toBeDefined();
    expect(body.order).toBe(1);
    expect(body.weightInGrams).toBe(30000);
    expect(body.reps).toBe(8);
  });

  it("POST /session-exercises/:sessionExerciseId/sets — retorna 401 se não autenticado", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        reps: 10,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("UNAUTHORIZED");
  });

  it("POST /session-exercises/:sessionExerciseId/sets — retorna 404 para usuário sem ownership", async () => {
    mockAuthUser(userB); // Usuário B tenta mexer no exercício do Usuário A

    const response = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        reps: 10,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NOT_FOUND");
  });

  it("POST /session-exercises/:sessionExerciseId/sets — retorna 400 se tentar concluir sem reps ou duration", async () => {
    mockAuthUser(userA);

    const response = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        weightInGrams: 20000,
        completed: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /workout-sets/:setId — retorna 200 e atualiza série", async () => {
    mockAuthUser(userA);

    const createRes = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        weightInGrams: 20000,
        reps: 10,
      },
    });
    const setId = createRes.json().id;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/workout-sets/${setId}`,
      payload: {
        weightInGrams: 25000,
        reps: 8,
        completed: true,
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json();
    expect(body.weightInGrams).toBe(25000);
    expect(body.reps).toBe(8);
    expect(body.completedAt).not.toBeNull();
  });

  it("PATCH /workout-sets/:setId — retorna 409 se a sessão já estiver concluída", async () => {
    mockAuthUser(userA);

    const createRes = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        reps: 10,
      },
    });
    const setId = createRes.json().id;

    // Conclui a sessão
    await prisma.workoutSession.update({
      where: { id: sessionA.id },
      data: { completedAt: new Date() },
    });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/workout-sets/${setId}`,
      payload: {
        reps: 12,
      },
    });

    expect(patchRes.statusCode).toBe(409);
    expect(patchRes.json().code).toBe("WORKOUT_SESSION_ALREADY_COMPLETED");
  });

  it("DELETE /workout-sets/:setId — retorna 200 e remove série", async () => {
    mockAuthUser(userA);

    const createRes = await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: {
        reps: 10,
      },
    });
    const setId = createRes.json().id;

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/workout-sets/${setId}`,
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);

    const inDb = await prisma.workoutSet.findUnique({
      where: { id: setId },
    });
    expect(inDb).toBeNull();
  });

  it("GET /workout-sessions/:sessionId — retorna 200 com exercícios e séries ordenados", async () => {
    mockAuthUser(userA);

    await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: { reps: 10, type: "WARMUP" },
    });
    await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: { reps: 8, type: "WORKING", weightInGrams: 30000 },
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/workout-sessions/${sessionA.id}`,
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.id).toBe(sessionA.id);
    expect(body.sessionExercises.length).toBe(1);
    expect(body.sessionExercises[0].sets.length).toBe(2);
    expect(body.sessionExercises[0].sets[0].order).toBe(1);
    expect(body.sessionExercises[0].sets[1].order).toBe(2);
  });

  it("GET /workout-sessions/active — retorna a sessão ativa", async () => {
    mockAuthUser(userA);

    const activeRes = await app.inject({
      method: "GET",
      url: "/workout-sessions/active",
    });

    expect(activeRes.statusCode).toBe(200);
    const body = activeRes.json();
    expect(body.id).toBe(sessionA.id);
    expect(body.completedAt).toBeNull();
  });

  it("POST /workout-sessions/:sessionId/complete — conclui sessão com sucesso (200)", async () => {
    mockAuthUser(userA);

    const res = await app.inject({
      method: "POST",
      url: `/workout-sessions/${sessionA.id}/complete`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(sessionA.id);
    expect(body.completedAt).toBeDefined();

    // Idempotência: segunda chamada retorna 200 com mesmo completedAt
    const retryRes = await app.inject({
      method: "POST",
      url: `/workout-sessions/${sessionA.id}/complete`,
    });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().completedAt).toBe(body.completedAt);
  });

  it("POST /workout-sessions/:sessionId/complete — retorna 400 se houver séries pendentes", async () => {
    mockAuthUser(userA);

    // Cria série pendente
    await app.inject({
      method: "POST",
      url: `/session-exercises/${sessionExerciseA1.id}/sets`,
      payload: { reps: 10, type: "WORKING" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/workout-sessions/${sessionA.id}/complete`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PENDING_WORKOUT_SETS");
  });

  it("POST /workout-sessions/:sessionId/complete — retorna 404 para sessão de outro usuário", async () => {
    mockAuthUser(userB);

    const res = await app.inject({
      method: "POST",
      url: `/workout-sessions/${sessionA.id}/complete`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("POST /workout-sessions/free — inicia sessão avulsa (201)", async () => {
    mockAuthUser(userB);

    const res = await app.inject({
      method: "POST",
      url: "/workout-sessions/free",
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.userWorkoutSessionId).toBeDefined();
    expect(body.workoutDayId).toBeNull();
  });

  it("POST /workout-sessions/:sessionId/exercises — adiciona exercício à sessão avulsa (201)", async () => {
    mockAuthUser(userB);

    const freeSessRes = await app.inject({
      method: "POST",
      url: "/workout-sessions/free",
    });
    const sessionId = freeSessRes.json().userWorkoutSessionId;

    const exercise = await createTestExercise({ name: "Barra Paralela", ownerUserId: null });

    const addRes = await app.inject({
      method: "POST",
      url: `/workout-sessions/${sessionId}/exercises`,
      payload: {
        exerciseId: exercise.id,
      },
    });

    expect(addRes.statusCode).toBe(201);
    const body = addRes.json();
    expect(body.exerciseNameSnapshot).toBe(exercise.name);
    expect(body.order).toBe(1);

    // DELETE /session-exercises/:sessionExerciseId — remove exercício
    const delRes = await app.inject({
      method: "DELETE",
      url: `/session-exercises/${body.id}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().success).toBe(true);
  });
});
