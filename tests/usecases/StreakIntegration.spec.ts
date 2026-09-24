import { afterEach, describe, expect, it } from "vitest";

import { WeekDay } from "../../src/generated/prisma/enums.js";
import { GetHomeData } from "../../src/usecases/GetHomeData.js";
import { GetStats } from "../../src/usecases/GetStats.js";
import {
  cleanupTestUsers,
  createTestUser,
  createTestWorkoutDay,
  createTestWorkoutPlan,
  createTestWorkoutSession,
} from "../helpers/test-db.js";

describe("Streak Parity Integration Tests: GetHomeData vs GetStats", () => {
  const createdUserIds: string[] = [];
  const getHomeData = new GetHomeData();
  const getStats = new GetStats();

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  it("GetHomeData e GetStats produzem exatamente o mesmo streak com treinos e descanso intercalados", async () => {
    const user = await createTestUser({ name: "Usuário Paridade Streak" });
    createdUserIds.push(user.id);

    const plan = await createTestWorkoutPlan(user.id, { name: "Plano Paridade", isActive: true });

    // Seg: Treino, Ter: Descanso, Qua: Treino
    const dayMon = await createTestWorkoutDay(plan.id, {
      name: "Segunda Treino",
      weekDay: WeekDay.MONDAY,
      isRest: false,
    });
    await createTestWorkoutDay(plan.id, {
      name: "Terça Descanso",
      weekDay: WeekDay.TUESDAY,
      isRest: true,
      estimatedDurationInSeconds: 0,
    });
    const dayWed = await createTestWorkoutDay(plan.id, {
      name: "Quarta Treino",
      weekDay: WeekDay.WEDNESDAY,
      isRest: false,
    });

    // Simula data atual = Quarta (2026-03-11)
    const testDate = "2026-03-11";

    // Sessão concluída na Segunda (2026-03-09)
    await createTestWorkoutSession(dayMon.id, {
      startedAt: new Date("2026-03-09T10:00:00Z"),
      completedAt: new Date("2026-03-09T11:00:00Z"),
    });

    // Sessão concluída na Quarta (2026-03-11)
    await createTestWorkoutSession(dayWed.id, {
      startedAt: new Date("2026-03-11T10:00:00Z"),
      completedAt: new Date("2026-03-11T11:00:00Z"),
    });

    // Chama GetHomeData
    const homeResult = await getHomeData.execute({
      userId: user.id,
      date: testDate,
      timezoneOffset: 0,
    });

    // Chama GetStats
    const statsResult = await getStats.execute({
      userId: user.id,
      from: "2026-03-01",
      to: testDate,
      timezoneOffset: 0,
    });

    // Validar paridade exata
    expect(homeResult.workoutStreak).toBe(2);
    expect(statsResult.workoutStreak).toBe(2);
    expect(homeResult.workoutStreak).toBe(statsResult.workoutStreak);
  });
});
