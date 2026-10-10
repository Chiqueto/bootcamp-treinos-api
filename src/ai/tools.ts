import { tool } from "ai";
import z from "zod";

import { validateIanaTimezone } from "../domain/analytics-dates.js";
import { Prisma } from "../generated/prisma/client.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { GamificationTheme } from "../schemas/index.js";
import { CreatePeriodizationDraftFromAI } from "../usecases/CreatePeriodizationDraftFromAI.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetExerciseEvolution } from "../usecases/GetExerciseEvolution.js";
import { GetMuscleTrainingAnalytics } from "../usecases/GetMuscleTrainingAnalytics.js";
import { GetPeriodization } from "../usecases/GetPeriodization.js";
import { GetPlanningOverview } from "../usecases/GetPlanningOverview.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { GetWeeklyTrainingAnalytics } from "../usecases/GetWeeklyTrainingAnalytics.js";
import { GetWorkoutHistorySession } from "../usecases/GetWorkoutHistorySession.js";
import { GetWorkoutPlan } from "../usecases/GetWorkoutPlan.js";
import { ListExercises } from "../usecases/ListExercises.js";
import { ListWorkoutHistory } from "../usecases/ListWorkoutHistory.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";



const ALL_WEEK_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export const aiExerciseSchema = z.object({
  order: z
    .number()
    .int()
    .min(1)
    .describe("Ordem do exercício na sessão (1, 2, 3...)"),
  name: z
    .string()
    .min(1)
    .describe("Nome do exercício (ex: Supino Reto com Barra)"),
  warmupSets: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Número de séries preparatórias/aquecimento (normalmente 1 a 3 nos primeiros compostos principais, 0 em exercícios subsequentes e isoladores)",
    ),
  sets: z
    .number()
    .int()
    .min(1)
    .describe("Número de séries válidas / de trabalho (ex: 3 ou 4)"),
  reps: z
    .number()
    .int()
    .min(1)
    .describe("Número de repetições por série (ex: 8 a 12)"),
  restTimeInSeconds: z
    .number()
    .int()
    .min(0)
    .describe("Tempo de descanso entre séries em segundos (ex: 60 a 90)"),
});

export const aiWorkoutDaySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .describe(
        "Nome descritivo do dia (ex: Superior A - Peito e Costas, ou Descanso)",
      ),
    weekDay: z
      .enum(WeekDay)
      .describe(
        "Dia da semana (MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY)",
      ),
    isRest: z
      .boolean()
      .describe("Se é dia de descanso (true) ou dia de treino (false)"),
    estimatedDurationInSeconds: z
      .number()
      .int()
      .min(0)
      .describe(
        "Duração estimada em segundos (0 para dias de descanso, ex: 3600 para 60 min)",
      ),
    coverImageUrl: z
      .string()
      .url()
      .nullable()
      .optional()
      .describe("URL da imagem de capa (opcional/nulo)"),
    exercises: z
      .array(aiExerciseSchema)
      .describe(
        "Lista de exercícios do dia (deve ser vazia se isRest for true)",
      ),
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

export const aiWorkoutDaysArraySchema = z
  .array(aiWorkoutDaySchema)
  .length(7, "O plano deve conter exatamente 7 dias.")
  .refine(
    (days) => {
      const weekdays = days.map((d) => d.weekDay);
      const unique = new Set(weekdays);
      return (
        unique.size === 7 &&
        ALL_WEEK_DAYS.every((wd) => unique.has(wd as WeekDay))
      );
    },
    {
      message:
        "O plano deve conter todos os 7 dias da semana (MONDAY a SUNDAY) sem repetição de dias.",
    },
  );

export const aiWorkoutPlanInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Nome do plano de treino (ex: Hipertrofia Upper/Lower 4x)"),
  workoutDays: aiWorkoutDaysArraySchema.describe(
    "Array com exatamente 7 dias de treino (MONDAY a SUNDAY) cobrindo a semana inteira",
  ),
});

export const aiPeriodizationBlockSchema = z.object({
  plan: aiWorkoutPlanInputSchema.describe(
    "Estrutura completa do plano de treino deste bloco/etapa",
  ),
  plannedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de data deve ser YYYY-MM-DD")
    .nullable()
    .optional()
    .describe("Data de início prevista (YYYY-MM-DD)"),
  plannedEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de data deve ser YYYY-MM-DD")
    .nullable()
    .optional()
    .describe("Data de término prevista (YYYY-MM-DD)"),
  notes: z
    .string()
    .nullable()
    .optional()
    .describe("Observações ou orientações pedagógicas para este bloco/etapa"),
});

export const aiPeriodizationInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Nome da periodização (ex: Pré-Temporada Vôlei 12 Semanas, ou Ciclo Força & Hipertrofia)",
    ),
  goal: z
    .string()
    .nullable()
    .optional()
    .describe("Objetivo geral da periodização"),
  notes: z
    .string()
    .nullable()
    .optional()
    .describe("Observações gerais sobre a periodização"),
  blocks: z
    .array(aiPeriodizationBlockSchema)
    .min(1, "A periodização deve conter pelo menos 1 bloco/etapa.")
    .describe(
      "Lista sequencial ordenada de blocos/etapas (cada um com seu plano de treino de 7 dias)",
    ),
});

const executedToolCallsCache = new Map<string, unknown>();

export function clearToolCallsCache() {
  executedToolCallsCache.clear();
}

export interface AiToolsContext {
  timezone?: string;
}

const TIMEZONE_REQUIRED_RESULT = {
  status: "TIMEZONE_REQUIRED" as const,
  message: "Não há timezone disponível para calcular este período.",
};

export function getAiTools(userId: string, context: AiToolsContext = {}) {
  const timezone = context.timezone
    ? validateIanaTimezone(context.timezone)
    : undefined;

  return {
    getPlanningOverview: tool({
      description:
        "Consulta o planejamento geral atual do usuário (contexto ativo [NONE, STANDALONE_PLAN ou PERIODIZATION], lista de planos de treino existentes e lista de periodizações com seus status).",
      inputSchema: z.object({}),
      execute: async () => {
        const getPlanningOverview = new GetPlanningOverview();
        return getPlanningOverview.execute({ userId });
      },
    }),

    getWorkoutPlan: tool({
      description:
        "Busca os detalhes completos de um plano de treino específico pelo ID (dias, contagem de exercícios, duração).",
      inputSchema: z.object({
        workoutPlanId: z.string().describe("ID do plano de treino"),
      }),
      execute: async ({ workoutPlanId }) => {
        const getWorkoutPlan = new GetWorkoutPlan();
        return getWorkoutPlan.execute({ userId, workoutPlanId });
      },
    }),

    getPeriodization: tool({
      description:
        "Busca os detalhes completos de uma periodização específica pelo ID (blocos, ordem, datas planejadas, status).",
      inputSchema: z.object({
        periodizationId: z.string().describe("ID da periodização"),
      }),
      execute: async ({ periodizationId }) => {
        const getPeriodization = new GetPeriodization();
        return getPeriodization.execute({ userId, periodizationId });
      },
    }),

    getUserTrainData: tool({
      description:
        "Busca os dados corporais de treino do usuário autenticado (peso, altura, idade, % gordura). Retorna null se não houver dados cadastrados.",
      inputSchema: z.object({}),
      execute: async () => {
        const getUserTrainData = new GetUserTrainData();
        return getUserTrainData.execute({ userId });
      },
    }),

    updateUserTrainData: tool({
      description:
        "Atualiza os dados de treino do usuário autenticado. O peso deve ser em gramas (converter kg * 1000). Percentual de gordura é opcional.",
      inputSchema: z.object({
        weightInGrams: z
          .number()
          .describe("Peso do usuário em gramas (ex: 70kg = 70000)"),
        heightInCentimeters: z
          .number()
          .describe("Altura do usuário em centímetros"),
        age: z.number().describe("Idade do usuário em anos"),
        bodyFatPercentage: z
          .number()
          .int()
          .min(0)
          .max(100)
          .nullable()
          .optional()
          .describe("Percentual de gordura corporal opcional (0 a 100)"),
        gamificationTheme: z
          .enum(GamificationTheme)
          .optional()
          .describe("Tema de gamificação preferido (ALL, ANIMES, VEHICLES, ANIMALS, MOVIES_SERIES)"),
      }),
      execute: async (params) => {
        const upsertUserTrainData = new UpsertUserTrainData();
        return upsertUserTrainData.execute({
          userId,
          weightInGrams: params.weightInGrams,
          heightInCentimeters: params.heightInCentimeters,
          age: params.age,
          bodyFatPercentage: params.bodyFatPercentage ?? 0,
          gamificationTheme: params.gamificationTheme,
        });
      },
    }),


    getRecentTrainingHistory: tool({
      description:
        "Consulta as sessões de treino concluídas mais recentes do usuário autenticado. Use para responder o que ele treinou nos últimos dias, qual foi o último treino ou quantos treinos recentes fez. Retorna somente um resumo compacto e factual; use getWorkoutHistorySession quando precisar das séries e exercícios de uma sessão específica.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Quantidade de sessões recentes (padrão 5, máximo 10)"),
        origin: z
          .enum(["PLANNED", "FREE"])
          .optional()
          .describe("Filtra por treino planejado ou treino avulso"),
      }),
      execute: async ({ limit, origin }) => {
        const listWorkoutHistory = new ListWorkoutHistory();
        const result = await listWorkoutHistory.execute({
          userId,
          limit,
          origin,
        });

        return {
          sessions: result.items.map((session) => ({
            id: session.id,
            completedAt: session.completedAt,
            origin: session.origin,
            workoutPlanNameSnapshot: session.workoutPlanNameSnapshot,
            workoutDayNameSnapshot: session.workoutDayNameSnapshot,
            exercisesCount: session.exercisesCount,
            workingSetsCount: session.workingSetsCount,
            warmupSetsCount: session.warmupSetsCount,
            totalLoadVolumeKg: session.totalLoadVolumeKg,
            durationInSeconds: session.durationInSeconds,
          })),
        };
      },
    }),

    getWorkoutHistorySession: tool({
      description:
        "Consulta o registro histórico completo de uma sessão concluída pertencente ao usuário autenticado. Use após identificar uma sessionId para responder o que foi planejado e realizado, incluindo exercícios, séries concluídas, carga, repetições e RIR. Os dados são snapshots históricos e não são reconstruídos do plano atual.",
      inputSchema: z.object({
        sessionId: z
          .string()
          .uuid()
          .describe("ID da sessão histórica concluída"),
      }),
      execute: async ({ sessionId }) => {
        const getWorkoutHistorySession = new GetWorkoutHistorySession();
        return getWorkoutHistorySession.execute({ userId, sessionId });
      },
    }),

    searchExercises: tool({
      description:
        "Busca deterministicamente no catálogo de exercícios globais e personalizados do próprio usuário. Use antes de getExerciseEvolution quando o exerciseId não for conhecido. A busca serve somente para descobrir IDs; se houver vários resultados plausíveis, pergunte ao usuário qual exercício ele quis dizer e não escolha silenciosamente.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .describe("Nome ou parte do nome do exercício"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(8)
          .describe("Quantidade máxima de resultados (padrão 8, máximo 15)"),
      }),
      execute: async ({ query, limit }) => {
        const listExercises = new ListExercises();
        const exercises = await listExercises.execute({ userId, query, limit });
        return {
          exercises: exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            ownerUserId: exercise.ownerUserId,
            isCustom: exercise.ownerUserId !== null,
            muscles: exercise.muscles.map(({ muscleGroup, role }) => ({
              muscleGroup,
              role,
            })),
          })),
        };
      },
    }),

    getExerciseEvolution: tool({
      description:
        "Consulta o histórico real de execução e o load PR de um exercício específico do usuário. Use para responder perguntas sobre progressão de carga, repetições, RIR, volume e recordes. Requer exerciseId; use searchExercises antes quando o ID não for conhecido. Retorna fatos registrados e não calcula progressScore nem uma conclusão automática de evolução.",
      inputSchema: z.object({
        exerciseId: z.string().uuid().describe("ID canônico do exercício"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(12)
          .default(6)
          .describe("Quantidade de sessões recentes (padrão 6, máximo 12)"),
      }),
      execute: async ({ exerciseId, limit }) => {
        const getExerciseEvolution = new GetExerciseEvolution();
        const result = await getExerciseEvolution.execute({
          userId,
          exerciseId,
          limit,
        });
        return {
          exercise: result.exercise,
          loadPR: result.loadPR,
          sessions: result.items,
        };
      },
    }),

    getWeeklyTrainingAnalytics: tool({
      description:
        "Consulta analytics semanais reais do usuário no timezone enviado pelo dispositivo. Use para frequência, séries, volume de carga e duração nas últimas semanas. A semana Trainvy vai de segunda a domingo. Não recebe timezone do modelo e não deve ser usada para inventar dados quando o contexto temporal estiver ausente.",
      inputSchema: z.object({
        weeksCount: z
          .number()
          .int()
          .min(1)
          .max(12)
          .default(4)
          .describe("Semana atual mais as anteriores (padrão 4, máximo 12)"),
      }),
      execute: async ({ weeksCount }) => {
        if (!timezone) return TIMEZONE_REQUIRED_RESULT;

        const getWeeklyTrainingAnalytics = new GetWeeklyTrainingAnalytics();
        const result = await getWeeklyTrainingAnalytics.execute({
          userId,
          tz: timezone,
          weeksCount,
        });
        return {
          timezone: result.timezone,
          startDate: result.startDate,
          endDate: result.endDate,
          weeks: result.weeks.map((week) => ({
            weekStartDate: week.weekStartDate,
            weekEndDate: week.weekEndDate,
            workoutsCompleted: week.workoutsCompleted,
            workingSets: week.workingSets,
            warmupSets: week.warmupSets,
            loadVolumeKg: week.loadVolumeKg,
            totalDurationInSeconds: week.totalDurationInSeconds,
            averageDurationInSeconds: week.averageDurationInSeconds,
          })),
        };
      },
    }),

    getMuscleTrainingAnalytics: tool({
      description:
        "Consulta séries de trabalho diretas e indiretas por grupo muscular em um período civil no timezone do dispositivo. Use para comparar músculos ou responder quantas séries de peito, costas, quadríceps etc. foram feitas. totalWorkingSets é o total real; não some contagens diretas e indiretas entre músculos para tratá-las como total.",
      inputSchema: z.object({
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Primeiro dia civil do período em YYYY-MM-DD"),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Último dia civil do período em YYYY-MM-DD"),
      }),
      execute: async ({ startDate, endDate }) => {
        if (!timezone) return TIMEZONE_REQUIRED_RESULT;

        const getMuscleTrainingAnalytics = new GetMuscleTrainingAnalytics();
        const result = await getMuscleTrainingAnalytics.execute({
          userId,
          tz: timezone,
          startDate,
          endDate,
        });
        return {
          timezone: result.timezone,
          startDate: result.startDate,
          endDate: result.endDate,
          totalWorkingSets: result.totalWorkingSets,
          classifiedWorkingSets: result.classifiedWorkingSets,
          unclassifiedWorkingSets: result.unclassifiedWorkingSets,
          muscles: result.muscles,
        };
      },
    }),

    proposeWorkoutPlan: tool({
      description:
        "Elabora e valida uma proposta completa de plano de treino semanal de 7 dias sem salvar no banco de dados. Use esta tool para validar e formular a proposta antes de pedir confirmação ao usuário.",
      inputSchema: aiWorkoutPlanInputSchema,
      execute: async (input) => {
        return {
          status: "PROPOSED",
          message:
            "Proposta de plano de treino validada com sucesso. Apresente o resumo ao usuário e pergunte se ele deseja salvar como rascunho.",
          plan: input,
        };
      },
    }),

    createWorkoutPlanDraft: tool({
      description:
        "Salva um plano de treino no banco de dados como RASCUNHO INATIVO (activate: false). CHAME ESTA TOOL SOMENTE APÓS O USUÁRIO CONFIRMAR EXPLICITAMENTE que deseja salvar o plano proposto.",
      inputSchema: aiWorkoutPlanInputSchema,
      needsApproval: true,
      execute: async (input, { toolCallId }) => {
        const startTime = Date.now();
        try {
          if (toolCallId) {
            const memoryKey = `${userId}:${toolCallId}`;
            if (executedToolCallsCache.has(memoryKey)) {
              return executedToolCallsCache.get(memoryKey) as {
                status: string;
                message: string;
                planId: string;
                name: string;
                isActive: boolean;
              };
            }

            const existingExecution = await prisma.aiToolExecution.findUnique({
              where: {
                userId_toolCallId: {
                  userId,
                  toolCallId,
                },
              },
            });

            if (existingExecution) {
              const cachedResult = existingExecution.result as {
                status: string;
                message: string;
                planId: string;
                name: string;
                isActive: boolean;
              };
              executedToolCallsCache.set(memoryKey, cachedResult);
              return cachedResult;
            }
          }

          const createWorkoutPlan = new CreateWorkoutPlan();
          const created = await createWorkoutPlan.execute({
            userId,
            name: input.name,
            workoutDays: input.workoutDays,
            activate: false,
          });

          const result = {
            status: "SAVED_DRAFT",
            message:
              "Plano de treino salvo com sucesso como rascunho inativo. Oriente o usuário que ele pode revisá-lo e ativá-lo em Planejamento (/planning).",
            planId: created.id,
            name: created.name,
            isActive: created.isActive,
          };

          if (toolCallId) {
            try {
              await prisma.aiToolExecution.create({
                data: {
                  userId,
                  toolCallId,
                  toolName: "createWorkoutPlanDraft",
                  result: result as unknown as Prisma.InputJsonValue,
                },
              });
            } catch {
              // ignore unique constraint race condition
            }
            executedToolCallsCache.set(`${userId}:${toolCallId}`, result);
          }

          return result;
        } catch (error: unknown) {
          const elapsedMs = Date.now() - startTime;
          const errObj = error as {
            name?: string;
            message?: string;
            code?: string;
            meta?: { code?: string };
          } | null;
          const errorCode = errObj?.code || errObj?.meta?.code || "none";
          const errorName = errObj?.name || "UnknownError";
          const errorMessage = errObj?.message || String(error);
          console.error(
            `[createWorkoutPlanDraft:error] toolName=createWorkoutPlanDraft toolCallId=${toolCallId ?? "unknown"} userId=${userId} blocksCount=1 elapsedMs=${elapsedMs} errorName=${errorName} errorCode=${errorCode} errorMessage=${errorMessage}`,
          );
          throw error;
        }
      },
    }),

    proposePeriodization: tool({
      description:
        "Elabora e valida uma proposta completa de periodização (ciclo com múltiplos blocos/etapas de treino) sem salvar no banco de dados. Use esta tool para validar e formular a proposta antes de pedir confirmação ao usuário.",
      inputSchema: aiPeriodizationInputSchema,
      execute: async (input) => {
        return {
          status: "PROPOSED",
          message:
            "Proposta de periodização validada com sucesso. Apresente o resumo das etapas ao usuário e pergunte se ele deseja salvar como rascunho.",
          periodization: input,
        };
      },
    }),

    createPeriodizationDraft: tool({
      description:
        "Salva atomicamente uma periodização com todos os seus blocos e planos de treino como RASCUNHO INATIVO (isActive: false) no banco de dados. CHAME ESTA TOOL SOMENTE APÓS O USUÁRIO CONFIRMAR EXPLICITAMENTE que deseja salvar a periodização proposta.",
      inputSchema: aiPeriodizationInputSchema,
      needsApproval: true,
      execute: async (input, { toolCallId }) => {
        const startTime = Date.now();
        const blocksCount = input.blocks?.length ?? 0;
        try {
          if (toolCallId) {
            const memoryKey = `${userId}:${toolCallId}`;
            if (executedToolCallsCache.has(memoryKey)) {
              return executedToolCallsCache.get(memoryKey) as {
                status: string;
                message: string;
                periodizationId: string;
                name: string;
                isActive: boolean;
                blocksCount: number;
              };
            }

            const existingExecution = await prisma.aiToolExecution.findUnique({
              where: {
                userId_toolCallId: {
                  userId,
                  toolCallId,
                },
              },
            });

            if (existingExecution) {
              const cachedResult = existingExecution.result as {
                status: string;
                message: string;
                periodizationId: string;
                name: string;
                isActive: boolean;
                blocksCount: number;
              };
              executedToolCallsCache.set(memoryKey, cachedResult);
              return cachedResult;
            }
          }

          const createPeriodizationDraftFromAI =
            new CreatePeriodizationDraftFromAI();
          const created = await createPeriodizationDraftFromAI.execute({
            userId,
            name: input.name,
            goal: input.goal,
            notes: input.notes,
            blocks: input.blocks,
          });

          const result = {
            status: "SAVED_DRAFT",
            message: `Periodização salva com sucesso como rascunho inativo com ${created.blocks.length} etapas. Oriente o usuário que ele pode revisá-la e ativá-la em Planejamento (/planning/periodizations/${created.id}).`,
            periodizationId: created.id,
            name: created.name,
            isActive: created.isActive,
            blocksCount: created.blocks.length,
          };

          if (toolCallId) {
            try {
              await prisma.aiToolExecution.create({
                data: {
                  userId,
                  toolCallId,
                  toolName: "createPeriodizationDraft",
                  result: result as unknown as Prisma.InputJsonValue,
                },
              });
            } catch {
              // ignore unique constraint race condition
            }
            executedToolCallsCache.set(`${userId}:${toolCallId}`, result);
          }

          return result;
        } catch (error: unknown) {
          const elapsedMs = Date.now() - startTime;
          const errObj = error as {
            name?: string;
            message?: string;
            code?: string;
            meta?: { code?: string };
          } | null;
          const errorCode = errObj?.code || errObj?.meta?.code || "none";
          const errorName = errObj?.name || "UnknownError";
          const errorMessage = errObj?.message || String(error);
          console.error(
            `[createPeriodizationDraft:error] toolName=createPeriodizationDraft toolCallId=${toolCallId ?? "unknown"} userId=${userId} blocksCount=${blocksCount} elapsedMs=${elapsedMs} errorName=${errorName} errorCode=${errorCode} errorMessage=${errorMessage}`,
          );
          throw error;
        }
      },
    }),
  };
}
