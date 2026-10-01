import { tool } from "ai";
import z from "zod";

import { Prisma } from "../generated/prisma/client.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { CreatePeriodizationDraftFromAI } from "../usecases/CreatePeriodizationDraftFromAI.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetPeriodization } from "../usecases/GetPeriodization.js";
import { GetPlanningOverview } from "../usecases/GetPlanningOverview.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { GetWorkoutPlan } from "../usecases/GetWorkoutPlan.js";
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
  sets: z.number().int().min(1).describe("Número de séries (ex: 3 ou 4)"),
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
      .describe("Lista de exercícios do dia (deve ser vazia se isRest for true)"),
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

export function getAiTools(userId: string) {
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
      }),
      execute: async (params) => {
        const upsertUserTrainData = new UpsertUserTrainData();
        return upsertUserTrainData.execute({
          userId,
          weightInGrams: params.weightInGrams,
          heightInCentimeters: params.heightInCentimeters,
          age: params.age,
          bodyFatPercentage: params.bodyFatPercentage ?? 0,
        });
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
      },
    }),
  };
}
