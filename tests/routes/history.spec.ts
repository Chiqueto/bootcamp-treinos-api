import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeHistoryCursor, encodeHistoryCursor } from "../../src/domain/history-cursor.js";
import { InvalidCursorError } from "../../src/errors/index.js";
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

describe("History Timeline & Detail API (Task 3.2)", () => {
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

  // -------------------------------------------------------------
  // Unit tests for Cursor Helper
  // -------------------------------------------------------------
  describe("Cursor Helper (history-cursor.ts)", () => {
    it("encodes and decodes valid cursor correctly", () => {
      const payload = {
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
        id: "11111111-1111-4111-8111-111111111111",
      };

      const encoded = encodeHistoryCursor(payload);
      expect(typeof encoded).toBe("string");

      const decoded = decodeHistoryCursor(encoded);
      expect(decoded.completedAt.toISOString()).toBe("2026-10-01T12:00:00.000Z");
      expect(decoded.id).toBe("11111111-1111-4111-8111-111111111111");
    });

    it("throws InvalidCursorError for invalid inputs", () => {
      // garbage string
      expect(() => decodeHistoryCursor("not-a-base64")).toThrow(InvalidCursorError);

      // valid base64 but invalid JSON
      const badJson = Buffer.from("invalid-json-here").toString("base64url");
      expect(() => decodeHistoryCursor(badJson)).toThrow(InvalidCursorError);

      // version != 1
      const badVersion = Buffer.from(
        JSON.stringify({ v: 2, completedAt: "2026-10-01T12:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" }),
      ).toString("base64url");
      expect(() => decodeHistoryCursor(badVersion)).toThrow(InvalidCursorError);

      // invalid timestamp
      const badDate = Buffer.from(
        JSON.stringify({ v: 1, completedAt: "not-a-date", id: "11111111-1111-4111-8111-111111111111" }),
      ).toString("base64url");
      expect(() => decodeHistoryCursor(badDate)).toThrow(InvalidCursorError);

      // bad UUID
      const badUuid = Buffer.from(
        JSON.stringify({ v: 1, completedAt: "2026-10-01T12:00:00.000Z", id: "not-a-valid-uuid" }),
      ).toString("base64url");
      expect(() => decodeHistoryCursor(badUuid)).toThrow(InvalidCursorError);
    });
  });

  // -------------------------------------------------------------
  // Item 33: Teste - Histórico Básico
  // -------------------------------------------------------------
  describe("33. GET /history/sessions — Histórico Básico", () => {
    it("deve retornar sessões concluídas do atleta, ignorar ativas e de outros usuários, incluir FREE e PLANNED, e respeitar origin filter", async () => {
      mockAuthUser(userA);

      const planA = await createTestWorkoutPlan(userA.id, { name: "Plano A" });
      const dayA = await createTestWorkoutDay(planA.id, { name: "Dia A" });

      // 1. Concluída PLANNED de userA
      const sessPlanned = await createTestWorkoutSession(dayA.id, {
        athleteId: userA.id,
        origin: WorkoutSessionOrigin.PLANNED,
        workoutPlanId: planA.id,
        workoutPlanNameSnapshot: "Plano A",
        workoutDayNameSnapshot: "Dia A",
        startedAt: new Date("2026-10-01T09:00:00.000Z"),
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });

      // 2. Concluída FREE de userA
      const sessFree = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        origin: WorkoutSessionOrigin.FREE,
        startedAt: new Date("2026-10-01T11:00:00.000Z"),
        completedAt: new Date("2026-10-01T11:45:00.000Z"),
      });

      // 3. Ativa de userA (não deve aparecer)
      await createTestWorkoutSession(dayA.id, {
        athleteId: userA.id,
        startedAt: new Date("2026-10-01T12:00:00.000Z"),
        completedAt: null,
      });

      // 4. Concluída de userB (não deve aparecer)
      const planB = await createTestWorkoutPlan(userB.id, { name: "Plano B" });
      const dayB = await createTestWorkoutDay(planB.id, { name: "Dia B" });
      await createTestWorkoutSession(dayB.id, {
        athleteId: userB.id,
        startedAt: new Date("2026-10-01T08:00:00.000Z"),
        completedAt: new Date("2026-10-01T09:00:00.000Z"),
      });

      // Consulta sem filtro de origin (traz FREE e PLANNED)
      const resAll = await app.inject({
        method: "GET",
        url: "/history/sessions",
      });

      expect(resAll.statusCode).toBe(200);
      const dataAll = resAll.json();
      expect(dataAll.items).toHaveLength(2);
      const returnedIds = dataAll.items.map((i: any) => i.id);
      expect(returnedIds).toContain(sessPlanned.id);
      expect(returnedIds).toContain(sessFree.id);
      expect(dataAll.hasMore).toBe(false);
      expect(dataAll.nextCursor).toBeNull();

      // Consulta filtrando origin=FREE
      const resFree = await app.inject({
        method: "GET",
        url: "/history/sessions?origin=FREE",
      });
      expect(resFree.statusCode).toBe(200);
      const dataFree = resFree.json();
      expect(dataFree.items).toHaveLength(1);
      expect(dataFree.items[0].id).toBe(sessFree.id);
      expect(dataFree.items[0].origin).toBe("FREE");

      // Consulta filtrando origin=PLANNED
      const resPlanned = await app.inject({
        method: "GET",
        url: "/history/sessions?origin=PLANNED",
      });
      expect(resPlanned.statusCode).toBe(200);
      const dataPlanned = resPlanned.json();
      expect(dataPlanned.items).toHaveLength(1);
      expect(dataPlanned.items[0].id).toBe(sessPlanned.id);
      expect(dataPlanned.items[0].origin).toBe("PLANNED");
    });
  });

  // -------------------------------------------------------------
  // Item 34: Teste - Ordenação
  // -------------------------------------------------------------
  describe("34. GET /history/sessions — Ordenação", () => {
    it("deve ordenar por completedAt DESC e desempate determinístico por id DESC", async () => {
      mockAuthUser(userA);

      const t1 = new Date("2026-10-01T10:00:00.000Z");
      const tSame = new Date("2026-10-01T12:00:00.000Z");
      const t3 = new Date("2026-10-01T14:00:00.000Z");

      const sOld = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: t1,
      });

      // Duas sessões com completedAt exatamente igual
      // Gerar IDs fixos para testar desempate determinístico id DESC
      const idLow = "00000000-0000-4000-8000-000000000001";
      const idHigh = "ffffffff-ffff-4fff-8fff-ffffffffffff";

      await createTestWorkoutSession(null, {
        id: idLow,
        athleteId: userA.id,
        completedAt: tSame,
      });

      await createTestWorkoutSession(null, {
        id: idHigh,
        athleteId: userA.id,
        completedAt: tSame,
      });

      const sNewest = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: t3,
      });

      const res = await app.inject({
        method: "GET",
        url: "/history/sessions",
      });

      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items).toHaveLength(4);

      // Ordem esperada:
      // 1. sNewest (14:00)
      // 2. idHigh (12:00, id maior)
      // 3. idLow (12:00, id menor)
      // 4. sOld (10:00)
      expect(items[0].id).toBe(sNewest.id);
      expect(items[1].id).toBe(idHigh);
      expect(items[2].id).toBe(idLow);
      expect(items[3].id).toBe(sOld.id);
    });
  });

  // -------------------------------------------------------------
  // Item 35: Teste - Cursor Pagination
  // -------------------------------------------------------------
  describe("35. GET /history/sessions — Cursor Pagination", () => {
    it("deve paginar corretamente sem duplicatas ou itens faltantes em página 1, 2 e última", async () => {
      mockAuthUser(userA);

      // Criar 5 sessões concluídas com horários decrescentes
      const createdSessions = [];
      for (let i = 0; i < 5; i++) {
        const completedAt = new Date(Date.UTC(2026, 9, 1, 10, i * 10));
        const s = await createTestWorkoutSession(null, {
          athleteId: userA.id,
          completedAt,
        });
        createdSessions.push(s);
      }

      // Ordenadas DESC no tempo: index 4 (10:40), 3 (10:30), 2 (10:20), 1 (10:10), 0 (10:00)
      const expectedIdsDesc = createdSessions.map((s) => s.id).reverse();

      // Page 1 (limit = 2)
      const res1 = await app.inject({
        method: "GET",
        url: "/history/sessions?limit=2",
      });
      expect(res1.statusCode).toBe(200);
      const page1 = res1.json();
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((i: any) => i.id)).toEqual([expectedIdsDesc[0], expectedIdsDesc[1]]);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2 (limit = 2) usando nextCursor de Page 1
      const res2 = await app.inject({
        method: "GET",
        url: `/history/sessions?limit=2&cursor=${page1.nextCursor}`,
      });
      expect(res2.statusCode).toBe(200);
      const page2 = res2.json();
      expect(page2.items).toHaveLength(2);
      expect(page2.items.map((i: any) => i.id)).toEqual([expectedIdsDesc[2], expectedIdsDesc[3]]);
      expect(page2.hasMore).toBe(true);
      expect(page2.nextCursor).not.toBeNull();

      // Page 3 (última página, limit = 2)
      const res3 = await app.inject({
        method: "GET",
        url: `/history/sessions?limit=2&cursor=${page2.nextCursor}`,
      });
      expect(res3.statusCode).toBe(200);
      const page3 = res3.json();
      expect(page3.items).toHaveLength(1);
      expect(page3.items.map((i: any) => i.id)).toEqual([expectedIdsDesc[4]]);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // Item 36: Teste - Timeline Mutável
  // -------------------------------------------------------------
  describe("36. GET /history/sessions — Timeline Mutável", () => {
    it("uma nova sessão concluída após a página 1 não desloca ou duplica itens na página 2", async () => {
      mockAuthUser(userA);

      // Criar 4 sessões antigas
      const s1 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
      });
      const s2 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T11:00:00.000Z"),
      });
      const s3 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });
      const s4 = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T13:00:00.000Z"),
      });

      // Buscar página 1 (limit 2)
      // Ordem DESC: s4 (13h), s3 (12h)
      const res1 = await app.inject({
        method: "GET",
        url: "/history/sessions?limit=2",
      });
      const page1 = res1.json();
      expect(page1.items.map((i: any) => i.id)).toEqual([s4.id, s3.id]);
      const cursorAfterPage1 = page1.nextCursor;

      // Agora o usuário conclui uma sessão NOVA mais recente (14h)
      await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T14:00:00.000Z"),
      });

      // Buscar página 2 usando o cursor salvo da página 1
      const res2 = await app.inject({
        method: "GET",
        url: `/history/sessions?limit=2&cursor=${cursorAfterPage1}`,
      });
      const page2 = res2.json();

      // Em paginação por OFFSET, o item s3 teria deslizado para a página 2 (duplicando).
      // Com CURSOR pagination, a página 2 deve retornar estritamente s2 (11h) e s1 (10h)!
      expect(page2.items.map((i: any) => i.id)).toEqual([s2.id, s1.id]);
    });
  });

  // -------------------------------------------------------------
  // Item 37: Teste - Cursor Inválido
  // -------------------------------------------------------------
  describe("37. GET /history/sessions — Cursor Inválido", () => {
    it("deve retornar 400 com code INVALID_CURSOR para qualquer cursor corrompido", async () => {
      mockAuthUser(userA);

      const invalidCases = [
        "garbage-string-xyz",
        Buffer.from("invalid-json").toString("base64url"),
        Buffer.from(JSON.stringify({ v: 2, completedAt: new Date().toISOString(), id: crypto.randomUUID() })).toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1, completedAt: "invalid-date", id: crypto.randomUUID() })).toString("base64url"),
        Buffer.from(JSON.stringify({ v: 1, completedAt: new Date().toISOString(), id: "invalid-uuid" })).toString("base64url"),
      ];

      for (const badCursor of invalidCases) {
        const res = await app.inject({
          method: "GET",
          url: `/history/sessions?cursor=${encodeURIComponent(badCursor)}`,
        });

        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.code).toBe("INVALID_CURSOR");
        expect(body.error).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------
  // Item 38: Teste - Métricas (Timeline e Detail)
  // -------------------------------------------------------------
  describe("38. Métricas — Load Volume, Warmup e Working Sets", () => {
    it("deve calcular corretamente workingSetsCount, warmupSetsCount e totalLoadVolumeGrams ignorando incompletos e peso null", async () => {
      mockAuthUser(userA);

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        startedAt: new Date("2026-10-01T10:00:00.000Z"),
        completedAt: new Date("2026-10-01T11:00:00.000Z"), // 3600s
      });

      const se = await createTestSessionExercise(session.id, {
        exerciseNameSnapshot: "Agachamento Livre",
        order: 1,
      });

      const now = new Date();

      // 2 WARMUP concluídos
      await createTestWorkoutSet(se.id, {
        order: 1,
        type: SetType.WARMUP,
        weightInGrams: 40000,
        reps: 10,
        completedAt: now,
      });
      await createTestWorkoutSet(se.id, {
        order: 2,
        type: SetType.WARMUP,
        weightInGrams: 60000,
        reps: 8,
        completedAt: now,
      });

      // 3 WORKING concluídos:
      // Working 1: 100kg (100000g) x 5 reps = 500.000g
      await createTestWorkoutSet(se.id, {
        order: 3,
        type: SetType.WORKING,
        weightInGrams: 100000,
        reps: 5,
        completedAt: now,
      });
      // Working 2: 100kg (100000g) x 5 reps = 500.000g
      await createTestWorkoutSet(se.id, {
        order: 4,
        type: SetType.WORKING,
        weightInGrams: 100000,
        reps: 5,
        completedAt: now,
      });
      // Working 3: peso null x 10 reps = 0g de tonelagem, mas conta em workingSetsCount
      await createTestWorkoutSet(se.id, {
        order: 5,
        type: SetType.WORKING,
        weightInGrams: null,
        reps: 10,
        completedAt: now,
      });

      // 1 WORKING incompleto: completedAt = null (não deve contar em nada!)
      await createTestWorkoutSet(se.id, {
        order: 6,
        type: SetType.WORKING,
        weightInGrams: 100000,
        reps: 5,
        completedAt: null,
      });

      // 1. Verificar Timeline
      const resTimeline = await app.inject({
        method: "GET",
        url: "/history/sessions",
      });
      expect(resTimeline.statusCode).toBe(200);
      const item = resTimeline.json().items[0];

      expect(item.id).toBe(session.id);
      expect(item.durationInSeconds).toBe(3600);
      expect(item.exercisesCount).toBe(1);
      expect(item.workingSetsCount).toBe(3);
      expect(item.warmupSetsCount).toBe(2);
      expect(item.totalLoadVolumeGrams).toBe(1000000); // 1.000.000g = 1.000kg
      expect(item.totalLoadVolumeKg).toBe(1000);

      // 2. Verificar Detail
      const resDetail = await app.inject({
        method: "GET",
        url: `/history/sessions/${session.id}`,
      });
      expect(resDetail.statusCode).toBe(200);
      const detail = resDetail.json();

      expect(detail.summary.exercisesCount).toBe(1);
      expect(detail.summary.workingSetsCount).toBe(3);
      expect(detail.summary.warmupSetsCount).toBe(2);
      expect(detail.summary.totalLoadVolumeGrams).toBe(1000000);
      expect(detail.summary.totalLoadVolumeKg).toBe(1000);

      // Sets no detalhe devem conter apenas os 5 concluídos (o 6º incompleto é omitido)
      expect(detail.exercises[0].sets).toHaveLength(5);
      expect(detail.exercises[0].performed.warmupSetsCount).toBe(2);
      expect(detail.exercises[0].performed.workingSetsCount).toBe(3);
      expect(detail.exercises[0].performed.loadVolumeGrams).toBe(1000000);
      expect(detail.exercises[0].performed.loadVolumeKg).toBe(1000);
    });
  });

  // -------------------------------------------------------------
  // Item 39: Teste - Detail / Snapshots
  // -------------------------------------------------------------
  describe("39. Snapshots — Imunidade à renomeação de plano e dia", () => {
    it("deve preservar workoutPlanNameSnapshot e workoutDayNameSnapshot mesmo se o plano e o dia forem renomeados", async () => {
      mockAuthUser(userA);

      const plan = await createTestWorkoutPlan(userA.id, { name: "Hipertrofia A" });
      const day = await createTestWorkoutDay(plan.id, { name: "Upper A" });

      const session = await createTestWorkoutSession(day.id, {
        athleteId: userA.id,
        workoutPlanId: plan.id,
        workoutPlanNameSnapshot: "Hipertrofia A",
        workoutDayNameSnapshot: "Upper A",
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      // Renomear o plano e o dia no banco
      await prisma.workoutPlan.update({
        where: { id: plan.id },
        data: { name: "Plano Alterado Depois" },
      });
      await prisma.workoutDay.update({
        where: { id: day.id },
        data: { name: "Dia Alterado Depois" },
      });

      // 1. Timeline
      const resTimeline = await app.inject({
        method: "GET",
        url: "/history/sessions",
      });
      const timelineItem = resTimeline.json().items.find((i: any) => i.id === session.id);
      expect(timelineItem.workoutPlanNameSnapshot).toBe("Hipertrofia A");
      expect(timelineItem.workoutDayNameSnapshot).toBe("Upper A");

      // 2. Detail
      const resDetail = await app.inject({
        method: "GET",
        url: `/history/sessions/${session.id}`,
      });
      expect(resDetail.statusCode).toBe(200);
      const detail = resDetail.json();
      expect(detail.workoutPlanNameSnapshot).toBe("Hipertrofia A");
      expect(detail.workoutDayNameSnapshot).toBe("Upper A");
    });
  });

  // -------------------------------------------------------------
  // Item 40: Teste - Plano Excluído / Desvinculado
  // -------------------------------------------------------------
  describe("40. Snapshots — Plano desvinculado / nulo", () => {
    it("deve manter snapshots intactos mesmo se workoutPlanId for nulo", async () => {
      mockAuthUser(userA);

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        origin: WorkoutSessionOrigin.PLANNED,
        workoutPlanId: null,
        workoutPlanNameSnapshot: "Plano Histórico Deletado",
        workoutDayNameSnapshot: "Treino B Antigo",
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      const resDetail = await app.inject({
        method: "GET",
        url: `/history/sessions/${session.id}`,
      });
      expect(resDetail.statusCode).toBe(200);
      const detail = resDetail.json();
      expect(detail.workoutPlanId).toBeNull();
      expect(detail.workoutPlanNameSnapshot).toBe("Plano Histórico Deletado");
      expect(detail.workoutDayNameSnapshot).toBe("Treino B Antigo");
    });
  });

  // -------------------------------------------------------------
  // Item 41: Teste - Detail Ownership & Not Found
  // -------------------------------------------------------------
  describe("41. GET /history/sessions/:sessionId — Ownership & Status", () => {
    it("deve retornar 200 para própria sessão concluída, 404 para sessão de outro usuário, 404 para sessão ativa e 404 para ID inexistente", async () => {
      mockAuthUser(userA);

      // Própria concluída -> 200
      const ownCompleted = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      const resOwn = await app.inject({
        method: "GET",
        url: `/history/sessions/${ownCompleted.id}`,
      });
      expect(resOwn.statusCode).toBe(200);
      expect(resOwn.json().id).toBe(ownCompleted.id);

      // Própria mas ainda ativa -> 404
      const ownActive = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: null,
      });

      const resActive = await app.inject({
        method: "GET",
        url: `/history/sessions/${ownActive.id}`,
      });
      expect(resActive.statusCode).toBe(404);

      // Concluída mas de outro usuário -> 404
      const otherCompleted = await createTestWorkoutSession(null, {
        athleteId: userB.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      const resOther = await app.inject({
        method: "GET",
        url: `/history/sessions/${otherCompleted.id}`,
      });
      expect(resOther.statusCode).toBe(404);

      // ID inexistente -> 404
      const resNonExistent = await app.inject({
        method: "GET",
        url: `/history/sessions/${crypto.randomUUID()}`,
      });
      expect(resNonExistent.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------
  // Item 42: Teste - Exercício Legado (exerciseId: null)
  // -------------------------------------------------------------
  describe("42. Sessões com exercício legado (exerciseId: null)", () => {
    it("deve retornar normalmente com exerciseId null e exerciseNameSnapshot preenchido", async () => {
      mockAuthUser(userA);

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      await createTestSessionExercise(session.id, {
        exerciseId: null,
        exerciseNameSnapshot: "Exercício Customizado Legado",
        order: 1,
      });

      const res = await app.inject({
        method: "GET",
        url: `/history/sessions/${session.id}`,
      });

      expect(res.statusCode).toBe(200);
      const detail = res.json();
      expect(detail.exercises).toHaveLength(1);
      expect(detail.exercises[0].exerciseId).toBeNull();
      expect(detail.exercises[0].exerciseNameSnapshot).toBe("Exercício Customizado Legado");
    });
  });

  // -------------------------------------------------------------
  // Item 43: Teste - Planned vs Performed
  // -------------------------------------------------------------
  describe("43. Planned vs Performed Separation", () => {
    it("deve contrastar com fidelidade o planejado e o realizado sem julgamento", async () => {
      mockAuthUser(userA);

      const session = await createTestWorkoutSession(null, {
        athleteId: userA.id,
        completedAt: new Date("2026-10-01T12:00:00.000Z"),
      });

      // Planned: warmup 2, working 3, reps 8, rest 90s
      const se = await createTestSessionExercise(session.id, {
        exerciseNameSnapshot: "Desenvolvimento Halteres",
        order: 1,
        plannedWarmupSets: 2,
        plannedSets: 3,
        plannedReps: 8,
        plannedRestTimeInSeconds: 90,
      });

      const now = new Date();

      // Executado: 1 warmup concluído
      await createTestWorkoutSet(se.id, {
        order: 1,
        type: SetType.WARMUP,
        weightInGrams: 10000,
        reps: 12,
        completedAt: now,
      });

      // Executado: 4 working concluídos (1 a mais do que o planejado)
      for (let i = 2; i <= 5; i++) {
        await createTestWorkoutSet(se.id, {
          order: i,
          type: SetType.WORKING,
          weightInGrams: 24000,
          reps: 8,
          completedAt: now,
        });
      }

      const res = await app.inject({
        method: "GET",
        url: `/history/sessions/${session.id}`,
      });

      expect(res.statusCode).toBe(200);
      const detail = res.json();
      const ex = detail.exercises[0];

      // Planned estritamente dos snapshots do SessionExercise
      expect(ex.planned.warmupSets).toBe(2);
      expect(ex.planned.workingSets).toBe(3);
      expect(ex.planned.reps).toBe(8);
      expect(ex.planned.restTimeInSeconds).toBe(90);

      // Performed estritamente das séries concluídas
      expect(ex.performed.warmupSetsCount).toBe(1);
      expect(ex.performed.workingSetsCount).toBe(4);
      expect(ex.performed.loadVolumeGrams).toBe(4 * 24000 * 8); // 768.000g
      expect(ex.performed.loadVolumeKg).toBe(768);
    });
  });

  // -------------------------------------------------------------
  // Item 44: Teste - Anti-N+1 Performance Verification
  // -------------------------------------------------------------
  describe("44. Anti-N+1 Strategy Verification", () => {
    it("deve realizar uma quantidade constante de queries de agregação independentemente do tamanho da página", async () => {
      mockAuthUser(userA);

      // Criar 10 sessões com exercícios e séries
      for (let i = 0; i < 10; i++) {
        const s = await createTestWorkoutSession(null, {
          athleteId: userA.id,
          completedAt: new Date(Date.UTC(2026, 9, 1, 8, i)),
        });
        const se = await createTestSessionExercise(s.id, {
          exerciseNameSnapshot: `Exercício ${i}`,
          order: 1,
        });
        await createTestWorkoutSet(se.id, {
          order: 1,
          type: SetType.WORKING,
          weightInGrams: 50000,
          reps: 10,
          completedAt: new Date(),
        });
      }

      // Espionar prisma.workoutSession.findMany e prisma.$queryRaw
      const findManySpy = vi.spyOn(prisma.workoutSession, "findMany");
      const queryRawSpy = vi.spyOn(prisma, "$queryRaw");

      // Requisição com limit 2
      await app.inject({
        method: "GET",
        url: "/history/sessions?limit=2",
      });

      const findManyCountPage2 = findManySpy.mock.calls.length;
      const queryRawCountPage2 = queryRawSpy.mock.calls.length;

      // Reset contadores
      findManySpy.mockClear();
      queryRawSpy.mockClear();

      // Requisição com limit 8
      await app.inject({
        method: "GET",
        url: "/history/sessions?limit=8",
      });

      const findManyCountPage8 = findManySpy.mock.calls.length;
      const queryRawCountPage8 = queryRawSpy.mock.calls.length;

      // O número de queries deve ser estritamente constante:
      // 1 findMany + 1 $queryRaw = 2 queries no total em ambos os casos
      expect(findManyCountPage2).toBe(1);
      expect(queryRawCountPage2).toBe(1);
      expect(findManyCountPage8).toBe(1);
      expect(queryRawCountPage8).toBe(1);
    });
  });
});
