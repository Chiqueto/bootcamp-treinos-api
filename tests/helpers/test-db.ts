import { SetType, WeekDay } from "../../src/generated/prisma/enums.js";
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

export async function createTestExercise(override?: {
  id?: string;
  name?: string;
  ownerUserId?: string | null;
}) {
  return prisma.exercise.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      name: override?.name ?? "Supino Reto",
      ownerUserId: override?.ownerUserId ?? null,
    },
  });
}

export async function createTestWorkoutExercise(
  workoutDayId: string,
  override?: {
    id?: string;
    name?: string;
    order?: number;
    sets?: number;
    reps?: number;
    restTimeInSeconds?: number;
    exerciseId?: string | null;
  },
) {
  return prisma.workoutExercise.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      workoutDayId,
      name: override?.name ?? "Exercício Teste",
      order: override?.order ?? 0,
      sets: override?.sets ?? 3,
      reps: override?.reps ?? 10,
      restTimeInSeconds: override?.restTimeInSeconds ?? 60,
      exerciseId: override?.exerciseId ?? null,
    },
  });
}

export async function createTestWorkoutSession(
  workoutDayId: string,
  override?: {
    id?: string;
    athleteId?: string;
    startedAt?: Date;
    completedAt?: Date | null;
  },
) {
  let athleteId = override?.athleteId;
  if (!athleteId) {
    const day = await prisma.workoutDay.findUnique({
      where: { id: workoutDayId },
      include: { workoutPlan: true },
    });
    athleteId = day?.workoutPlan.userId;
  }

  if (!athleteId) {
    throw new Error(
      `Não foi possível determinar athleteId para o workoutDayId: ${workoutDayId}`
    );
  }

  return prisma.workoutSession.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      workoutDayId,
      athleteId,
      startedAt: override?.startedAt ?? new Date(),
      completedAt: override?.completedAt !== undefined ? override.completedAt : null,
    },
  });
}

export async function createTestSessionExercise(
  workoutSessionId: string,
  override?: {
    id?: string;
    exerciseNameSnapshot?: string;
    order?: number;
    plannedSets?: number | null;
    plannedReps?: number | null;
    plannedRestTimeInSeconds?: number | null;
    exerciseId?: string | null;
    notes?: string | null;
  },
) {
  return prisma.sessionExercise.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      workoutSessionId,
      exerciseNameSnapshot: override?.exerciseNameSnapshot ?? "Supino Reto",
      order: override?.order ?? 1,
      plannedSets: override?.plannedSets ?? 3,
      plannedReps: override?.plannedReps ?? 10,
      plannedRestTimeInSeconds: override?.plannedRestTimeInSeconds ?? 60,
      exerciseId: override?.exerciseId ?? null,
      notes: override?.notes ?? null,
    },
  });
}

export async function createTestWorkoutSet(
  sessionExerciseId: string,
  override?: {
    id?: string;
    order?: number;
    type?: SetType;
    weightInGrams?: number | null;
    reps?: number | null;
    rir?: number | null;
    durationInSeconds?: number | null;
    notes?: string | null;
    completedAt?: Date | null;
  },
) {
  return prisma.workoutSet.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      sessionExerciseId,
      order: override?.order ?? 1,
      type: override?.type ?? SetType.WORKING,
      weightInGrams: override?.weightInGrams ?? null,
      reps: override?.reps ?? null,
      rir: override?.rir ?? null,
      durationInSeconds: override?.durationInSeconds ?? null,
      notes: override?.notes ?? null,
      completedAt: override?.completedAt ?? null,
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
        where: {
          OR: [{ workoutDayId: { in: dayIds } }, { athleteId: { in: userIds } }],
        },
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

  // 6. Delete custom exercises
  await prisma.exercise.deleteMany({
    where: { ownerUserId: { in: userIds } },
  });

  // 7. Delete users
  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}
