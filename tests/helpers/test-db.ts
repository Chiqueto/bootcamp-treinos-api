import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";

export async function createTestUser(override?: {
  id?: string;
  name?: string;
  email?: string;
}) {
  const uniqueId = crypto.randomUUID();
  return prisma.user.create({
    data: {
      id: override?.id ?? uniqueId,
      name: override?.name ?? `Test User ${uniqueId.slice(0, 8)}`,
      email: override?.email ?? `test-${uniqueId}@fitai.test`,
    },
  });
}

export async function createTestWorkoutPlan(
  userId: string,
  override?: {
    id?: string;
    name?: string;
    isActive?: boolean;
  },
) {
  return prisma.workoutPlan.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      name: override?.name ?? "Plano de Teste",
      userId,
      isActive: override?.isActive ?? true,
    },
  });
}

export async function createTestWorkoutDay(
  workoutPlanId: string,
  override?: {
    id?: string;
    name?: string;
    weekDay?: WeekDay;
    isRest?: boolean;
    estimatedDurationInSeconds?: number;
  },
) {
  return prisma.workoutDay.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      name: override?.name ?? "Treino A",
      workoutPlanId,
      weekDay: override?.weekDay ?? WeekDay.MONDAY,
      isRest: override?.isRest ?? false,
      estimatedDurationInSeconds: override?.estimatedDurationInSeconds ?? 3600,
    },
  });
}

export async function createTestWorkoutSession(
  workoutDayId: string,
  override?: {
    id?: string;
    startedAt?: Date;
    completedAt?: Date | null;
  },
) {
  return prisma.workoutSession.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      workoutDayId,
      startedAt: override?.startedAt ?? new Date(),
      completedAt: override?.completedAt !== undefined ? override.completedAt : null,
    },
  });
}

export async function cleanupTestUsers(userIds: string[]) {
  if (userIds.length === 0) return;

  // 1. Find all plans of these users
  const plans = await prisma.workoutPlan.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const planIds = plans.map((p) => p.id);

  if (planIds.length > 0) {
    // 2. Find all days of these plans
    const days = await prisma.workoutDay.findMany({
      where: { workoutPlanId: { in: planIds } },
      select: { id: true },
    });
    const dayIds = days.map((d) => d.id);

    if (dayIds.length > 0) {
      // 3. Delete sessions and exercises
      await prisma.workoutSession.deleteMany({
        where: { workoutDayId: { in: dayIds } },
      });
      await prisma.workoutExercise.deleteMany({
        where: { workoutDayId: { in: dayIds } },
      });
      // 4. Delete days
      await prisma.workoutDay.deleteMany({
        where: { id: { in: dayIds } },
      });
    }

    // 5. Delete plans
    await prisma.workoutPlan.deleteMany({
      where: { id: { in: planIds } },
    });
  }

  // 6. Delete users
  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}
