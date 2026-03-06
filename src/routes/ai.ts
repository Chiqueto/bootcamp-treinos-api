import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { ListWorkoutPlans } from "../usecases/ListWorkoutPlans.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";

const SYSTEM_PROMPT = `Você é um personal trainer virtual especialista em montagem de planos de treino personalizados.

## Comportamento geral
- Tom amigável, motivador, linguagem simples, sem jargões técnicos.
- Respostas curtas e objetivas.
- Seu público principal são pessoas leigas em musculação.

## Fluxo obrigatório
1. **SEMPRE** chame a tool \`getUserTrainData\` antes de qualquer interação com o usuário.
2. Se o retorno for **null** (usuário sem dados cadastrados):
   - Pergunte em uma única mensagem: nome, peso (em kg), altura (em cm), idade e percentual de gordura corporal.
   - Após receber as respostas, salve chamando a tool \`updateUserTrainData\`. Converta o peso de kg para gramas (multiplique por 1000).
3. Se o retorno **não for null** (usuário já tem dados):
   - Cumprimente o usuário pelo nome retornado.

## Criação de plano de treino
- Para criar um plano de treino, pergunte ao usuário: objetivo, quantos dias por semana ele pode treinar e se tem restrições físicas ou lesões. Poucas perguntas, simples e diretas.
- O plano DEVE ter exatamente **7 dias** (MONDAY a SUNDAY). Dias sem treino devem ter \`isRest: true\`, \`exercises: []\` e \`estimatedDurationInSeconds: 0\`.
- Chame a tool \`createWorkoutPlan\` para criar o plano.

## Divisões de treino (splits)
Escolha a divisão adequada com base nos dias disponíveis:

- **2-3 dias/semana**: Full Body ou ABC (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas+Ombros)
- **4 dias/semana**: Upper/Lower (recomendado, cada grupo 2x/semana) ou ABCD (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas, D: Ombros+Abdômen)
- **5 dias/semana**: PPLUL — Push/Pull/Legs + Upper/Lower (superior 3x, inferior 2x/semana)
- **6 dias/semana**: PPL 2x — Push/Pull/Legs repetido

## Princípios de montagem
- Músculos sinérgicos juntos (peito+tríceps, costas+bíceps).
- Exercícios compostos primeiro, isoladores depois.
- 4 a 8 exercícios por sessão.
- 3-4 séries por exercício. 8-12 reps para hipertrofia, 4-6 reps para força.
- Descanso entre séries: 60-90s (hipertrofia), 120-180s (compostos pesados).
- Não treinar o mesmo grupo muscular em dias consecutivos.
- Nomes descritivos para cada dia (ex: "Superior A - Peito e Costas", "Descanso").

## Imagens de capa (coverImageUrl)
SEMPRE forneça um coverImageUrl para cada dia de treino. Escolha com base no foco muscular:

**Dias majoritariamente superiores** (peito, costas, ombros, bíceps, tríceps, push, pull, upper, full body):
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO3y8pQ6GBg8iqe9pP2JrHjwd1nfKtVSQskI0v
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOW3fJmqZe4yoUcwvRPQa8kmFprzNiC30hqftL

**Dias majoritariamente inferiores** (pernas, glúteos, quadríceps, posterior, panturrilha, legs, lower):
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOgCHaUgNGronCvXmSzAMs1N3KgLdE5yHT6Ykj
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO85RVu3morROwZk5NPhs1jzH7X8TyEvLUCGxY

Alterne entre as duas opções de cada categoria para variar. Dias de descanso usam imagem de superior.`;

export const aiRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["AI"],
      summary: "Chat with the AI personal trainer",
      body: z.object({
        messages: z.array(z.any()),
      }),
    },
    handler: async (request, reply) => {
      const messages = request.body.messages as UIMessage[];
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const userId = session.user.id;

      const result = streamText({
        model: "openai/gpt-4o-mini",
        system: SYSTEM_PROMPT,
        tools: {
          getUserTrainData: tool({
            description:
              "Busca os dados de treino do usuário autenticado (peso, altura, idade, % gordura). Retorna null se não existirem dados cadastrados.",
            inputSchema: z.object({}),
            execute: async () => {
              const getUserTrainData = new GetUserTrainData();
              return getUserTrainData.execute({ userId });
            },
          }),
          updateUserTrainData: tool({
            description:
              "Cria ou atualiza os dados de treino do usuário autenticado.",
            inputSchema: z.object({
              weightInGrams: z
                .number()
                .min(1)
                .describe("Peso do usuário em gramas"),
              heightInCentimeters: z
                .number()
                .min(1)
                .describe("Altura do usuário em centímetros"),
              age: z.number().min(1).describe("Idade do usuário"),
              bodyFatPercentage: z
                .number()
                .min(0)
                .max(100)
                .describe("Percentual de gordura corporal (ex: 20 para 20%)"),
            }),
            execute: async (input) => {
              const upsertUserTrainData = new UpsertUserTrainData();
              return upsertUserTrainData.execute({ userId, ...input });
            },
          }),
          getWorkoutPlans: tool({
            description:
              "Lista todos os planos de treino do usuário autenticado.",
            inputSchema: z.object({}),
            execute: async () => {
              const listWorkoutPlans = new ListWorkoutPlans();
              return listWorkoutPlans.execute({ userId });
            },
          }),
          createWorkoutPlan: tool({
            description: "Cria um novo plano de treino completo com 7 dias.",
            inputSchema: z.object({
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
                      .min(0)
                      .describe(
                        "Duração estimada do treino em segundos (0 para dias de descanso)",
                      ),
                    coverImageUrl: z
                      .string()
                      .url()
                      .describe("URL da imagem de capa do dia de treino"),
                    exercises: z
                      .array(
                        z.object({
                          order: z
                            .number()
                            .min(0)
                            .describe("A ordem do exercício"),
                          name: z
                            .string()
                            .trim()
                            .min(1)
                            .describe("O nome do exercício"),
                          sets: z
                            .number()
                            .min(1)
                            .describe("O número de séries"),
                          reps: z
                            .number()
                            .min(1)
                            .describe("O número de repetições"),
                          restTimeInSeconds: z
                            .number()
                            .min(1)
                            .describe(
                              "Tempo de descanso entre séries em segundos",
                            ),
                        }),
                      )
                      .describe(
                        "Exercícios do dia (vazio para dias de descanso)",
                      ),
                  }),
                )
                .length(7)
                .describe("Exatamente 7 dias de treino (MONDAY a SUNDAY)"),
            }),
            execute: async (input) => {
              const createWorkoutPlan = new CreateWorkoutPlan();
              return createWorkoutPlan.execute({
                userId,
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
    },
  });
};
