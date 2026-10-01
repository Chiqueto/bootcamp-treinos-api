import z from "zod";

import { SetType, WeekDay } from "../generated/prisma/enums.js";

export const ErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
});

export const WorkoutExerciseSchema = z.object({
  order: z.number().min(0),
  name: z.string().trim().min(1),
  sets: z.number().min(1),
  reps: z.number().min(1),
  restTimeInSeconds: z.number().min(1),
});

export const WorkoutDaySchema = z
  .object({
    name: z.string().trim().min(1),
    weekDay: z.enum(WeekDay),
    isRest: z.boolean().default(false),
    estimatedDurationInSeconds: z.number().min(0),
    coverImageUrl: z.url().nullable().optional(),
    exercises: z.array(WorkoutExerciseSchema),
  })
  .superRefine((data, ctx) => {
    if (data.isRest) {
      if (data.estimatedDurationInSeconds !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Dias de descanso devem ter estimatedDurationInSeconds igual a 0",
          path: ["estimatedDurationInSeconds"],
        });
      }
      if (data.exercises.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Dias de descanso não devem conter exercícios",
          path: ["exercises"],
        });
      }
    } else {
      if (data.estimatedDurationInSeconds <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Dias de treino devem ter estimatedDurationInSeconds maior que 0",
          path: ["estimatedDurationInSeconds"],
        });
      }
      if (data.exercises.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Dias de treino devem conter pelo menos um exercício",
          path: ["exercises"],
        });
      }
    }
  });

export const WorkoutPlanSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  isActive: z.boolean().optional(),
  workoutDays: z.array(WorkoutDaySchema),
});

export const CreateWorkoutPlanBodySchema = WorkoutPlanSchema.omit({
  id: true,
}).extend({
  activate: z.boolean().optional(),
});

export const WorkoutPlanSummaryResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

export const DuplicateWorkoutPlanBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
});

export const StartWorkoutSessionParamsSchema = z.object({
  workoutPlanId: z.uuid(),
  workoutDayId: z.uuid(),
});

export const SessionExerciseResponseSchema = z.object({
  id: z.uuid(),
  sourceWorkoutExerciseId: z.uuid().nullable(),
  exerciseId: z.uuid().nullable(),
  exerciseNameSnapshot: z.string(),
  order: z.number(),
  plannedSets: z.number().nullable(),
  plannedReps: z.number().nullable(),
  plannedRestTimeInSeconds: z.number().nullable(),
});

export const WorkoutSessionOriginSchema = z.enum(["PLANNED", "FREE"]);

export const StartWorkoutSessionResponseSchema = z.object({
  userWorkoutSessionId: z.uuid(),
  origin: WorkoutSessionOriginSchema.optional(),
  workoutPlanId: z.uuid().nullable().optional(),
  workoutPlanNameSnapshot: z.string().nullable().optional(),
  workoutDayNameSnapshot: z.string().nullable().optional(),
  exercises: z.array(SessionExerciseResponseSchema).optional(),
});

export const UpdateWorkoutSessionParamsSchema = z.object({
  workoutPlanId: z.uuid(),
  workoutDayId: z.uuid(),
  sessionId: z.uuid(),
});

export const UpdateWorkoutSessionBodySchema = z.object({
  completedAt: z.iso.datetime(),
});

export const UpdateWorkoutSessionResponseSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
});

export const GetWorkoutPlanParamsSchema = z.object({
  id: z.uuid(),
});

export const GetWorkoutPlanResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  workoutDays: z.array(
    z.object({
      id: z.uuid(),
      weekDay: z.enum(WeekDay),
      name: z.string(),
      isRest: z.boolean(),
      coverImageUrl: z.string().nullable().optional(),
      estimatedDurationInSeconds: z.number(),
      exercisesCount: z.number(),
    }),
  ),
});

export const GetWorkoutDayParamsSchema = z.object({
  id: z.uuid(),
  dayId: z.uuid(),
});

export const GetWorkoutDayResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isRest: z.boolean(),
  coverImageUrl: z.string().nullable().optional(),
  estimatedDurationInSeconds: z.number(),
  weekDay: z.enum(WeekDay),
  exercises: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      order: z.number(),
      workoutDayId: z.uuid(),
      sets: z.number(),
      reps: z.number(),
      restTimeInSeconds: z.number(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      workoutDayId: z.uuid().nullable(),
      startedAt: z.iso.date().nullable(),
      completedAt: z.iso.date().nullable(),
    }),
  ),
});

export const HomeParamsSchema = z.object({
  date: z.iso.date(),
});

export const HomeQuerySchema = z.object({
  timezoneOffset: z.coerce.number().int(),
});

export const HomeResponseSchema = z.object({
  activeWorkoutPlanId: z.uuid(),
  todayWorkoutDay: z
    .object({
      workoutPlanId: z.uuid(),
      id: z.uuid(),
      name: z.string(),
      isRest: z.boolean(),
      weekDay: z.enum(WeekDay),
      estimatedDurationInSeconds: z.number(),
      coverImageUrl: z.string().nullable().optional(),
      exercisesCount: z.number(),
    })
    .optional(),
  workoutStreak: z.number(),
  consistencyByDay: z.record(
    z.iso.date(),
    z.object({
      workoutDayCompleted: z.boolean(),
      workoutDayStarted: z.boolean(),
    }),
  ),
});

export const ListWorkoutPlansQuerySchema = z.object({
  active: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
});

export const ListWorkoutPlansResponseSchema = z.object({
  workoutPlans: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      isActive: z.boolean(),
      workoutDays: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          weekDay: z.enum(WeekDay),
          isRest: z.boolean(),
          coverImageUrl: z.string().nullable().optional(),
          estimatedDurationInSeconds: z.number(),
          exercises: z.array(
            z.object({
              id: z.uuid(),
              name: z.string(),
              order: z.number(),
              workoutDayId: z.uuid(),
              sets: z.number(),
              reps: z.number(),
              restTimeInSeconds: z.number(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export const StatsQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  timezoneOffset: z.coerce.number().int(),
});

export const StatsResponseSchema = z.object({
  workoutStreak: z.number(),
  consistencyByDay: z.record(
    z.iso.date(),
    z.object({
      workoutDayCompleted: z.boolean(),
      workoutDayStarted: z.boolean(),
    }),
  ),
  completedWorkoutsCount: z.number(),
  conclusionRate: z.number(),
  totalTimeInSeconds: z.number(),
});

export const UserTrainDataBodySchema = z.object({
  weightInGrams: z.number().min(1),
  heightInCentimeters: z.number().min(1),
  age: z.number().min(1),
  bodyFatPercentage: z.number().min(0).max(100),
});

export const UserTrainDataResponseSchema = z.object({
  userId: z.string(),
  weightInGrams: z.number(),
  heightInCentimeters: z.number(),
  age: z.number(),
  bodyFatPercentage: z.number(),
});

export const GetUserTrainDataResponseSchema = z
  .object({
    userId: z.string(),
    userName: z.string(),
    weightInGrams: z.number(),
    heightInCentimeters: z.number(),
    age: z.number(),
    bodyFatPercentage: z.number(),
  })
  .nullable();

export const CreateWorkoutSetParamsSchema = z.object({
  sessionExerciseId: z.uuid(),
});

export const CreateWorkoutSetBodySchema = z.object({
  type: z.enum(SetType).optional(),
  weightInGrams: z.number().int().min(0).nullable().optional(),
  reps: z.number().int().min(0).nullable().optional(),
  rir: z.number().int().min(0).max(10).nullable().optional(),
  durationInSeconds: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  completed: z.boolean().optional(),
});

export const WorkoutSetResponseSchema = z.object({
  id: z.uuid(),
  sessionExerciseId: z.uuid(),
  order: z.number().int(),
  type: z.enum(SetType),
  weightInGrams: z.number().int().nullable(),
  reps: z.number().int().nullable(),
  rir: z.number().int().nullable(),
  durationInSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const UpdateWorkoutSetParamsSchema = z.object({
  setId: z.uuid(),
});

export const UpdateWorkoutSetBodySchema = z.object({
  type: z.enum(SetType).optional(),
  weightInGrams: z.number().int().min(0).nullable().optional(),
  reps: z.number().int().min(0).nullable().optional(),
  rir: z.number().int().min(0).max(10).nullable().optional(),
  durationInSeconds: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  completed: z.boolean().optional(),
});

export const DeleteWorkoutSetParamsSchema = z.object({
  setId: z.uuid(),
});

export const DeleteWorkoutSetResponseSchema = z.object({
  success: z.boolean(),
});

export const GetWorkoutSessionParamsSchema = z.object({
  sessionId: z.uuid(),
});

export const WorkoutSessionSetResponseSchema = z.object({
  id: z.uuid(),
  order: z.number().int(),
  type: z.enum(SetType),
  weightInGrams: z.number().int().nullable(),
  reps: z.number().int().nullable(),
  rir: z.number().int().nullable(),
  durationInSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const WorkoutSessionExerciseResponseSchema = z.object({
  id: z.uuid(),
  exerciseNameSnapshot: z.string(),
  order: z.number().int(),
  plannedSets: z.number().int().nullable(),
  plannedReps: z.number().int().nullable(),
  plannedRestTimeInSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
  sets: z.array(WorkoutSessionSetResponseSchema),
});

export const GetWorkoutSessionResponseSchema = z.object({
  id: z.uuid(),
  origin: WorkoutSessionOriginSchema.optional(),
  workoutDayId: z.uuid().nullable(),
  workoutPlanId: z.uuid().nullable().optional(),
  workoutPlanNameSnapshot: z.string().nullable().optional(),
  workoutDayNameSnapshot: z.string().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  sessionExercises: z.array(WorkoutSessionExerciseResponseSchema),
});

export const CompleteWorkoutSessionResponseSchema = z.object({
  id: z.uuid(),
  workoutDayId: z.uuid().nullable(),
  startedAt: z.string(),
  completedAt: z.string(),
});

export const StartFreeWorkoutSessionResponseSchema = z.object({
  userWorkoutSessionId: z.uuid(),
  workoutSessionId: z.uuid(),
  origin: WorkoutSessionOriginSchema.optional(),
  workoutDayId: z.uuid().nullable(),
  workoutPlanId: z.uuid().nullable().optional(),
  workoutPlanNameSnapshot: z.string().nullable().optional(),
  workoutDayNameSnapshot: z.string().nullable().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const ExerciseResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  ownerUserId: z.string().nullable(),
});

export const ListExercisesQuerySchema = z.object({
  q: z.string().optional(),
});

export const CreateExerciseBodySchema = z.object({
  name: z.string().min(1),
});

export const AddSessionExerciseParamsSchema = z.object({
  sessionId: z.uuid(),
});

export const AddSessionExerciseBodySchema = z.object({
  exerciseId: z.uuid(),
});

export const DeleteSessionExerciseParamsSchema = z.object({
  sessionExerciseId: z.uuid(),
});

export const PeriodizationStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
]);

export const CreatePeriodizationBodySchema = z.object({
  name: z.string().trim().min(1),
  goal: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

export const UpdatePeriodizationBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  goal: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

export const PeriodizationParamsSchema = z.object({
  id: z.uuid(),
});

export const PeriodizationPlanParamsSchema = z.object({
  periodizationId: z.uuid(),
  periodizationPlanId: z.uuid(),
});

export const PeriodizationItemResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  totalPlans: z.number().int().min(0),
  status: PeriodizationStatusSchema,
});

export const ListPeriodizationsResponseSchema = z.array(
  PeriodizationItemResponseSchema,
);

export const PeriodizationResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: PeriodizationStatusSchema,
});

export const PeriodizationPlanWorkoutPlanSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

export const PeriodizationPlanDetailResponseSchema = z.object({
  id: z.uuid(),
  periodizationId: z.uuid(),
  workoutPlanId: z.uuid(),
  order: z.number().int().min(1),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  activatedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workoutPlan: PeriodizationPlanWorkoutPlanSummarySchema,
});

export const GetPeriodizationResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: PeriodizationStatusSchema,
  plans: z.array(PeriodizationPlanDetailResponseSchema),
});

export const AddWorkoutPlanToPeriodizationBodySchema = z
  .object({
    workoutPlanId: z.uuid(),
    plannedStartDate: z.string().nullable().optional(),
    plannedEndDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.plannedStartDate && data.plannedEndDate) {
      if (new Date(data.plannedEndDate) < new Date(data.plannedStartDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "plannedEndDate não pode ser anterior a plannedStartDate",
          path: ["plannedEndDate"],
        });
      }
    }
  });

export const PeriodizationCurrentBlockResponseSchema = z.object({
  id: z.uuid(),
  order: z.number().int().min(1),
  workoutPlanId: z.uuid(),
  workoutPlanName: z.string(),
  activatedAt: z.string(),
});

export const PeriodizationLifecycleResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: PeriodizationStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  currentBlock: PeriodizationCurrentBlockResponseSchema.nullable(),
});

export const CreateWorkoutPlanInPeriodizationBodySchema = z
  .object({
    name: z.string().trim().min(1),
    workoutDays: z.array(WorkoutDaySchema),
    plannedStartDate: z.string().nullable().optional(),
    plannedEndDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.plannedStartDate && data.plannedEndDate) {
      if (new Date(data.plannedEndDate) < new Date(data.plannedStartDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "plannedEndDate não pode ser anterior a plannedStartDate",
          path: ["plannedEndDate"],
        });
      }
    }
  });

export const UpdatePeriodizationPlanBodySchema = z
  .object({
    plannedStartDate: z.string().nullable().optional(),
    plannedEndDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.plannedStartDate && data.plannedEndDate) {
      if (new Date(data.plannedEndDate) < new Date(data.plannedStartDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "plannedEndDate não pode ser anterior a plannedStartDate",
          path: ["plannedEndDate"],
        });
      }
    }
  });

export const ReorderPeriodizationPlansBodySchema = z.object({
  periodizationPlanIds: z.array(z.uuid()).min(1),
});

export const SuccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const CreateWorkoutPlanInPeriodizationResponseSchema = z.object({
  id: z.uuid(),
  periodizationId: z.uuid(),
  workoutPlanId: z.uuid(),
  order: z.number().int().min(1),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  activatedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  workoutPlan: WorkoutPlanSchema,
});

export const PlanningPeriodizationBlockStatusSchema = z.enum([
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
]);

export const PlanningWorkoutPlanPeriodizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  periodizationPlanId: z.uuid(),
  order: z.number().int().min(1),
  status: PlanningPeriodizationBlockStatusSchema,
});

export const PlanningWorkoutPlanSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  workoutDaysCount: z.number().int().min(0),
  createdAt: z.string(),
  periodization: PlanningWorkoutPlanPeriodizationSummarySchema.nullable(),
});

export const PlanningPeriodizationBlockSummarySchema = z.object({
  id: z.uuid(),
  order: z.number().int().min(1),
  workoutPlanId: z.uuid(),
  workoutPlanName: z.string(),
  activatedAt: z.string(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
});

export const PlanningPeriodizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  status: PeriodizationStatusSchema,
  isActive: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  totalBlocks: z.number().int().min(0),
  completedBlocks: z.number().int().min(0),
  currentBlock: PlanningPeriodizationBlockSummarySchema.nullable(),
  createdAt: z.string(),
});

export const NoActiveContextSchema = z.object({
  type: z.literal("NONE"),
});

export const ActiveStandalonePlanDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  workoutDaysCount: z.number().int().min(0),
  createdAt: z.string(),
});

export const ActiveStandalonePlanContextSchema = z.object({
  type: z.literal("STANDALONE_PLAN"),
  plan: ActiveStandalonePlanDetailSchema,
});

export const ActivePeriodizationDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  startedAt: z.string().nullable(),
  currentBlock: PlanningPeriodizationBlockSummarySchema,
  totalBlocks: z.number().int().min(0),
  completedBlocks: z.number().int().min(0),
});

export const ActivePeriodizationContextSchema = z.object({
  type: z.literal("PERIODIZATION"),
  periodization: ActivePeriodizationDetailSchema,
});

export const ActiveContextSchema = z.discriminatedUnion("type", [
  NoActiveContextSchema,
  ActiveStandalonePlanContextSchema,
  ActivePeriodizationContextSchema,
]);

export const PlanningOverviewResponseSchema = z.object({
  activeContext: ActiveContextSchema,
  plans: z.array(PlanningWorkoutPlanSummarySchema),
  periodizations: z.array(PlanningPeriodizationSummarySchema),
});

export const AiConversationSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messagesCount: z.number().int().min(0),
});

export const ListAiConversationsResponseSchema = z.object({
  conversations: z.array(AiConversationSummarySchema),
});

export const GetAiConversationResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(z.unknown()),
});

export const CreateAiConversationBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
});

export const CreateAiConversationResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AiConversationParamsSchema = z.object({
  id: z.uuid(),
});



