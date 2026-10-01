import { SetType, WeekDay, WorkoutSessionOrigin } from "../../src/generated/prisma/enums.js";
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
    coverImageUrl?: string | null;
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
      coverImageUrl: override?.coverImageUrl ?? null,
    },
  });
}

export async function createTestPeriodization(
  userId: string,
  override?: {
    id?: string;
    name?: string;
    goal?: string | null;
    notes?: string | null;
    isActive?: boolean;
    startedAt?: Date | null;
    completedAt?: Date | null;
  },
) {
  return prisma.periodization.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      userId,
      name: override?.name ?? "Periodização Teste",
      goal: override?.goal ?? "Hipertrofia e Força",
      notes: override?.notes ?? null,
      isActive: override?.isActive ?? false,
      startedAt: override?.startedAt ?? null,
      completedAt: override?.completedAt ?? null,
    },
  });
}

export async function createTestPeriodizationPlan(
  periodizationId: string,
  workoutPlanId: string,
  override?: {
    id?: string;
    order?: number;
    plannedStartDate?: Date | null;
    plannedEndDate?: Date | null;
    activatedAt?: Date | null;
    completedAt?: Date | null;
    notes?: string | null;
  },
) {
  return prisma.periodizationPlan.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      periodizationId,
      workoutPlanId,
      order: override?.order ?? 1,
      plannedStartDate: override?.plannedStartDate ?? null,
      plannedEndDate: override?.plannedEndDate ?? null,
      activatedAt: override?.activatedAt ?? null,
      completedAt: override?.completedAt ?? null,
      notes: override?.notes ?? null,
    },
  });
}

export const createdTestExerciseIds: string[] = [];

export async function createTestExercise(override?: {
  id?: string;
  name?: string;
  ownerUserId?: string | null;
}) {
  const uid = crypto.randomUUID().slice(0, 8);
  const name = override?.name ?? `Supino Reto ${uid}`;
  const ownerUserId = override?.ownerUserId ?? null;

  if (ownerUserId === null) {
    const existing = await prisma.exercise.findFirst({
      where: {
        ownerUserId: null,
        name: { equals: name, mode: "insensitive" },
      },
    });
    if (existing) {
      return existing;
    }
  }

  const exercise = await prisma.exercise.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      name,
      ownerUserId,
    },
  });
  createdTestExerciseIds.push(exercise.id);
  return exercise;
}

export async function cleanupTestExercises(exerciseIds: string[]) {
  if (exerciseIds.length === 0) return;
  await prisma.sessionExercise.deleteMany({
    where: { exerciseId: { in: exerciseIds } },
  });
  await prisma.workoutExercise.deleteMany({
    where: { exerciseId: { in: exerciseIds } },
  });
  await prisma.exercise.deleteMany({
    where: {
      id: { in: exerciseIds },
      ownerUserId: { not: null },
    },
  });
}

export async function createTestWorkoutExercise(
  workoutDayId: string,
  override?: {
    id?: string;
    name?: string;
    order?: number;
    warmupSets?: number;
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
      warmupSets: override?.warmupSets ?? 0,
      sets: override?.sets ?? 3,
      reps: override?.reps ?? 10,
      restTimeInSeconds: override?.restTimeInSeconds ?? 60,
      exerciseId: override?.exerciseId ?? null,
    },
  });
}

export async function createTestWorkoutSession(
  workoutDayId: string | null,
  override?: {
    id?: string;
    athleteId?: string;
    startedAt?: Date;
    completedAt?: Date | null;
    origin?: WorkoutSessionOrigin;
    workoutPlanId?: string | null;
    workoutPlanNameSnapshot?: string | null;
    workoutDayNameSnapshot?: string | null;
  },
) {
  let athleteId = override?.athleteId;
  let workoutPlanId = override?.workoutPlanId;
  let workoutPlanNameSnapshot = override?.workoutPlanNameSnapshot;
  let workoutDayNameSnapshot = override?.workoutDayNameSnapshot;

  if (
    workoutDayId &&
    (!athleteId ||
      workoutPlanId === undefined ||
      workoutPlanNameSnapshot === undefined ||
      workoutDayNameSnapshot === undefined)
  ) {
    const day = await prisma.workoutDay.findUnique({
      where: { id: workoutDayId },
      include: { workoutPlan: true },
    });
    if (!athleteId) athleteId = day?.workoutPlan.userId;
    if (workoutPlanId === undefined) workoutPlanId = day?.workoutPlanId ?? null;
    if (workoutPlanNameSnapshot === undefined) workoutPlanNameSnapshot = day?.workoutPlan.name ?? null;
    if (workoutDayNameSnapshot === undefined) workoutDayNameSnapshot = day?.name ?? null;
  }

  if (!athleteId) {
    throw new Error(
      `Não foi possível determinar athleteId para a sessão de teste`
    );
  }

  const origin =
    override?.origin ??
    (workoutDayId ? WorkoutSessionOrigin.PLANNED : WorkoutSessionOrigin.FREE);

  return prisma.workoutSession.create({
    data: {
      id: override?.id ?? crypto.randomUUID(),
      workoutDayId,
      athleteId,
      origin,
      workoutPlanId: workoutPlanId ?? null,
      workoutPlanNameSnapshot: workoutPlanNameSnapshot ?? null,
      workoutDayNameSnapshot: workoutDayNameSnapshot ?? null,
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

    // 5. Delete periodization plans and periodizations before deleting workout plans (due to Restrict)
    await prisma.periodizationPlan.deleteMany({
      where: {
        OR: [
          { periodization: { userId: { in: userIds } } },
          { workoutPlanId: { in: planIds } },
        ],
      },
    });
    await prisma.periodization.deleteMany({
      where: { userId: { in: userIds } },
    });

    // 6. Delete plans
    await prisma.workoutPlan.deleteMany({
      where: { id: { in: planIds } },
    });
  } else {
    await prisma.periodization.deleteMany({
      where: { userId: { in: userIds } },
    });
  }

  // 6. Delete custom exercises and tracked test exercises
  if (createdTestExerciseIds.length > 0) {
    const exIds = [...createdTestExerciseIds];
    createdTestExerciseIds.length = 0;
    await cleanupTestExercises(exIds);
  }

  await prisma.exercise.deleteMany({
    where: { ownerUserId: { in: userIds } },
  });

  // 7. Delete users
  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}
