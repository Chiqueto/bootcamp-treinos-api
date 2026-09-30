import { InconsistentPlanningStateError } from "../errors/index.js";
import { prisma } from "../lib/db.js";
import { derivePeriodizationStatus } from "../lib/periodization.js";

interface InputDto {
  userId: string;
}

export interface PlanningWorkoutPlanSummaryDto {
  id: string;
  name: string;
  isActive: boolean;
  workoutDaysCount: number;
  createdAt: string;
  periodization: {
    id: string;
    name: string;
    periodizationPlanId: string;
    order: number;
    status: "PLANNED" | "ACTIVE" | "COMPLETED";
  } | null;
}

export interface PlanningPeriodizationBlockSummaryDto {
  id: string;
  order: number;
  workoutPlanId: string;
  workoutPlanName: string;
  activatedAt: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

export interface PlanningPeriodizationSummaryDto {
  id: string;
  name: string;
  goal: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  isActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  totalBlocks: number;
  completedBlocks: number;
  currentBlock: PlanningPeriodizationBlockSummaryDto | null;
  createdAt: string;
}

export type ActiveContextDto =
  | {
      type: "NONE";
    }
  | {
      type: "STANDALONE_PLAN";
      plan: {
        id: string;
        name: string;
        workoutDaysCount: number;
        createdAt: string;
      };
    }
  | {
      type: "PERIODIZATION";
      periodization: {
        id: string;
        name: string;
        goal: string | null;
        startedAt: string | null;
        currentBlock: PlanningPeriodizationBlockSummaryDto;
        totalBlocks: number;
        completedBlocks: number;
      };
    };

export interface PlanningOverviewOutputDto {
  activeContext: ActiveContextDto;
  plans: PlanningWorkoutPlanSummaryDto[];
  periodizations: PlanningPeriodizationSummaryDto[];
}

function formatDateToYYYYMMDD(date: Date | string | null): string | null {
  if (!date) return null;
  if (typeof date === "string") {
    return date.split("T")[0];
  }
  return date.toISOString().split("T")[0];
}

export class GetPlanningOverview {
  async execute(dto: InputDto): Promise<PlanningOverviewOutputDto> {
    // Busca agregada sem N+1
    const [rawWorkoutPlans, rawPeriodizations] = await Promise.all([
      prisma.workoutPlan.findMany({
        where: {
          userId: dto.userId,
        },
        include: {
          _count: {
            select: {
              workoutDays: true,
            },
          },
          periodizationPlan: {
            include: {
              periodization: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
      prisma.periodization.findMany({
        where: {
          userId: dto.userId,
        },
        include: {
          plans: {
            orderBy: {
              order: "asc",
            },
            include: {
              workoutPlan: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // 1. Processa Lista de WorkoutPlans
    const plans: PlanningWorkoutPlanSummaryDto[] = rawWorkoutPlans.map((wp) => {
      let periodizationContext: PlanningWorkoutPlanSummaryDto["periodization"] =
        null;

      if (wp.periodizationPlan) {
        let blockStatus: "PLANNED" | "ACTIVE" | "COMPLETED" = "PLANNED";
        if (wp.periodizationPlan.completedAt !== null) {
          blockStatus = "COMPLETED";
        } else if (wp.periodizationPlan.activatedAt !== null) {
          blockStatus = "ACTIVE";
        }

        periodizationContext = {
          id: wp.periodizationPlan.periodization.id,
          name: wp.periodizationPlan.periodization.name,
          periodizationPlanId: wp.periodizationPlan.id,
          order: wp.periodizationPlan.order,
          status: blockStatus,
        };
      }

      return {
        id: wp.id,
        name: wp.name,
        isActive: wp.isActive,
        workoutDaysCount: wp._count.workoutDays,
        createdAt: wp.createdAt.toISOString(),
        periodization: periodizationContext,
      };
    });

    // Ordenação determinística de planos: ativo primeiro, depois createdAt DESC
    plans.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // 2. Processa Lista de Periodizations
    const periodizations: PlanningPeriodizationSummaryDto[] =
      rawPeriodizations.map((p) => {
        const status = derivePeriodizationStatus(p);
        const totalBlocks = p.plans.length;
        const completedBlocks = p.plans.filter(
          (plan) => plan.completedAt !== null,
        ).length;

        // Bloco aberto: mesmo em periodização PAUSED, identifica o bloco aberto atual
        let currentBlock: PlanningPeriodizationBlockSummaryDto | null = null;
        if (status !== "COMPLETED") {
          const openBlock = p.plans.find(
            (plan) => plan.activatedAt !== null && plan.completedAt === null,
          );

          if (openBlock && openBlock.activatedAt) {
            currentBlock = {
              id: openBlock.id,
              order: openBlock.order,
              workoutPlanId: openBlock.workoutPlanId,
              workoutPlanName: openBlock.workoutPlan.name,
              activatedAt: openBlock.activatedAt.toISOString(),
              plannedStartDate: formatDateToYYYYMMDD(openBlock.plannedStartDate),
              plannedEndDate: formatDateToYYYYMMDD(openBlock.plannedEndDate),
            };
          }
        }

        return {
          id: p.id,
          name: p.name,
          goal: p.goal,
          status,
          isActive: p.isActive,
          startedAt: p.startedAt ? p.startedAt.toISOString() : null,
          completedAt: p.completedAt ? p.completedAt.toISOString() : null,
          totalBlocks,
          completedBlocks,
          currentBlock,
          createdAt: p.createdAt.toISOString(),
        };
      });

    // Ordenação determinística de periodizações: ACTIVE > PAUSED > DRAFT > COMPLETED, depois createdAt DESC
    const statusPriority: Record<string, number> = {
      ACTIVE: 1,
      PAUSED: 2,
      DRAFT: 3,
      COMPLETED: 4,
    };

    periodizations.sort((a, b) => {
      const prioA = statusPriority[a.status] ?? 99;
      const prioB = statusPriority[b.status] ?? 99;
      if (prioA !== prioB) return prioA - prioB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // 3. Determina e valida o Active Context
    let activeContext: ActiveContextDto = { type: "NONE" };

    const activePeriodizations = rawPeriodizations.filter((p) => p.isActive);
    if (activePeriodizations.length > 1) {
      console.error(
        `[GetPlanningOverview] Inconsistent state for user ${dto.userId}: multiple active periodizations found (${activePeriodizations.length}).`,
      );
      throw new InconsistentPlanningStateError();
    }

    const activePeriodization = activePeriodizations[0];
    const activeWorkoutPlans = rawWorkoutPlans.filter((wp) => wp.isActive);

    if (activePeriodization) {
      // Quando existir Periodization.isActive = true:
      // a) existe exatamente um bloco aberto (activatedAt != null && completedAt == null)
      const openBlocks = activePeriodization.plans.filter(
        (plan) => plan.activatedAt !== null && plan.completedAt === null,
      );

      const openPeriodizationPlan = openBlocks[0];

      if (openBlocks.length !== 1 || !openPeriodizationPlan || !openPeriodizationPlan.activatedAt) {
        console.error(
          `[GetPlanningOverview] Inconsistent state for user ${dto.userId}: active periodization ${activePeriodization.id} has ${openBlocks.length} open blocks (expected 1).`,
        );
        throw new InconsistentPlanningStateError();
      }

      // b) existe exatamente um WorkoutPlan ativo do usuário
      if (activeWorkoutPlans.length !== 1) {
        console.error(
          `[GetPlanningOverview] Inconsistent state for user ${dto.userId}: user has ${activeWorkoutPlans.length} active workout plans while periodization is active (expected 1).`,
        );
        throw new InconsistentPlanningStateError();
      }

      // c) activeWorkoutPlan.id === openPeriodizationPlan.workoutPlanId
      const activeWorkoutPlan = activeWorkoutPlans[0];
      if (activeWorkoutPlan.id !== openPeriodizationPlan.workoutPlanId) {
        console.error(
          `[GetPlanningOverview] Inconsistent state for user ${dto.userId}: active workout plan id (${activeWorkoutPlan.id}) does not match open block workoutPlanId (${openPeriodizationPlan.workoutPlanId}).`,
        );
        throw new InconsistentPlanningStateError();
      }

      const totalBlocks = activePeriodization.plans.length;
      const completedBlocks = activePeriodization.plans.filter(
        (plan) => plan.completedAt !== null,
      ).length;

      activeContext = {
        type: "PERIODIZATION",
        periodization: {
          id: activePeriodization.id,
          name: activePeriodization.name,
          goal: activePeriodization.goal,
          startedAt: activePeriodization.startedAt
            ? activePeriodization.startedAt.toISOString()
            : null,
          currentBlock: {
            id: openPeriodizationPlan.id,
            order: openPeriodizationPlan.order,
            workoutPlanId: openPeriodizationPlan.workoutPlanId,
            workoutPlanName: openPeriodizationPlan.workoutPlan.name,
            activatedAt: openPeriodizationPlan.activatedAt.toISOString(),
            plannedStartDate: formatDateToYYYYMMDD(openPeriodizationPlan.plannedStartDate),
            plannedEndDate: formatDateToYYYYMMDD(openPeriodizationPlan.plannedEndDate),
          },
          totalBlocks,
          completedBlocks,
        },
      };
    } else {
      // Se NÃO existir Periodization.isActive = true:
      if (activeWorkoutPlans.length === 0) {
        activeContext = { type: "NONE" };
      } else if (activeWorkoutPlans.length === 1) {
        const activePlan = activeWorkoutPlans[0];

        // Se esse plano possuir PeriodizationPlan, é estado inconsistente
        if (activePlan.periodizationPlan !== null) {
          console.error(
            `[GetPlanningOverview] Inconsistent state for user ${dto.userId}: active workout plan ${activePlan.id} belongs to a periodization (${activePlan.periodizationPlan.periodizationId}), but no periodization is active.`,
          );
          throw new InconsistentPlanningStateError();
        }

        activeContext = {
          type: "STANDALONE_PLAN",
          plan: {
            id: activePlan.id,
            name: activePlan.name,
            workoutDaysCount: activePlan._count.workoutDays,
            createdAt: activePlan.createdAt.toISOString(),
          },
        };
      } else {
        // Múltiplos planos ativos sem periodização ativa é inconsistência
        console.error(
          `[GetPlanningOverview] Inconsistent state for user ${dto.userId}: multiple active workout plans found (${activeWorkoutPlans.length}) without active periodization.`,
        );
        throw new InconsistentPlanningStateError();
      }
    }

    return {
      activeContext,
      plans,
      periodizations,
    };
  }
}
