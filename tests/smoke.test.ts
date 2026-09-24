import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/db.js";
import {
  cleanupTestUsers,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
  createTestWorkoutSession,
} from "./helpers/test-db.js";

describe("Test Infrastructure Smoke Test", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  it("should connect exclusively to the dedicated test database (TEST_DATABASE_URL)", async () => {
    const { getDatabaseUrl } = await import("../src/lib/db.js");
    const { env } = await import("../src/lib/env.js");

    expect(getDatabaseUrl()).toBe(env.TEST_DATABASE_URL);
    expect(getDatabaseUrl()).not.toBe(env.DATABASE_URL);

    const result = await prisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database();
    `;

    expect(result[0]?.current_database).toBeDefined();
  });

  it("should connect to the test database and perform basic queries", async () => {
    const user = await createTestUser({ name: "Smoke User" });
    createdUserIds.push(user.id);

    expect(user.id).toBeDefined();
    expect(user.name).toBe("Smoke User");

    const found = await prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(found).not.toBeNull();
    expect(found?.email).toBe(user.email);
  });

  it("should create related plan, day, and session and cleanup cleanly", async () => {
    const user = await createTestUser({ name: "Smoke Integration User" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Teste" });
    const day = await createTestWorkoutDay(plan.id, { name: "Treino Teste" });
    const session = await createTestWorkoutSession(day.id);

    expect(session.id).toBeDefined();
    expect(session.workoutDayId).toBe(day.id);
    expect(session.completedAt).toBeNull();

    // Verify it is queryable through the relation
    const foundSession = await prisma.workoutSession.findUnique({
      where: { id: session.id },
      include: {
        workoutDay: {
          include: {
            workoutPlan: true,
          },
        },
      },
    });

    expect(foundSession?.workoutDay.workoutPlan.userId).toBe(user.id);
  });
});
