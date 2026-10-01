import { resolveCanonicalExerciseMap } from "../domain/canonical-exercise.js";
import { ValidationError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

export interface CreatePeriodizationDraftFromAIInput {
  userId: string;
  name: string;
  goal?: string | null;
  notes?: string | null;
  blocks: Array<{
    plan: {
      name: string;
      workoutDays: Array<{
        name: string;
        weekDay: WeekDay;
        isRest: boolean;
        estimatedDurationInSeconds: number;
        coverImageUrl?: string | null;
        exercises: Array<{
          order: number;
          name: string;
          warmupSets?: number;
          sets: number;
          reps: number;
          restTimeInSeconds: number;
        }>;
      }>;
    };
    plannedStartDate?: string | null;
    plannedEndDate?: string | null;
    notes?: string | null;
  }>;
}

export interface CreatePeriodizationDraftFromAIOutput {
  id: string;
  name: string;
  goal: string | null;
  notes: string | null;
  isActive: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  status: "DRAFT";
  blocks: Array<{
    id: string;
    order: number;
    workoutPlanId: string;
    workoutPlanName: string;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    notes: string | null;
    activatedAt: string | null;
    completedAt: string | null;
  }>;
}

const ALL_WEEK_DAYS: WeekDay[] = [
  WeekDay.MONDAY,
  WeekDay.TUESDAY,
  WeekDay.WEDNESDAY,
  WeekDay.THURSDAY,
  WeekDay.FRIDAY,
  WeekDay.SATURDAY,
  WeekDay.SUNDAY,
];

export class CreatePeriodizationDraftFromAI {
  async execute(
    dto: CreatePeriodizationDraftFromAIInput,
  ): Promise<CreatePeriodizationDraftFromAIOutput> {
    const trimmedName = dto.name?.trim();
    if (!trimmedName) {
      throw new ValidationError("O nome da periodização é obrigatório.");
    }

    if (!dto.blocks || !Array.isArray(dto.blocks) || dto.blocks.length === 0) {
      throw new ValidationError(
        "A periodização deve conter pelo menos um bloco de treino.",
      );
    }

    for (let i = 0; i < dto.blocks.length; i++) {
      const block = dto.blocks[i];
      const planName = block.plan?.name?.trim();
      if (!planName) {
        throw new ValidationError(
          `O nome do plano do bloco ${i + 1} é obrigatório.`,
        );
      }

      if (!block.plan.workoutDays || block.plan.workoutDays.length !== 7) {
        throw new ValidationError(
          `O plano do bloco ${i + 1} deve conter exatamente 7 dias.`,
        );
      }

      const weekdays = block.plan.workoutDays.map((d) => d.weekDay);
      const uniqueWeekdays = new Set(weekdays);
      if (
        uniqueWeekdays.size !== 7 ||
        !ALL_WEEK_DAYS.every((wd) => uniqueWeekdays.has(wd))
      ) {
        throw new ValidationError(
          `O plano do bloco ${i + 1} deve conter todos os 7 dias da semana (MONDAY a SUNDAY) sem repetição.`,
        );
      }

      const startDate = block.plannedStartDate
        ? new Date(block.plannedStartDate)
        : null;
      const endDate = block.plannedEndDate
        ? new Date(block.plannedEndDate)
        : null;

      if (startDate && isNaN(startDate.getTime())) {
        throw new ValidationError(
          `Data de início prevista do bloco ${i + 1} inválida.`,
        );
      }
      if (endDate && isNaN(endDate.getTime())) {
        throw new ValidationError(
          `Data de término prevista do bloco ${i + 1} inválida.`,
        );
      }
      if (startDate && endDate && endDate < startDate) {
        throw new ValidationError(
          `A data de término prevista do bloco ${i + 1} não pode ser anterior à data de início.`,
        );
      }

      for (const day of block.plan.workoutDays) {
        if (!day.name?.trim()) {
          throw new ValidationError(
            `O nome do dia de treino (${day.weekDay}) no bloco ${i + 1} é obrigatório.`,
          );
        }
        if (day.isRest) {
          if (day.exercises && day.exercises.length > 0) {
            throw new ValidationError(
              `Dias de descanso não devem conter exercícios (bloco ${i + 1}, ${day.weekDay}).`,
            );
          }
        } else {
          if (!day.exercises || day.exercises.length === 0) {
            throw new ValidationError(
              `Dias de treino devem conter pelo menos um exercício (bloco ${i + 1}, ${day.weekDay}).`,
            );
          }
          for (const ex of day.exercises) {
            if (!ex.name?.trim()) {
              throw new ValidationError(
                `Nome do exercício é obrigatório (bloco ${i + 1}, ${day.weekDay}).`,
              );
            }
            if (
              ex.sets < 1 ||
              ex.reps < 1 ||
              ex.restTimeInSeconds < 0 ||
              (ex.warmupSets !== undefined &&
                (ex.warmupSets < 0 || !Number.isInteger(ex.warmupSets)))
            ) {
              throw new ValidationError(
                `Valores de séries, repetições, descanso ou aquecimento inválidos no exercício ${ex.name}.`,
              );
            }
          }
        }
      }
    }

    return await prisma.$transaction(async (tx) => {
      const periodization = await tx.periodization.create({
        data: {
          id: crypto.randomUUID(),
          userId: dto.userId,
          name: trimmedName,
          goal: dto.goal?.trim() || null,
          notes: dto.notes?.trim() || null,
          isActive: false,
          startedAt: null,
          completedAt: null,
        },
      });

      const allExerciseNames = dto.blocks.flatMap((b) =>
        b.plan.workoutDays.flatMap((wd) => wd.exercises.map((e) => e.name)),
      );
      const canonicalExerciseMap = await resolveCanonicalExerciseMap({
        userId: dto.userId,
        names: allExerciseNames,
        tx,
      });

      const createdBlocks = [];

      for (let i = 0; i < dto.blocks.length; i++) {
        const block = dto.blocks[i];
        const order = i + 1;

        const workoutPlan = await tx.workoutPlan.create({
          data: {
            id: crypto.randomUUID(),
            userId: dto.userId,
            name: block.plan.name.trim(),
            isActive: false,
            workoutDays: {
              create: block.plan.workoutDays.map((wd) => ({
                id: crypto.randomUUID(),
                name: wd.name.trim(),
                weekDay: wd.weekDay,
                isRest: wd.isRest,
                estimatedDurationInSeconds: wd.estimatedDurationInSeconds,
                coverImageUrl: wd.coverImageUrl || null,
                exercises: {
                  create: wd.exercises.map((ex) => ({
                    id: crypto.randomUUID(),
                    name: ex.name.trim(),
                    order: ex.order,
                    warmupSets: ex.warmupSets ?? 0,
                    sets: ex.sets,
                    reps: ex.reps,
                    restTimeInSeconds: ex.restTimeInSeconds,
                    exerciseId:
                      canonicalExerciseMap.get(ex.name.trim()) ??
                      canonicalExerciseMap.get(ex.name) ??
                      null,
                  })),
                },
              })),
            },
          },
        });

        const periodizationPlan = await tx.periodizationPlan.create({
          data: {
            id: crypto.randomUUID(),
            periodizationId: periodization.id,
            workoutPlanId: workoutPlan.id,
            order,
            plannedStartDate: block.plannedStartDate
              ? new Date(block.plannedStartDate)
              : null,
            plannedEndDate: block.plannedEndDate
              ? new Date(block.plannedEndDate)
              : null,
            notes: block.notes?.trim() || null,
            activatedAt: null,
            completedAt: null,
          },
        });

        createdBlocks.push({
          id: periodizationPlan.id,
          order,
          workoutPlanId: workoutPlan.id,
          workoutPlanName: workoutPlan.name,
          plannedStartDate: block.plannedStartDate
            ? block.plannedStartDate.split("T")[0]
            : null,
          plannedEndDate: block.plannedEndDate
            ? block.plannedEndDate.split("T")[0]
            : null,
          notes: periodizationPlan.notes,
          activatedAt: null,
          completedAt: null,
        });
      }

      return {
        id: periodization.id,
        name: periodization.name,
        goal: periodization.goal,
        notes: periodization.notes,
        isActive: false,
        startedAt: null,
        completedAt: null,
        createdAt: periodization.createdAt.toISOString(),
        status: "DRAFT" as const,
        blocks: createdBlocks,
      };
    }, {
      maxWait: 5000,
      timeout: 15000,
    });
  }
}
