import { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearToolCallsCache, getAiTools } from "../../src/ai/tools.js";
import { NotFoundError } from "../../src/errors/index.js";
import { WeekDay } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { CreateAiConversation, generateCleanTitle } from "../../src/usecases/CreateAiConversation.js";
import { DeleteAiConversation } from "../../src/usecases/DeleteAiConversation.js";
import { GetAiConversation } from "../../src/usecases/GetAiConversation.js";
import { ListAiConversations } from "../../src/usecases/ListAiConversations.js";
import { SaveAiMessages } from "../../src/usecases/SaveAiMessages.js";
import { cleanupTestUsers, createTestUser } from "../helpers/test-db.js";

const VALID_7_DAYS = [
  {
    name: "Superior A",
    weekDay: WeekDay.MONDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      { order: 1, name: "Supino", sets: 3, reps: 10, restTimeInSeconds: 60 },
    ],
  },
  {
    name: "Inferior A",
    weekDay: WeekDay.TUESDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      { order: 1, name: "Agachamento", sets: 3, reps: 10, restTimeInSeconds: 60 },
    ],
  },
  {
    name: "Descanso 1",
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
      { order: 1, name: "Desenvolvimento", sets: 3, reps: 10, restTimeInSeconds: 60 },
    ],
  },
  {
    name: "Inferior B",
    weekDay: WeekDay.FRIDAY,
    isRest: false,
    estimatedDurationInSeconds: 3600,
    coverImageUrl: null,
    exercises: [
      { order: 1, name: "Leg Press", sets: 3, reps: 10, restTimeInSeconds: 60 },
    ],
  },
  {
    name: "Descanso 2",
    weekDay: WeekDay.SATURDAY,
    isRest: true,
    estimatedDurationInSeconds: 0,
    coverImageUrl: null,
    exercises: [],
  },
  {
    name: "Descanso 3",
    weekDay: WeekDay.SUNDAY,
    isRest: true,
    estimatedDurationInSeconds: 0,
    coverImageUrl: null,
    exercises: [],
  },
];

describe("Coach AI - Chat Persistente e Confiabilidade (Task 2.8)", () => {
  const createdUserIds: string[] = [];

  beforeEach(() => {
    clearToolCallsCache();
  });

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
    clearToolCallsCache();
  });

  describe("generateCleanTitle", () => {
    it("deve truncar e limpar frases comuns para gerar títulos MVP concisos", () => {
      expect(
        generateCleanTitle("Quero montar uma periodização para vôlei"),
      ).toBe("Periodização para vôlei");

      expect(
        generateCleanTitle("monte um plano de hipertrofia focado em pernas"),
      ).toBe("Plano de hipertrofia focado em pernas");

      expect(
        generateCleanTitle("ajude-me a organizar minha rotina de treino"),
      ).toBe("Organizar minha rotina de treino");

      expect(generateCleanTitle("")).toBe("Nova conversa");
      expect(generateCleanTitle(null)).toBe("Nova conversa");
    });
  });

  describe("CreateAiConversation & ListAiConversations", () => {
    it("cria conversa automaticamente a partir da mensagem e lista ordenada por updatedAt DESC", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const createUsecase = new CreateAiConversation();
      const listUsecase = new ListAiConversations();

      const conv1 = await createUsecase.execute({
        userId: user.id,
        initialMessageText: "Quero montar uma periodização para vôlei",
      });

      expect(conv1.title).toBe("Periodização para vôlei");

      // Cria segunda conversa
      const conv2 = await createUsecase.execute({
        userId: user.id,
        title: "Plano de força",
      });

      const list = await listUsecase.execute({ userId: user.id });
      expect(list.length).toBe(2);
      expect(list[0].id).toBe(conv2.id); // Mais recente primeiro
      expect(list[1].id).toBe(conv1.id);
    });

    it("isola conversas entre usuários distintos", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      createdUserIds.push(userA.id, userB.id);

      const createUsecase = new CreateAiConversation();
      const listUsecase = new ListAiConversations();

      await createUsecase.execute({
        userId: userA.id,
        title: "Conversa do Usuário A",
      });

      await createUsecase.execute({
        userId: userB.id,
        title: "Conversa do Usuário B",
      });

      const listA = await listUsecase.execute({ userId: userA.id });
      const listB = await listUsecase.execute({ userId: userB.id });

      expect(listA.length).toBe(1);
      expect(listA[0].title).toBe("Conversa do Usuário A");

      expect(listB.length).toBe(1);
      expect(listB[0].title).toBe("Conversa do Usuário B");
    });
  });

  describe("GetAiConversation & Ownership", () => {
    it("retorna conversa e mensagens para o dono, mas rejeita com 404/NotFoundError para outro usuário", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      createdUserIds.push(userA.id, userB.id);

      const createUsecase = new CreateAiConversation();
      const getUsecase = new GetAiConversation();

      const conv = await createUsecase.execute({
        userId: userA.id,
        title: "Conversa Privada",
      });

      const foundA = await getUsecase.execute({
        userId: userA.id,
        conversationId: conv.id,
      });
      expect(foundA.id).toBe(conv.id);

      // Usuário B tentando acessar conversa de A deve lançar NotFoundError
      await expect(
        getUsecase.execute({
          userId: userB.id,
          conversationId: conv.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("SaveAiMessages - Preservação de UIMessage completa", () => {
    it("persiste e reconstrói UIMessage com texto, approval-responded e output-available", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const createUsecase = new CreateAiConversation();
      const saveMessages = new SaveAiMessages();
      const getUsecase = new GetAiConversation();

      const conv = await createUsecase.execute({
        userId: user.id,
        title: "Thread com Tool Approval",
      });

      const sampleMessages: UIMessage[] = [
        {
          id: "msg-user-1",
          role: "user",
          parts: [{ type: "text", text: "Monte um plano de treino" }],
        },
        {
          id: "msg-assistant-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Aqui está o plano proposto:" },
            {
              type: "tool-createWorkoutPlanDraft" as any,
              state: "output-available",
              input: { name: "Hipertrofia 4x", workoutDays: VALID_7_DAYS },
              output: {
                status: "SAVED_DRAFT",
                planId: "plan-uuid-123",
                name: "Hipertrofia 4x",
                isActive: false,
              },
              approval: { id: "appr-1", approved: true },
            } as any,
          ],
        },
      ];

      await saveMessages.execute({
        userId: user.id,
        conversationId: conv.id,
        messages: sampleMessages,
      });

      // Recarrega conversa
      const loaded = await getUsecase.execute({
        userId: user.id,
        conversationId: conv.id,
      });

      expect(loaded.messages.length).toBe(2);
      const assistantMsg = loaded.messages[1] as any;
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.parts.length).toBe(2);
      expect(assistantMsg.parts[1].state).toBe("output-available");
      expect(assistantMsg.parts[1].output.planId).toBe("plan-uuid-123");
      expect(assistantMsg.parts[1].approval.approved).toBe(true);
    });
  });

  describe("DeleteAiConversation - Recursos Criados são Independentes", () => {
    it("deleta apenas conversa e mensagens; NÃO deleta planos ou periodizações criados", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const tools = getAiTools(user.id);
      const createUsecase = new CreateAiConversation();
      const deleteUsecase = new DeleteAiConversation();

      const conv = await createUsecase.execute({
        userId: user.id,
        title: "Conversa com Criação de Plano",
      });

      // Simula criação do plano via tool do Coach
      const createdPlan: any = await tools.createWorkoutPlanDraft.execute(
        {
          name: "Plano Sobrevivente",
          workoutDays: VALID_7_DAYS,
        },
        { toolCallId: "call-del-test-1" } as any,
      );

      const planId = createdPlan.planId;
      expect(planId).toBeDefined();

      // Deleta a conversa
      const delResult = await deleteUsecase.execute({
        userId: user.id,
        conversationId: conv.id,
      });
      expect(delResult.success).toBe(true);

      // Conversa foi removida
      const convInDb = await prisma.aiConversation.findUnique({
        where: { id: conv.id },
      });
      expect(convInDb).toBeNull();

      // WorkoutPlan PERMANECE INTACTO no banco!
      const planInDb = await prisma.workoutPlan.findUnique({
        where: { id: planId },
      });
      expect(planInDb).not.toBeNull();
      expect(planInDb?.name).toBe("Plano Sobrevivente");
    });
  });

  describe("Durable Idempotency com AiToolExecution", () => {
    it("persiste execução em banco e evita duplicações mesmo após limpar o cache em memória", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const tools = getAiTools(user.id);
      const toolCallId = "durable-call-999";

      const input = {
        name: "Plano Idempotente Durável",
        workoutDays: VALID_7_DAYS,
      };

      // 1. Primeira execução
      const res1: any = await tools.createWorkoutPlanDraft.execute(input, {
        toolCallId,
      } as any);

      expect(res1.status).toBe("SAVED_DRAFT");
      const planId1 = res1.planId;

      // Verifica que AiToolExecution foi gravado no banco de dados
      const executionInDb = await prisma.aiToolExecution.findUnique({
        where: {
          userId_toolCallId: {
            userId: user.id,
            toolCallId,
          },
        },
      });
      expect(executionInDb).not.toBeNull();
      expect(executionInDb?.toolName).toBe("createWorkoutPlanDraft");

      // 2. Simula restart / nova instância limpando a memória!
      clearToolCallsCache();

      // 3. Segunda execução com mesmo toolCallId após restart
      const res2: any = await tools.createWorkoutPlanDraft.execute(input, {
        toolCallId,
      } as any);

      expect(res2.planId).toBe(planId1);

      // Confirma que NÃO duplicou o plano no banco
      const plansCount = await prisma.workoutPlan.count({
        where: {
          userId: user.id,
          name: "Plano Idempotente Durável",
        },
      });
      expect(plansCount).toBe(1);
    });
  });
});
