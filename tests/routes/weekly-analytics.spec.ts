import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SetType, WorkoutSessionOrigin } from "../../src/generated/prisma/enums.js";
import { auth } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/db.js";
import { historyRoutes } from "../../src/routes/history.js";
import {
  cleanupTestUsers,
  createTestSessionExercise,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
  createTestWorkoutSession,
  createTestWorkoutSet,
} from "../helpers/test-db.js";

describe("Weekly Volume & Training Analytics API — GET /history/analytics/weekly (Task 3.4)", () => {
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

  // -------------------------------------------------------------
  // PARTE F & H — TIMEZONE E FRONTEIRAS TEMPORAIS
  // -------------------------------------------------------------

  it("item 42: sessão concluída na segunda-feira 01:00 UTC (domingo 22:00 local em SP) deve cair na semana anterior", async () => {
    mockAuthUser(userA);

    // 2026-09-28T01:00:00.000Z:
    // Em America/Sao_Paulo (UTC-3), é Domingo 2026-09-27 às 22:00.
    // Portanto, pertence à semana que começou na Segunda 2026-09-21 (2026-09-21 a 2026-09-27),
    // e NÃO à semana de 2026-09-28.
    const completedAtUtc = new Date("2026-09-28T01:00:00.000Z");
    const startedAtUtc = new Date("2026-09-28T00:00:00.000Z");

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: startedAtUtc,
      completedAt: completedAtUtc,
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id);
    await createTestWorkoutSet(se.id, {
      type: SetType.WORKING,
      weightInGrams: 80000,
      reps: 10,
      completedAt: completedAtUtc,
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-21&endDate=2026-10-04",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.weeks).toHaveLength(2);

    const weekPrevious = body.weeks.find((w: any) => w.weekStartDate === "2026-09-21");
    const weekNext = body.weeks.find((w: any) => w.weekStartDate === "2026-09-28");

    expect(weekPrevious).toBeDefined();
    expect(weekPrevious.workoutsCompleted).toBe(1);
    expect(weekPrevious.workingSets).toBe(1);
    expect(weekPrevious.loadVolumeGrams).toBe(800000);

    expect(weekNext).toBeDefined();
    expect(weekNext.workoutsCompleted).toBe(0);
    expect(weekNext.workingSets).toBe(0);
  });

  it("item 43: sessão concluída exatamente na segunda-feira 00:00 local pertence à nova semana", async () => {
    mockAuthUser(userA);

    // Em America/Sao_Paulo (UTC-3), Segunda 2026-09-28 00:00:00 local corresponde a 2026-09-28T03:00:00.000Z.
    const completedAtUtc = new Date("2026-09-28T03:00:00.000Z");
    const startedAtUtc = new Date("2026-09-28T02:00:00.000Z");

    const session = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: startedAtUtc,
      completedAt: completedAtUtc,
      origin: WorkoutSessionOrigin.FREE,
    });
    const se = await createTestSessionExercise(session.id);
    await createTestWorkoutSet(se.id, {
      type: SetType.WORKING,
      weightInGrams: 100000,
      reps: 5,
      completedAt: completedAtUtc,
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-21&endDate=2026-10-04",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    const weekPrevious = body.weeks.find((w: any) => w.weekStartDate === "2026-09-21");
    const weekNext = body.weeks.find((w: any) => w.weekStartDate === "2026-09-28");

    expect(weekPrevious.workoutsCompleted).toBe(0);
    expect(weekNext.workoutsCompleted).toBe(1);
    expect(weekNext.workingSets).toBe(1);
    expect(weekNext.loadVolumeGrams).toBe(500000);
  });

  // -------------------------------------------------------------
  // PARTE F — MÉTRICAS SEMANAIS E FILTROS DE SEGURANÇA
  // -------------------------------------------------------------

  it("item 44: calcula workoutsCompleted, workingSets, warmupSets, loadVolume, totalDuration e averageDuration com precisão", async () => {
    mockAuthUser(userA);

    // Sessão 1: quarta-feira 2026-09-16 10:00 local (13:00 UTC), duração 3600s
    const s1Start = new Date("2026-09-16T12:00:00.000Z");
    const s1End = new Date("2026-09-16T13:00:00.000Z"); // 3600s
    const session1 = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: s1Start,
      completedAt: s1End,
      origin: WorkoutSessionOrigin.FREE,
    });
    const se1 = await createTestSessionExercise(session1.id);
    // 2 warmup sets
    await createTestWorkoutSet(se1.id, {
      type: SetType.WARMUP,
      weightInGrams: 40000,
      reps: 10,
      completedAt: s1End,
    });
    await createTestWorkoutSet(se1.id, {
      type: SetType.WARMUP,
      weightInGrams: 60000,
      reps: 8,
      completedAt: s1End,
    });
    // 2 working sets: 100kg x 10 (1.000.000g) + 120kg x 5 (600.000g) = 1.600.000g
    await createTestWorkoutSet(se1.id, {
      type: SetType.WORKING,
      weightInGrams: 100000,
      reps: 10,
      completedAt: s1End,
    });
    await createTestWorkoutSet(se1.id, {
      type: SetType.WORKING,
      weightInGrams: 120000,
      reps: 5,
      completedAt: s1End,
    });

    // Sessão 2: sexta-feira 2026-09-18 10:00 local (13:00 UTC), duração 1800s
    const s2Start = new Date("2026-09-18T12:30:00.000Z");
    const s2End = new Date("2026-09-18T13:00:00.000Z"); // 1800s
    const session2 = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: s2Start,
      completedAt: s2End,
      origin: WorkoutSessionOrigin.FREE,
    });
    const se2 = await createTestSessionExercise(session2.id);
    // 1 working set: 50kg x 8 = 400.000g
    await createTestWorkoutSet(se2.id, {
      type: SetType.WORKING,
      weightInGrams: 50000,
      reps: 8,
      completedAt: s2End,
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.weeks).toHaveLength(1);
    const week = body.weeks[0];

    expect(week.weekStartDate).toBe("2026-09-14");
    expect(week.weekEndDate).toBe("2026-09-20");
    expect(week.workoutsCompleted).toBe(2);
    expect(week.workingSets).toBe(3);
    expect(week.warmupSets).toBe(2);
    expect(week.loadVolumeGrams).toBe(2000000); // 1.600.000 + 400.000
    expect(week.loadVolumeKg).toBe(2000);
    expect(week.totalDurationInSeconds).toBe(5400); // 3600 + 1800
    expect(week.averageDurationInSeconds).toBe(2700); // 5400 / 2
  });

  it("item 45: sessão ativa (completedAt = null) não participa dos analytics", async () => {
    mockAuthUser(userA);

    await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: null,
      origin: WorkoutSessionOrigin.FREE,
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const week = body.weeks[0];
    expect(week.workoutsCompleted).toBe(0);
    expect(week.workingSets).toBe(0);
    expect(week.totalDurationInSeconds).toBe(0);
  });

  it("item 46: treinos de outro atleta são rigorosamente isolados", async () => {
    mockAuthUser(userA);

    // Treino completado para User B
    const bSession = await createTestWorkoutSession(null, {
      athleteId: userB.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const seB = await createTestSessionExercise(bSession.id);
    await createTestWorkoutSet(seB.id, {
      type: SetType.WORKING,
      weightInGrams: 100000,
      reps: 10,
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const week = body.weeks[0];
    expect(week.workoutsCompleted).toBe(0);
    expect(week.workingSets).toBe(0);
    expect(week.loadVolumeGrams).toBe(0);
  });

  it("item 47: treinos FREE e PLANNED participam igualmente", async () => {
    mockAuthUser(userA);

    const plan = await createTestWorkoutPlan(userA.id);
    const day = await createTestWorkoutDay(plan.id);

    // 1 Planned Session
    const plannedSession = await createTestWorkoutSession(day.id, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-15T12:00:00.000Z"),
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.PLANNED,
    });
    const se1 = await createTestSessionExercise(plannedSession.id);
    await createTestWorkoutSet(se1.id, {
      type: SetType.WORKING,
      weightInGrams: 50000,
      reps: 10,
      completedAt: new Date("2026-09-15T13:00:00.000Z"),
    });

    // 1 Free Session
    const freeSession = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-16T12:00:00.000Z"),
      completedAt: new Date("2026-09-16T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const se2 = await createTestSessionExercise(freeSession.id);
    await createTestWorkoutSet(se2.id, {
      type: SetType.WORKING,
      weightInGrams: 50000,
      reps: 10,
      completedAt: new Date("2026-09-16T13:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-14&endDate=2026-09-20",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const week = body.weeks[0];
    expect(week.workoutsCompleted).toBe(2);
    expect(week.workingSets).toBe(2);
    expect(week.loadVolumeGrams).toBe(1000000);
  });

  it("item 48: semanas vazias no range devem ser retornadas com zeros determinísticos", async () => {
    mockAuthUser(userA);

    // Range de 3 semanas (2026-09-07 a 2026-09-27) sem nenhum treino
    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-07&endDate=2026-09-27",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.weeks).toHaveLength(3);
    for (const week of body.weeks) {
      expect(week.workoutsCompleted).toBe(0);
      expect(week.workingSets).toBe(0);
      expect(week.warmupSets).toBe(0);
      expect(week.loadVolumeGrams).toBe(0);
      expect(week.loadVolumeKg).toBe(0);
      expect(week.totalDurationInSeconds).toBe(0);
      expect(week.averageDurationInSeconds).toBe(0);
    }
  });

  it("item 49: range customizado exclui sessões ocorridas fora da janela civil", async () => {
    mockAuthUser(userA);

    // Treino antes da janela (2026-09-05)
    await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-05T12:00:00.000Z"),
      completedAt: new Date("2026-09-05T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });

    // Treino dentro da janela (2026-09-10)
    const insideSession = await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-10T12:00:00.000Z"),
      completedAt: new Date("2026-09-10T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });
    const seInside = await createTestSessionExercise(insideSession.id);
    await createTestWorkoutSet(seInside.id, {
      type: SetType.WORKING,
      weightInGrams: 80000,
      reps: 10,
      completedAt: new Date("2026-09-10T13:00:00.000Z"),
    });

    // Treino depois da janela (2026-09-25)
    await createTestWorkoutSession(null, {
      athleteId: userA.id,
      startedAt: new Date("2026-09-25T12:00:00.000Z"),
      completedAt: new Date("2026-09-25T13:00:00.000Z"),
      origin: WorkoutSessionOrigin.FREE,
    });

    const response = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-07&endDate=2026-09-13",
      headers: { cookie: "mock-session" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.weeks).toHaveLength(1);
    expect(body.weeks[0].workoutsCompleted).toBe(1);
    expect(body.weeks[0].workingSets).toBe(1);
  });

  it("item 50: weeksCount funciona para 1, 4, 8 e rejeita limites inválidos 0 e 53", async () => {
    mockAuthUser(userA);

    const r1 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&weeksCount=1",
      headers: { cookie: "mock-session" },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().weeks).toHaveLength(1);

    const r4 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&weeksCount=4",
      headers: { cookie: "mock-session" },
    });
    expect(r4.statusCode).toBe(200);
    expect(r4.json().weeks).toHaveLength(4);

    const r8 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&weeksCount=8",
      headers: { cookie: "mock-session" },
    });
    expect(r8.statusCode).toBe(200);
    expect(r8.json().weeks).toHaveLength(8);

    // Default quando nada fornecido é 8 semanas
    const rDefault = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo",
      headers: { cookie: "mock-session" },
    });
    expect(rDefault.statusCode).toBe(200);
    expect(rDefault.json().weeks).toHaveLength(8);

    // 0 -> 400
    const r0 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&weeksCount=0",
      headers: { cookie: "mock-session" },
    });
    expect(r0.statusCode).toBe(400);

    // 53 -> 400
    const r53 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&weeksCount=53",
      headers: { cookie: "mock-session" },
    });
    expect(r53.statusCode).toBe(400);
  });

  // -------------------------------------------------------------
  // PARTE H — EDGE CASES DE TIMEZONE E DATA
  // -------------------------------------------------------------

  it("item 61: timezone inválido ou offset bruto retorna 400 INVALID_TIMEZONE", async () => {
    mockAuthUser(userA);

    const r1 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=Mars/Olympus&weeksCount=4",
      headers: { cookie: "mock-session" },
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().code).toBe("INVALID_TIMEZONE");

    const r2 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=-03:00&weeksCount=4",
      headers: { cookie: "mock-session" },
    });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().code).toBe("INVALID_TIMEZONE");

    const r3 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=GMT-3&weeksCount=4",
      headers: { cookie: "mock-session" },
    });
    expect(r3.statusCode).toBe(400);
    expect(r3.json().code).toBe("INVALID_TIMEZONE");
  });

  it("item 62: range invertido ou mistura de modos retorna 400 INVALID_DATE_RANGE", async () => {
    mockAuthUser(userA);

    // startDate > endDate
    const r1 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-10-20&endDate=2026-10-01",
      headers: { cookie: "mock-session" },
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().code).toBe("INVALID_DATE_RANGE");

    // Misturar startDate com weeksCount
    const r2 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-01&endDate=2026-09-30&weeksCount=4",
      headers: { cookie: "mock-session" },
    });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().code).toBe("INVALID_DATE_RANGE");

    // Enviar apenas startDate sem endDate
    const r3 = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-09-01",
      headers: { cookie: "mock-session" },
    });
    expect(r3.statusCode).toBe(400);
    expect(r3.json().code).toBe("INVALID_DATE_RANGE");
  });

  it("item 63: data inexistente no calendário real (ex: 2026-02-31) é rejeitada com 400 INVALID_DATE_RANGE", async () => {
    mockAuthUser(userA);

    const r = await app.inject({
      method: "GET",
      url: "/history/analytics/weekly?tz=America/Sao_Paulo&startDate=2026-02-01&endDate=2026-02-31",
      headers: { cookie: "mock-session" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_DATE_RANGE");
  });
});
