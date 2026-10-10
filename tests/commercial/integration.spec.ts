import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/db.js";
import { auth } from "../../src/lib/auth.js";
import { commercialRoutes } from "../../src/routes/commercial.js";
import { CompleteSignup } from "../../src/usecases/CompleteSignup.js";
import {
  CreateSignupIntent,
  hashSignupToken,
} from "../../src/usecases/CreateSignupIntent.js";
import { GetCommercialContext } from "../../src/usecases/GetCommercialContext.js";
import { ListPublicPlans } from "../../src/usecases/ListPublicPlans.js";
import { createTestUser, cleanupTestUsers } from "../helpers/test-db.js";

const users: string[] = [],
  plans: string[] = [],
  hashes: string[] = [];
async function user() {
  const u = await createTestUser();
  users.push(u.id);
  return u;
}
async function plan(overrides = {}) {
  const p = await prisma.plan.create({
    data: {
      code: `test-${crypto.randomUUID()}`,
      name: "Coach test",
      audience: "COACH",
      monthlyPriceInCents: 3990,
      isPublic: true,
      entitlements: {
        create: { entitlement: "MANAGE_ATHLETES", limitValue: 5 },
      },
      ...overrides,
    },
  });
  plans.push(p.id);
  return p;
}
async function intent(
  planCode: string,
  accountType: "ATHLETE" | "COACH" = "COACH",
) {
  const i = await new CreateSignupIntent().execute({ accountType, planCode });
  hashes.push(hashSignupToken(i.token));
  return i;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.signupIntent.deleteMany({
    where: { tokenHash: { in: hashes.splice(0) } },
  });
  await cleanupTestUsers(users.splice(0));
  await prisma.plan.deleteMany({ where: { id: { in: plans.splice(0) } } });
});

describe("Commercial integration (dedicated TEST_DATABASE_URL only)", () => {
  it("rejects INTERNAL and cross-audience plans, even with a valid plan code", async () => {
    for (const input of [
      { accountType: "COACH" as const, planCode: "INTERNAL" },
      { accountType: "ATHLETE" as const, planCode: "INTERNAL" },
      { accountType: "ATHLETE" as const, planCode: "COACH" },
      { accountType: "COACH" as const, planCode: "ATHLETE_FREE" },
    ]) {
      await expect(new CreateSignupIntent().execute(input)).rejects.toThrow("INVALID_SIGNUP_PLAN");
    }
  });
  it("INTERNAL grants only after explicit trusted subscription assignment", async () => {
    const u = await user();
    await prisma.user.update({ where: { id: u.id }, data: { accountSetupCompletedAt: new Date(), systemRole: "ADMIN" } });
    expect((await new GetCommercialContext().execute({ userId: u.id })).entitlements).toEqual([]);
    const internal = await prisma.plan.findUniqueOrThrow({ where: { code: "INTERNAL" } });
    await prisma.subscription.create({ data: { userId: u.id, planId: internal.id, status: "ACTIVE", billingProvider: "MANUAL", priceInCentsSnapshot: 0, currencySnapshot: "BRL" } });
    expect((await new GetCommercialContext().execute({ userId: u.id })).entitlements).toHaveLength(8);
  });
  it("creates a coach as PENDING/NONE, no paid entitlements, stores only token hash and snapshots price", async () => {
    const u = await user(),
      p = await plan(),
      i = await intent(p.code);
    expect(i.token).toHaveLength(43);
    const stored = await prisma.signupIntent.findUniqueOrThrow({
      where: { tokenHash: hashSignupToken(i.token) },
    });
    expect(JSON.stringify(stored)).not.toContain(i.token);
    expect(
      stored.expiresAt.getTime() - stored.createdAt.getTime(),
    ).toBeLessThanOrEqual(20 * 60 * 1000);
    await new CompleteSignup().execute({ userId: u.id, token: i.token });
    await prisma.plan.update({
      where: { id: p.id },
      data: { monthlyPriceInCents: 4990 },
    });
    expect(
      await new GetCommercialContext().execute({ userId: u.id }),
    ).toMatchObject({
      accountType: "COACH",
      systemRole: "USER",
      subscription: {
        status: "PENDING",
        billingProvider: "NONE",
        priceInCentsSnapshot: 3990,
      },
      entitlements: [],
    });
  });
  it("athlete signup is free ACTIVE/NONE and a second intent cannot convert initialized account", async () => {
    const u = await user(),
      i = await intent("ATHLETE_FREE", "ATHLETE");
    await new CompleteSignup().execute({ userId: u.id, token: i.token });
    expect(
      await new GetCommercialContext().execute({ userId: u.id }),
    ).toMatchObject({
      accountType: "ATHLETE",
      systemRole: "USER",
      subscription: {
        status: "ACTIVE",
        billingProvider: "NONE",
        priceInCentsSnapshot: 0,
      },
    });
    const p = await plan(),
      second = await intent(p.code);
    await expect(
      new CompleteSignup().execute({ userId: u.id, token: second.token }),
    ).rejects.toThrow("ACCOUNT_ALREADY_INITIALIZED");
  });
  it("serializes double completion and competing users consuming one token", async () => {
    const a = await user(),
      b = await user(),
      p = await plan(),
      i = await intent(p.code);
    const results = await Promise.allSettled(
      [a, a, b].map((u) =>
        new CompleteSignup().execute({ userId: u.id, token: i.token }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.subscription.count({
        where: { userId: { in: [a.id, b.id] } },
      }),
    ).toBe(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
  });
  it("serializes different intents for one user", async () => {
    const u = await user(),
      p = await plan(),
      one = await intent(p.code),
      two = await intent(p.code);
    const results = await Promise.allSettled(
      [one, two].map((i) =>
        new CompleteSignup().execute({ userId: u.id, token: i.token }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.signupIntent.count({
        where: {
          tokenHash: {
            in: [hashSignupToken(one.token), hashSignupToken(two.token)],
          },
          consumedAt: { not: null },
        },
      }),
    ).toBe(1);
  });
  it("rejects expired, consumed, unknown intents and rolls back all changes", async () => {
    const u = await user(),
      p = await plan(),
      i = await intent(p.code);
    await prisma.signupIntent.update({
      where: { tokenHash: hashSignupToken(i.token) },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      new CompleteSignup().execute({ userId: u.id, token: i.token }),
    ).rejects.toThrow("SIGNUP_INTENT_EXPIRED");
    await prisma.signupIntent.update({
      where: { tokenHash: hashSignupToken(i.token) },
      data: { consumedAt: new Date() },
    });
    await expect(
      new CompleteSignup().execute({ userId: u.id, token: i.token }),
    ).rejects.toThrow("SIGNUP_INTENT_CONSUMED");
    await expect(
      new CompleteSignup().execute({ userId: u.id, token: "x".repeat(43) }),
    ).rejects.toThrow("INVALID_SIGNUP_INTENT");
    expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(
      0,
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
        .accountSetupCompletedAt,
    ).toBeNull();
  });
  it.each([
    { isActive: false },
    { isPublic: false },
    { audience: "INTERNAL" as const },
  ])("revalidates plan at creation and completion %s", async (change) => {
    const u = await user(),
      p = await plan(),
      i = await intent(p.code);
    await prisma.plan.update({ where: { id: p.id }, data: change });
    await expect(
      new CreateSignupIntent().execute({
        accountType: "COACH",
        planCode: p.code,
      }),
    ).rejects.toThrow("INVALID_SIGNUP_PLAN");
    await expect(
      new CompleteSignup().execute({ userId: u.id, token: i.token }),
    ).rejects.toThrow("INVALID_SIGNUP_PLAN");
    expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(
      0,
    );
  });
  it("public listing excludes private/inactive/internal/wrong audience", async () => {
    const p = await plan();
    await plan({ isPublic: false });
    await plan({ isActive: false });
    await plan({ audience: "INTERNAL" });
    const result = await new ListPublicPlans().execute({ audience: "COACH" });
    expect(
      result.filter((r) => r.code.startsWith("test-")).map((r) => r.code),
    ).toEqual([p.code]);
    expect(result.every((r) => !("id" in r) && !("isActive" in r))).toBe(true);
  });
  it("resolver does not grant by ADMIN/COACH and preserves subscribers of inactive plans / real trial time", async () => {
    const u = await user(),
      p = await plan(),
      i = await intent(p.code);
    await new CompleteSignup().execute({ userId: u.id, token: i.token });
    await prisma.user.update({
      where: { id: u.id },
      data: { systemRole: "ADMIN" },
    });
    expect(
      (await new GetCommercialContext().execute({ userId: u.id })).entitlements,
    ).toEqual([]);
    for (const status of [
      "ACTIVE",
      "TRIALING",
      "PENDING",
      "PAST_DUE",
      "CANCELED",
      "EXPIRED",
    ] as const) {
      await prisma.subscription.update({
        where: { userId: u.id },
        data: { status, trialEndsAt: new Date(Date.now() + 60_000) },
      });
      expect(
        (await new GetCommercialContext().execute({ userId: u.id }))
          .entitlements.length,
      ).toBe(["ACTIVE", "TRIALING"].includes(status) ? 1 : 0);
    }
    await prisma.subscription.update({
      where: { userId: u.id },
      data: { status: "TRIALING", trialEndsAt: new Date(0) },
    });
    expect(
      (await new GetCommercialContext().execute({ userId: u.id })).entitlements,
    ).toEqual([]);
    await prisma.subscription.update({
      where: { userId: u.id },
      data: { status: "ACTIVE" },
    });
    await prisma.plan.update({
      where: { id: p.id },
      data: { isActive: false },
    });
    expect(
      (await new GetCommercialContext().execute({ userId: u.id })).entitlements,
    ).toEqual([{ key: "MANAGE_ATHLETES", limitValue: 5 }]);
  });
  it("HTTP uses authenticated identity and rejects privileged input", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(commercialRoutes);
    const a = await user(),
      b = await user(),
      p = await plan(),
      i = await intent(p.code);
    const spy = vi
      .spyOn(auth.api, "getSession")
      .mockResolvedValue({ user: a } as never);
    try {
      for (const payload of [
        { accountType: "COACH", planCode: p.code, systemRole: "ADMIN" },
        { accountType: "INTERNAL", planCode: "INTERNAL" },
      ]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/commercial/signup-intents",
              payload,
            })
          ).statusCode,
        ).toBe(400);
      }
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/account/complete-signup",
            payload: { token: i.token, userId: b.id },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/account/complete-signup",
            payload: { token: i.token },
          })
        ).statusCode,
      ).toBe(200);
      expect(await prisma.subscription.count({ where: { userId: b.id } })).toBe(
        0,
      );
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/account/commercial-context",
          })
        ).json(),
      ).toMatchObject({ accountType: "COACH", systemRole: "USER" });
      spy.mockResolvedValue(null);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/account/commercial-context",
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/account/complete-signup",
            payload: { token: i.token },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it("migration backfills old users, keeps future users incomplete and bootstrap preserves admin edits", async () => {
    const migration = await readFile(
      new URL(
        "../../prisma/migrations/20261007120000_identity_commercial_foundation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const bootstrap = await readFile(
      new URL("../../prisma/commercial-bootstrap.sql", import.meta.url),
      "utf8",
    );
    const rollback = new Error("ROLLBACK_FIXTURE");
    try {
      await prisma.$transaction(
        async (tx) => {
          const schema = `commercial_test_${crypto.randomUUID().replaceAll("-", "")}`;
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          await tx.$executeRawUnsafe(
            'CREATE TABLE "user" (id TEXT PRIMARY KEY)',
          );
          await tx.$executeRawUnsafe(
            "INSERT INTO \"user\" (id) VALUES ('old-user')",
          );
          for (const statement of migration
            .replace(/^BEGIN;/, "")
            .replace(/COMMIT;\s*$/, "")
            .split(";")
            .filter((s) => s.trim()))
            await tx.$executeRawUnsafe(statement);
          const old = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
            'SELECT * FROM "user"',
          );
          expect(old[0]).toMatchObject({
            accountType: "ATHLETE",
            systemRole: "USER",
          });
          expect(old[0].accountSetupCompletedAt).toBeInstanceOf(Date);
          expect(
            await tx.$queryRawUnsafe(
              'SELECT status, "billingProvider", "priceInCentsSnapshot" FROM "Subscription"',
            ),
          ).toEqual([
            {
              status: "ACTIVE",
              billingProvider: "NONE",
              priceInCentsSnapshot: 0,
            },
          ]);
          await tx.$executeRawUnsafe(
            "INSERT INTO \"user\" (id) VALUES ('new-user')",
          );
          expect(
            await tx.$queryRawUnsafe(
              'SELECT "accountSetupCompletedAt" FROM "user" WHERE id = \'new-user\'',
            ),
          ).toEqual([{ accountSetupCompletedAt: null }]);
          await tx.$executeRawUnsafe(
            'UPDATE "Plan" SET "monthlyPriceInCents" = 4990 WHERE code = \'COACH\'',
          );
          await tx.$executeRawUnsafe(
            "DELETE FROM \"PlanEntitlement\" WHERE \"planId\" = 'commercial-coach' AND entitlement = 'ADVANCED_STATS'",
          );
          await tx.$executeRawUnsafe(bootstrap);
          expect(
            await tx.$queryRawUnsafe(
              'SELECT "monthlyPriceInCents" FROM "Plan" WHERE code = \'COACH\'',
            ),
          ).toEqual([{ monthlyPriceInCents: 4990 }]);
          expect(
            await tx.$queryRawUnsafe(
              'SELECT count(*)::int AS count FROM "PlanEntitlement" WHERE "planId" = \'commercial-coach\'',
            ),
          ).toEqual([{ count: 4 }]);
          throw rollback;
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
