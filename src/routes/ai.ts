import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";

export const aiRoutes = async (app: FastifyInstance) => {
  app.post("/ai", async (request, reply) => {
    const { messages } = request.body as { messages: UIMessage[] };
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      return reply
        .status(401)
        .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const result = streamText({
      model: "openai/gpt-4o-mini",
      system: "",
      tools: {
        getUserTrainData: tool({}),
        updateUserTrainData: tool({}),
        getWorkoutPlans: tool({}),
        createWorkoutPlan: tool({
          description: "Cria um novo plano de treino completo.",
          inputSchema: z.object({
            id: z.uuid(),
            name: z
              .string()
              .trim()
              .min(1)
              .describe("O nome do plano de treino"),
            workoutDays: z
              .array(
                z.object({
                  name: z
                    .string()
                    .trim()
                    .min(1)
                    .describe("O nome do dia de treino"),
                  weekDay: z.enum(WeekDay).describe("O dia da semana"),
                  isRest: z
                    .boolean()
                    .default(false)
                    .describe("Indica se é um dia de descanso"),
                  estimatedDurationInSeconds: z
                    .number()
                    .min(1)
                    .describe("A duração estimada do treino em segundos"),
                  coverImageUrl: z
                    .url()
                    .nullable()
                    .optional()
                    .describe("A URL da imagem de capa do dia de treino"),
                  exercises: z.array(
                    z.object({
                      order: z.number().min(0).describe("A ordem do exercício"),
                      name: z
                        .string()
                        .trim()
                        .min(1)
                        .describe("O nome do exercício"),
                      sets: z
                        .number()
                        .min(1)
                        .describe("O número de séries do exercício"),
                      reps: z
                        .number()
                        .min(1)
                        .describe("O número de repetições do exercício"),
                      restTimeInSeconds: z
                        .number()
                        .min(1)
                        .describe(
                          "O tempo de descanso do exercício em segundos",
                        ),
                    }),
                  ),
                }),
              )
              .describe("Os dias de treino do plano de treino"),
          }),
          execute: async (input) => {
            const createWorkoutPlan = new CreateWorkoutPlan();
            await createWorkoutPlan.execute({
              userId: session.user.id,
              name: input.name,
              workoutDays: input.workoutDays,
            });
          },
        }),
      },
      stopWhen: stepCountIs(5),
      messages: await convertToModelMessages(messages),
    });
    const response = result.toUIMessageStreamResponse();
    reply.status(response.status);
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });
    return reply.send(response.body);
  });
};
