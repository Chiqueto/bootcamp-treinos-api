import { convertToModelMessages, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSystemPrompt } from "../../src/ai/system-prompt.js";
import {
  aiPeriodizationInputSchema,
  aiWorkoutPlanInputSchema,
  clearToolCallsCache,
  getAiTools,
} from "../../src/ai/tools.js";
import { ValidationError } from "../../src/errors/index.js";
import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { CreatePeriodizationDraftFromAI } from "../../src/usecases/CreatePeriodizationDraftFromAI.js";
import {
  cleanupTestUsers,
  createTestPeriodization,
  createTestUser,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

const VALID_7_DAYS = [
  {
    name: "Superior A",
    weekDay: WeekDay.MONDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      {
        order: 1,
        name: "Supino Reto",
        sets: 4,
        reps: 10,
        restTimeInSeconds: 90,
      },
    ],
  },
  {
    name: "Inferior A",
    weekDay: WeekDay.TUESDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      {
        order: 1,
        name: "Agachamento Livre",
        sets: 4,
        reps: 8,
        restTimeInSeconds: 120,
      },
    ],
  },
  {
    name: "Descanso",
    weekDay: WeekDay.WEDNESDAY,
    isRest: true,
    estimatedDurationInSeconds: 0,
    coverImageUrl: null,
    exercises: [],
  },
  {
    name: "Superior B",
    weekDay: WeekDay.THURSDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      {
        order: 1,
        name: "Puxada Frontal",
        sets: 4,
        reps: 10,
        restTimeInSeconds: 90,
      },
    ],
  },
  {
    name: "Inferior B",
    weekDay: WeekDay.FRIDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      {
        order: 1,
        name: "Leg Press",
        sets: 4,
        reps: 12,
        restTimeInSeconds: 90,
      },
    ],
  },
  {
    name: "Descanso",
    weekDay: WeekDay.SATURDAY,
    isRest: true,
    estimatedDurationInSeconds: 0,
    coverImageUrl: null,
    exercises: [],
  },
  {
    name: "Descanso",
    weekDay: WeekDay.SUNDAY,
    isRest: true,
    estimatedDurationInSeconds: 0,
    coverImageUrl: null,
    exercises: [],
  },
];

describe("Task 2.6 — IA de Planejamento V1 (Backend)", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  describe("1. Ferramentas da IA e Restrições de Ativação", () => {
    it("não disponibiliza nenhuma ferramenta de ativação, desativação, avanço ou conclusão", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const tools = getAiTools(user.id);
      const toolNames = Object.keys(tools);

      // Ferramentas permitidas
      expect(toolNames).toContain("getPlanningOverview");
      expect(toolNames).toContain("getWorkoutPlan");
      expect(toolNames).toContain("getPeriodization");
      expect(toolNames).toContain("getUserTrainData");
      expect(toolNames).toContain("updateUserTrainData");
      expect(toolNames).toContain("proposeWorkoutPlan");
      expect(toolNames).toContain("createWorkoutPlanDraft");
      expect(toolNames).toContain("proposePeriodization");
      expect(toolNames).toContain("createPeriodizationDraft");

      // Nenhuma tool com poderes operacionais ou de ativação
      expect(toolNames).not.toContain("activateWorkoutPlan");
      expect(toolNames).not.toContain("deactivateWorkoutPlan");
      expect(toolNames).not.toContain("activatePeriodization");
      expect(toolNames).not.toContain("deactivatePeriodization");
      expect(toolNames).not.toContain("advancePeriodization");
      expect(toolNames).not.toContain("completePeriodization");
    });

    it("getPlanningOverview usa o userId autenticado e isola dados entre usuários", async () => {
      const userA = await createTestUser({ name: "User A" });
      const userB = await createTestUser({ name: "User B" });
      createdUserIds.push(userA.id, userB.id);

      await createTestWorkoutPlan(userA.id, {
        name: "Plano do Usuário A",
        isActive: true,
      });
      await createTestWorkoutPlan(userB.id, {
        name: "Plano do Usuário B",
        isActive: true,
      });

      const toolsA = getAiTools(userA.id);
      const overviewA: any = await toolsA.getPlanningOverview.execute(
        {},
        {} as any,
      );

      expect(overviewA.activeContext.type).toBe("STANDALONE_PLAN");
      expect(overviewA.activeContext.plan.name).toBe("Plano do Usuário A");
      expect(overviewA.plans.length).toBe(1);
      expect(overviewA.plans[0].name).toBe("Plano do Usuário A");
    });
  });

  describe("2. createWorkoutPlanDraft", () => {
    it("sempre cria o plano como inativo (isActive = false) e não altera plano ativo existente", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const existingActivePlan = await createTestWorkoutPlan(user.id, {
        name: "Plano Ativo Existente",
        isActive: true,
      });

      const tools = getAiTools(user.id);
      const result: any = await tools.createWorkoutPlanDraft.execute(
        {
          name: "Novo Plano Draft IA",
          workoutDays: VALID_7_DAYS,
        },
        {} as any,
      );

      expect(result.status).toBe("SAVED_DRAFT");
      expect(result.isActive).toBe(false);

      // Verifica no banco de dados
      const createdPlan = await prisma.workoutPlan.findUniqueOrThrow({
        where: { id: result.planId },
      });
      expect(createdPlan.isActive).toBe(false);

      // O plano anterior continua ativo intocado
      const checkPreviousPlan = await prisma.workoutPlan.findUniqueOrThrow({
        where: { id: existingActivePlan.id },
      });
      expect(checkPreviousPlan.isActive).toBe(true);
    });

    it("cria plano draft mesmo quando há uma periodização ativa (não conflita)", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      // Cria periodização ativa
      await createTestPeriodization(user.id, {
        name: "Periodização Ativa",
        isActive: true,
        startedAt: new Date(),
      });

      const tools = getAiTools(user.id);
      // Criar draft via IA não tenta ativar, então não lança ActivePeriodizationError
      const result: any = await tools.createWorkoutPlanDraft.execute(
        {
          name: "Draft Standalone Durante Periodização",
          workoutDays: VALID_7_DAYS,
        },
        {} as any,
      );

      expect(result.status).toBe("SAVED_DRAFT");
      expect(result.isActive).toBe(false);
    });
  });

  describe("3. proposeWorkoutPlan e Validação de Esquema", () => {
    it("valida e retorna proposta sem gravar nada no banco de dados", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const countBefore = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });

      const tools = getAiTools(user.id);
      const result: any = await tools.proposeWorkoutPlan.execute(
        {
          name: "Proposta Upper Lower",
          workoutDays: VALID_7_DAYS,
        },
        {} as any,
      );

      expect(result.status).toBe("PROPOSED");
      expect(result.plan.name).toBe("Proposta Upper Lower");

      // Nada foi persistido
      const countAfter = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });
      expect(countAfter).toBe(countBefore);
    });

    it("rejeita esquema de plano que não tenha exatamente 7 dias ou tenha dias repetidos", () => {
      // 6 dias apenas
      const sixDays = VALID_7_DAYS.slice(0, 6);
      expect(() =>
        aiWorkoutPlanInputSchema.parse({
          name: "Plano Incompleto",
          workoutDays: sixDays,
        }),
      ).toThrow();

      // 7 dias com duplicata (dois MONDAY)
      const duplicateDays = [
        ...VALID_7_DAYS.slice(0, 6),
        { ...VALID_7_DAYS[0], name: "Monday duplicado" },
      ];
      expect(() =>
        aiWorkoutPlanInputSchema.parse({
          name: "Plano Duplicado",
          workoutDays: duplicateDays,
        }),
      ).toThrow();
    });
  });

  describe("4. proposePeriodization", () => {
    it("valida e retorna proposta de periodização sem persistir no banco de dados", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const perCountBefore = await prisma.periodization.count({
        where: { userId: user.id },
      });

      const tools = getAiTools(user.id);
      const result: any = await tools.proposePeriodization.execute(
        {
          name: "Periodização 8 Semanas",
          goal: "Ganho de massa",
          notes: "Foco em progressão de cargas",
          blocks: [
            {
              plan: {
                name: "Bloco 1 - Base",
                workoutDays: VALID_7_DAYS,
              },
              plannedStartDate: "2026-10-01",
              plannedEndDate: "2026-10-28",
              notes: "4 semanas de base",
            },
            {
              plan: {
                name: "Bloco 2 - Força",
                workoutDays: VALID_7_DAYS,
              },
              plannedStartDate: "2026-10-29",
              plannedEndDate: "2026-11-25",
              notes: "4 semanas de força",
            },
          ],
        },
        {} as any,
      );

      expect(result.status).toBe("PROPOSED");
      expect(result.periodization.name).toBe("Periodização 8 Semanas");
      expect(result.periodization.blocks.length).toBe(2);

      const perCountAfter = await prisma.periodization.count({
        where: { userId: user.id },
      });
      expect(perCountAfter).toBe(perCountBefore);
    });

    it("rejeita periodização sem blocos", () => {
      expect(() =>
        aiPeriodizationInputSchema.parse({
          name: "Sem Blocos",
          blocks: [],
        }),
      ).toThrow();
    });
  });

  describe("5. CreatePeriodizationDraftFromAI (Use Case Atômico)", () => {
    const useCase = new CreatePeriodizationDraftFromAI();

    it("cria periodização draft com N planos inativos, orders 1..N e timestamps operacionais nulos", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const output = await useCase.execute({
        userId: user.id,
        name: "Ciclo Hipertrofia 12 Semanas",
        goal: "Ganho de força e hipertrofia",
        notes: "Criado pelo Coach AI",
        blocks: [
          {
            plan: {
              name: "Bloco 1: Adaptação",
              workoutDays: VALID_7_DAYS,
            },
            plannedStartDate: "2026-10-01",
            plannedEndDate: "2026-10-28",
            notes: "Fase 1",
          },
          {
            plan: {
              name: "Bloco 2: Carga Progressiva",
              workoutDays: VALID_7_DAYS,
            },
            plannedStartDate: "2026-10-29",
            plannedEndDate: "2026-11-25",
            notes: "Fase 2",
          },
          {
            plan: {
              name: "Bloco 3: Choque",
              workoutDays: VALID_7_DAYS,
            },
            plannedStartDate: "2026-11-26",
            plannedEndDate: "2026-12-23",
            notes: "Fase 3",
          },
        ],
      });

      expect(output.id).toBeDefined();
      expect(output.name).toBe("Ciclo Hipertrofia 12 Semanas");
      expect(output.status).toBe("DRAFT");
      expect(output.isActive).toBe(false);
      expect(output.startedAt).toBeNull();
      expect(output.completedAt).toBeNull();
      expect(output.blocks.length).toBe(3);

      // Validação das ordens
      expect(output.blocks[0].order).toBe(1);
      expect(output.blocks[1].order).toBe(2);
      expect(output.blocks[2].order).toBe(3);

      // Consulta no banco de dados para garantir integridade
      const dbPeriodization = await prisma.periodization.findUniqueOrThrow({
        where: { id: output.id },
        include: {
          plans: {
            orderBy: { order: "asc" },
            include: { workoutPlan: true },
          },
        },
      });

      expect(dbPeriodization.userId).toBe(user.id);
      expect(dbPeriodization.isActive).toBe(false);
      expect(dbPeriodization.startedAt).toBeNull();
      expect(dbPeriodization.completedAt).toBeNull();
      expect(dbPeriodization.plans.length).toBe(3);

      for (let i = 0; i < 3; i++) {
        const p = dbPeriodization.plans[i];
        expect(p.order).toBe(i + 1);
        expect(p.activatedAt).toBeNull();
        expect(p.completedAt).toBeNull();
        // Todos os WorkoutPlans devem nascer inativos
        expect(p.workoutPlan.isActive).toBe(false);
        expect(p.workoutPlan.userId).toBe(user.id);
      }
    });

    it("reverte todas as alterações (rollback completo) se qualquer bloco falhar", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const periodizationCountBefore = await prisma.periodization.count({
        where: { userId: user.id },
      });
      const workoutPlanCountBefore = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });

      // Bloco 2 com erro (data final anterior à data inicial)
      await expect(
        useCase.execute({
          userId: user.id,
          name: "Periodização com Erro no Bloco 2",
          blocks: [
            {
              plan: {
                name: "Bloco 1 Válido",
                workoutDays: VALID_7_DAYS,
              },
              plannedStartDate: "2026-10-01",
              plannedEndDate: "2026-10-28",
            },
            {
              plan: {
                name: "Bloco 2 Inválido",
                workoutDays: VALID_7_DAYS,
              },
              plannedStartDate: "2026-10-29",
              plannedEndDate: "2026-10-10", // data término anterior à inicial!
            },
          ],
        }),
      ).rejects.toThrow(ValidationError);

      // Confirma rollback total
      const periodizationCountAfter = await prisma.periodization.count({
        where: { userId: user.id },
      });
      const workoutPlanCountAfter = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });

      expect(periodizationCountAfter).toBe(periodizationCountBefore);
      expect(workoutPlanCountAfter).toBe(workoutPlanCountBefore);
    });
  });

  describe("6. System Prompt e Diretrizes de Comportamento", () => {
    it("inclui o primeiro nome do usuário e orientações de segurança e fluxo", () => {
      const prompt = getSystemPrompt("Carlos Eduardo da Silva");

      // Primeiro nome
      expect(prompt).toContain('Carlos');
      expect(prompt).toContain('NUNCA pergunte o nome do usuário');

      // Proposta antes de salvar
      expect(prompt).toContain("proposeWorkoutPlan");
      expect(prompt).toContain("proposePeriodization");
      expect(prompt).toContain("Quer que eu salve");
      expect(prompt).toContain("RASCUNHO INATIVO");

      // Regras de ativação restritas
      expect(prompt).toContain("A IA NUNCA ATIVA PLANOS OU PERIODIZAÇÕES");

      // Segurança e guardrails
      expect(prompt).toContain("Não faça diagnósticos médicos");
      expect(prompt).toContain("Não utilize peso, percentual de gordura ou estética como motivação negativa");
      expect(prompt).toContain("Não invente features inexistentes");
    });
  });

  describe("7. Testes Comportamentais de Fluxo (Proposta -> Confirmação -> Salvamento)", () => {
    it("fluxo de plano: proposta não grava e salvamento após confirmação gera draft inativo", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      // Passo 1: Usuário pede plano -> IA chama proposeWorkoutPlan
      const proposalResult: any = await tools.proposeWorkoutPlan.execute(
        {
          name: "Plano Sugerido 4x",
          workoutDays: VALID_7_DAYS,
        },
        {} as any,
      );

      expect(proposalResult.status).toBe("PROPOSED");
      expect(proposalResult.plan.name).toBe("Plano Sugerido 4x");

      // Confirma que nenhum plano foi gravado no banco ainda
      const plansCountAfterPropose = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });
      expect(plansCountAfterPropose).toBe(0);

      // Passo 2: Usuário confirma ("pode salvar") -> IA chama createWorkoutPlanDraft
      const saveResult: any = await tools.createWorkoutPlanDraft.execute(
        proposalResult.plan,
        {} as any,
      );

      expect(saveResult.status).toBe("SAVED_DRAFT");
      expect(saveResult.isActive).toBe(false);

      // Confirma que agora foi gravado no banco, exatamente como inativo
      const createdDbPlan = await prisma.workoutPlan.findUniqueOrThrow({
        where: { id: saveResult.planId },
      });
      expect(createdDbPlan.isActive).toBe(false);
      expect(createdDbPlan.name).toBe("Plano Sugerido 4x");
    });

    it("fluxo de periodização: proposta não grava e salvamento após confirmação gera draft inativo atômico", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      // Passo 1: Usuário pede periodização -> IA chama proposePeriodization
      const proposalResult: any = await tools.proposePeriodization.execute(
        {
          name: "Ciclo Proposto",
          goal: "Preparação Geral",
          notes: "Notas do Coach",
          blocks: [
            {
              plan: {
                name: "Etapa 1 - Força",
                workoutDays: VALID_7_DAYS,
              },
              plannedStartDate: "2026-10-01",
              plannedEndDate: "2026-10-28",
            },
          ],
        },
        {} as any,
      );

      expect(proposalResult.status).toBe("PROPOSED");

      // Confirma que nada foi gravado
      const perCountAfterPropose = await prisma.periodization.count({
        where: { userId: user.id },
      });
      expect(perCountAfterPropose).toBe(0);

      // Passo 2: Usuário confirma -> IA chama createPeriodizationDraft
      const saveResult: any = await tools.createPeriodizationDraft.execute(
        proposalResult.periodization,
        {} as any,
      );

      expect(saveResult.status).toBe("SAVED_DRAFT");
      expect(saveResult.isActive).toBe(false);
      expect(saveResult.blocksCount).toBe(1);

      // Confirma no banco
      const dbPer = await prisma.periodization.findUniqueOrThrow({
        where: { id: saveResult.periodizationId },
      });
      expect(dbPer.isActive).toBe(false);
      expect(dbPer.startedAt).toBeNull();
    });
  });

  describe("8. Approval Hardening Determinístico & Idempotência (Task 2.7)", () => {
    beforeEach(() => {
      clearToolCallsCache();
    });

    it("declaração de needsApproval: true em tools de escrita e false/ausente em tools puras", () => {
      const tools = getAiTools("user-1");
      expect((tools.createWorkoutPlanDraft as any).needsApproval).toBe(true);
      expect((tools.createPeriodizationDraft as any).needsApproval).toBe(true);
      expect((tools.proposeWorkoutPlan as any).needsApproval).toBeFalsy();
      expect((tools.proposePeriodization as any).needsApproval).toBeFalsy();
      expect((tools.getPlanningOverview as any).needsApproval).toBeFalsy();
    });

    it("modelo tenta persistir WorkoutPlan sem approval -> bloqueado e 0 registros criados", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      const mockModel = new MockLanguageModelV3({
        doStream: async () => {
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "call-plan-1",
                  toolName: "createWorkoutPlanDraft",
                  input: JSON.stringify({
                    name: "Plano Bloqueado",
                    workoutDays: VALID_7_DAYS,
                  }),
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: "tool-calls",
                  usage: {
                    inputTokens: { total: 10 },
                    outputTokens: { total: 10 },
                  },
                });
                controller.close();
              },
            }),
          };
        },
      });

      const result = streamText({
        model: mockModel,
        tools,
        messages: [{ role: "user", content: "salva um plano pra mim" }],
      });

      const streamResponse = result.toUIMessageStreamResponse();
      const reader = streamResponse.body?.getReader();
      const decoder = new TextDecoder();
      let streamTextOutput = "";
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        streamTextOutput += decoder.decode(value);
      }

      // Deve ter emitido tool-approval-request
      expect(streamTextOutput).toContain("tool-approval-request");
      expect(streamTextOutput).toContain("call-plan-1");

      // Nenhum plano gravado no banco de dados
      const plansCount = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });
      expect(plansCount).toBe(0);
    });

    it("usuário rejeita approval (approved: false) -> tool negada e 0 registros criados", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      const mockModel = new MockLanguageModelV3({
        doStream: async () => {
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({
                  type: "text-start",
                  id: "txt-1",
                });
                controller.enqueue({
                  type: "text-delta",
                  id: "txt-1",
                  delta: "Entendido, não salvei o plano.",
                });
                controller.enqueue({
                  type: "text-end",
                  id: "txt-1",
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: {
                    inputTokens: { total: 10 },
                    outputTokens: { total: 10 },
                  },
                });
                controller.close();
              },
            }),
          };
        },
      });

      const messagesWithDenial: any[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Monte um plano" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [
            {
              type: "tool-createWorkoutPlanDraft",
              toolCallId: "call-plan-1",
              state: "approval-responded",
              input: {
                name: "Plano Rejeitado",
                workoutDays: VALID_7_DAYS,
              },
              approval: {
                id: "appr-1",
                approved: false,
                reason: "Quero alterar os dias",
              },
            },
          ],
        },
      ];

      const modelMessages = await convertToModelMessages(messagesWithDenial);
      const result = streamText({
        model: mockModel,
        tools,
        messages: modelMessages,
      });

      const streamResponse = result.toUIMessageStreamResponse();
      const reader = streamResponse.body?.getReader();
      const decoder = new TextDecoder();
      let streamTextOutput = "";
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        streamTextOutput += decoder.decode(value);
      }

      expect(streamTextOutput).toContain("tool-output-denied");

      const plansCount = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });
      expect(plansCount).toBe(0);
    });

    it("usuário aprova (approved: true) -> cria exatamente um draft inativo", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      const mockModel = new MockLanguageModelV3({
        doStream: async () => {
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({
                  type: "text-start",
                  id: "txt-1",
                });
                controller.enqueue({
                  type: "text-delta",
                  id: "txt-1",
                  delta: "Salvei seu plano como rascunho!",
                });
                controller.enqueue({
                  type: "text-end",
                  id: "txt-1",
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: {
                    inputTokens: { total: 10 },
                    outputTokens: { total: 10 },
                  },
                });
                controller.close();
              },
            }),
          };
        },
      });

      const messagesWithApproval: any[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Monte um plano" }],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [
            {
              type: "tool-createWorkoutPlanDraft",
              toolCallId: "call-plan-approved-1",
              state: "approval-responded",
              input: {
                name: "Plano Aprovado Pelo Usuário",
                workoutDays: VALID_7_DAYS,
              },
              approval: {
                id: "appr-approved-1",
                approved: true,
              },
            },
          ],
        },
      ];

      const modelMessages = await convertToModelMessages(messagesWithApproval);
      const result = streamText({
        model: mockModel,
        tools,
        messages: modelMessages,
      });

      const streamResponse = result.toUIMessageStreamResponse();
      const reader = streamResponse.body?.getReader();
      const decoder = new TextDecoder();
      let streamTextOutput = "";
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        streamTextOutput += decoder.decode(value);
      }

      expect(streamTextOutput).toContain("tool-output-available");

      const userPlans = await prisma.workoutPlan.findMany({
        where: { userId: user.id },
      });
      expect(userPlans).toHaveLength(1);
      expect(userPlans[0].name).toBe("Plano Aprovado Pelo Usuário");
      expect(userPlans[0].isActive).toBe(false);
    });

    it("double approval / replay com mesmo toolCallId -> idempotente, não cria duplicata", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      const inputPlan = {
        name: "Plano Replay Test",
        workoutDays: VALID_7_DAYS,
      };

      // Execução 1
      const res1: any = await tools.createWorkoutPlanDraft.execute(inputPlan, {
        toolCallId: "replay-call-123",
      } as any);

      expect(res1.status).toBe("SAVED_DRAFT");
      const planId1 = res1.planId;

      // Confirma 1 plano no banco
      const count1 = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });
      expect(count1).toBe(1);

      // Replay / Double execution com o mesmo toolCallId
      const res2: any = await tools.createWorkoutPlanDraft.execute(inputPlan, {
        toolCallId: "replay-call-123",
      } as any);

      expect(res2.status).toBe("SAVED_DRAFT");
      expect(res2.planId).toBe(planId1);

      // Continua existindo exatamente 1 plano no banco
      const count2 = await prisma.workoutPlan.count({
        where: { userId: user.id },
      });
      expect(count2).toBe(1);
    });

    it("periodização com approval: bloqueia sem approval e é idempotente em replay", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const tools = getAiTools(user.id);

      const perInput = {
        name: "Ciclo Replay Test",
        goal: "Hipertrofia",
        notes: null,
        blocks: [
          {
            plan: {
              name: "Bloco 1",
              workoutDays: VALID_7_DAYS,
            },
            plannedStartDate: "2026-10-01",
            plannedEndDate: "2026-10-28",
          },
        ],
      };

      // 1. Execução direta com toolCallId
      const res1: any = await tools.createPeriodizationDraft.execute(perInput, {
        toolCallId: "replay-per-456",
      } as any);

      expect(res1.status).toBe("SAVED_DRAFT");
      const perId1 = res1.periodizationId;

      const perCount1 = await prisma.periodization.count({
        where: { userId: user.id },
      });
      expect(perCount1).toBe(1);

      // 2. Replay com mesmo toolCallId
      const res2: any = await tools.createPeriodizationDraft.execute(perInput, {
        toolCallId: "replay-per-456",
      } as any);

      expect(res2.periodizationId).toBe(perId1);

      const perCount2 = await prisma.periodization.count({
        where: { userId: user.id },
      });
      expect(perCount2).toBe(1);
    });
  });
});
