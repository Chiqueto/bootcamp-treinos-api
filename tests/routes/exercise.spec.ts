import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "../../src/lib/auth.js";
import { exerciseRoutes } from "../../src/routes/exercise.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestUser,
} from "../helpers/test-db.js";

describe("Exercise HTTP Routes", () => {
  let app: FastifyInstance;
  const testUserIds: string[] = [];
  let userA: { id: string; email: string; name: string };
  let userB: { id: string; email: string; name: string };

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(exerciseRoutes, { prefix: "/exercises" });
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

  it("GET /exercises — retorna exercícios globais e próprios do usuário", async () => {
    mockAuthUser(userA);

    await createTestExercise({ name: "Global Pushup", ownerUserId: null });
    await createTestExercise({ name: "UserA Curl", ownerUserId: userA.id });
    await createTestExercise({ name: "UserB Press", ownerUserId: userB.id });

    const res = await app.inject({
      method: "GET",
      url: "/exercises",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.map((e: any) => e.name);
    expect(names).toContain("Global Pushup");
    expect(names).toContain("UserA Curl");
    expect(names).not.toContain("UserB Press");
  });

  it("POST /exercises — cria exercício personalizado", async () => {
    mockAuthUser(userA);

    const res = await app.inject({
      method: "POST",
      url: "/exercises",
      payload: {
        name: "Crucifixo Invertido",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Crucifixo Invertido");
    expect(body.ownerUserId).toBe(userA.id);

    // Duplicata retorna 409
    const dupRes = await app.inject({
      method: "POST",
      url: "/exercises",
      payload: {
        name: "  crucifixo invertido  ",
      },
    });
    expect(dupRes.statusCode).toBe(409);
  });
});
