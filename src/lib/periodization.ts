import { ActiveWorkoutSessionError } from "../errors/index.js";
import { prisma } from "./db.js";

export function derivePeriodizationStatus(periodization: {
  isActive: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
}): "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" {
  if (periodization.completedAt !== null) {
    return "COMPLETED";
  }
  if (periodization.isActive) {
    return "ACTIVE";
  }
  if (periodization.startedAt !== null) {
    return "PAUSED";
  }
  return "DRAFT";
}

export interface PeriodizationCurrentBlockDto {
  id: string;
  order: number;
  workoutPlanId: string;
  workoutPlanName: string;
  activatedAt: string;
}

export interface PeriodizationLifecycleDto {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  startedAt: string | null;
  completedAt: string | null;
  currentBlock: PeriodizationCurrentBlockDto | null;
}

export function formatPeriodizationLifecycleResponse(periodization: {
  id: string;
  name: string;
  isActive: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  plans?: Array<{
    id: string;
    order: number;
    workoutPlanId: string;
    activatedAt: Date | null;
    completedAt: Date | null;
    workoutPlan: {
      name: string;
    };
  }>;
}): PeriodizationLifecycleDto {
  const status = derivePeriodizationStatus(periodization);

  let currentBlock: PeriodizationCurrentBlockDto | null = null;
  if (status !== "COMPLETED" && periodization.plans) {
    const openBlock = periodization.plans.find(
      (p) => p.activatedAt !== null && p.completedAt === null,
    );
    if (openBlock && openBlock.activatedAt) {
      currentBlock = {
        id: openBlock.id,
        order: openBlock.order,
        workoutPlanId: openBlock.workoutPlanId,
        workoutPlanName: openBlock.workoutPlan.name,
        activatedAt: openBlock.activatedAt.toISOString(),
      };
    }
  }

  return {
    id: periodization.id,
    name: periodization.name,
    status,
    startedAt: periodization.startedAt
      ? periodization.startedAt.toISOString()
      : null,
    completedAt: periodization.completedAt
      ? periodization.completedAt.toISOString()
      : null,
    currentBlock,
  };
}

export async function assertNoActiveWorkoutSession(
  tx: { workoutSession: { findFirst: typeof prisma.workoutSession.findFirst } },
  athleteId: string,
) {
  const activeSession = await tx.workoutSession.findFirst({
    where: {
      athleteId,
      completedAt: null,
    },
  });

  if (activeSession) {
    throw new ActiveWorkoutSessionError();
  }
}
