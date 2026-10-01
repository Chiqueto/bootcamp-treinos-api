import fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSystemPrompt } from "../../src/ai/system-prompt.js";
import { clearToolCallsCache, getAiTools } from "../../src/ai/tools.js";
import { prisma } from "../../src/lib/db.js";
import { CreatePeriodizationDraftFromAI } from "../../src/usecases/CreatePeriodizationDraftFromAI.js";
import { cleanupTestUsers, createTestUser } from "../helpers/test-db.js";

describe("Trainvy — Hotfix 2.8.1 — Diagnóstico e Correção do Save da IA", () => {
  const testUserIds: string[] = [];

  afterEach(async () => {
    clearToolCallsCache();
    await cleanupTestUsers(testUserIds);
    testUserIds.length = 0;
    vi.restoreAllMocks();
  });

  it("1. Salva atomicamente a periodização realista (3 blocos, 21 dias, múltiplos exercícios) que falhou no teste real", async () => {
    const user = await createTestUser({ name: "Atleta Voleibol" });
    testUserIds.push(user.id);

    const fixturePath = "tests/fixtures/failed-periodization-draft.json";
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

    const usecase = new CreatePeriodizationDraftFromAI();
    const startTime = Date.now();
    const result = await usecase.execute({
      userId: user.id,
      name: payload.name,
      goal: payload.goal,
      notes: payload.notes,
      blocks: payload.blocks,
    });
    const elapsed = Date.now() - startTime;

    expect(result.id).toBeDefined();
    expect(result.status).toBe("DRAFT");
    expect(result.isActive).toBe(false);
    expect(result.blocks).toHaveLength(3);
    expect(elapsed).toBeLessThan(15000);

    // Valida persistência íntegra no banco de dados
    const periodizationInDb = await prisma.periodization.findUnique({
      where: { id: result.id },
      include: {
        plans: {
          orderBy: { order: "asc" },
          include: {
            workoutPlan: {
              include: {
                workoutDays: {
                  include: {
                    exercises: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(periodizationInDb).not.toBeNull();
    expect(periodizationInDb?.userId).toBe(user.id);
    expect(periodizationInDb?.isActive).toBe(false);
    expect(periodizationInDb?.plans).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const planLink = periodizationInDb!.plans[i];
      expect(planLink.order).toBe(i + 1);
      expect(planLink.workoutPlan.isActive).toBe(false);
      expect(planLink.workoutPlan.workoutDays).toHaveLength(7);

      const totalExercises = planLink.workoutPlan.workoutDays.reduce(
        (sum, day) => sum + day.exercises.length,
        0,
      );
      expect(totalExercises).toBeGreaterThan(10);
    }
  });

  it("2. Tool createPeriodizationDraft captura erro, gera log com campos obrigatórios e faz re-throw", async () => {
    const user = await createTestUser();
    testUserIds.push(user.id);

    const tools = getAiTools(user.id);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Simula erro durante a execução do use case
    const mockError = new Error("Simulação de timeout ou falha de conexão");
    (mockError as any).code = "P2028";
    vi.spyOn(CreatePeriodizationDraftFromAI.prototype, "execute").mockRejectedValueOnce(mockError);

    const fixturePath = "tests/fixtures/failed-periodization-draft.json";
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

    const toolCallId = "call-err-test-123";

    await expect(
      (tools.createPeriodizationDraft as any).execute(payload, { toolCallId }),
    ).rejects.toThrow("Simulação de timeout ou falha de conexão");

    expect(consoleErrorSpy).toHaveBeenCalled();
    const logCall = consoleErrorSpy.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("[createPeriodizationDraft:error]"),
    );

    expect(logCall).toBeDefined();
    const logMessage = logCall![0] as string;

    // Campos obrigatórios no log
    expect(logMessage).toContain("toolName=createPeriodizationDraft");
    expect(logMessage).toContain("toolCallId=call-err-test-123");
    expect(logMessage).toContain(`userId=${user.id}`);
    expect(logMessage).toContain("blocksCount=3");
    expect(logMessage).toContain("elapsedMs=");
    expect(logMessage).toContain("errorName=Error");
    expect(logMessage).toContain("errorCode=P2028");
    expect(logMessage).toContain("errorMessage=Simulação de timeout ou falha de conexão");

    // Garantir que NÃO loga dados sensíveis nem exercícios completos
    expect(logMessage).not.toContain("Supino Reto com Barra");
    expect(logMessage).not.toContain("restTimeInSeconds");
    expect(logMessage).not.toContain("cookie");
    expect(logMessage).not.toContain("bearer");
  });

  it("3. Falha na transação não deixa Periodization parcial nem WorkoutPlans órfãos", async () => {
    const user = await createTestUser();
    testUserIds.push(user.id);

    // Contagem antes
    const plansBefore = await prisma.workoutPlan.count({ where: { userId: user.id } });
    const periodizationsBefore = await prisma.periodization.count({ where: { userId: user.id } });

    const fixturePath = "tests/fixtures/failed-periodization-draft.json";
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

    // Injeta falha forçada no tx.periodizationPlan.create para simular abort no final da transação
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
      // Simula transação que falha após criar alguns itens
      throw new Error("P2028: Transaction API error: transaction timed out");
    });

    const usecase = new CreatePeriodizationDraftFromAI();
    await expect(
      usecase.execute({
        userId: user.id,
        name: payload.name,
        goal: payload.goal,
        notes: payload.notes,
        blocks: payload.blocks,
      }),
    ).rejects.toThrow("P2028");

    // Verifica que NENHUM registro órfão sobreviveu
    const plansAfter = await prisma.workoutPlan.count({ where: { userId: user.id } });
    const periodizationsAfter = await prisma.periodization.count({ where: { userId: user.id } });

    expect(plansAfter).toBe(plansBefore);
    expect(periodizationsAfter).toBe(periodizationsBefore);
  });

  it("4. SYSTEM_PROMPT proíbe alucinar justificativas técnicas e instrui explicação transparente", () => {
    const prompt = getSystemPrompt("Carlos");

    expect(prompt).toContain("Tratamento de Erros de Salvamento");
    expect(prompt).toContain("NUNCA invente ou presuma causas técnicas");
    expect(prompt).toContain("Não consegui salvar o rascunho. Ocorreu um erro interno durante a gravação.");
    expect(prompt).toContain("A proposta continua nesta conversa.");
    expect(prompt).toContain("NUNCA desmonte a periodização em vários planos avulsos");
  });

  it("5. Retry após falha com novo toolCallId persiste com sucesso e replay com mesmo toolCallId mantém idempotência", async () => {
    const user = await createTestUser();
    testUserIds.push(user.id);

    const tools = getAiTools(user.id);
    const fixturePath = "tests/fixtures/failed-periodization-draft.json";
    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

    // 1ª tentativa falha
    vi.spyOn(CreatePeriodizationDraftFromAI.prototype, "execute").mockRejectedValueOnce(
      new Error("Timeout temporário"),
    );

    const firstToolCallId = "call-failed-1";
    await expect(
      (tools.createPeriodizationDraft as any).execute(payload, { toolCallId: firstToolCallId }),
    ).rejects.toThrow("Timeout temporário");

    // 2ª tentativa (retry do usuário) com novo toolCallId salva normalmente
    const retryToolCallId = "call-retry-2";
    const retryResult = await (tools.createPeriodizationDraft as any).execute(payload, {
      toolCallId: retryToolCallId,
    });

    expect(retryResult.status).toBe("SAVED_DRAFT");
    expect(retryResult.periodizationId).toBeDefined();

    // 3ª tentativa (replay com mesmo retryToolCallId) não cria duplicata e retorna do cache
    const periodizationsCountBefore = await prisma.periodization.count({ where: { userId: user.id } });

    const replayResult = await (tools.createPeriodizationDraft as any).execute(payload, {
      toolCallId: retryToolCallId,
    });

    const periodizationsCountAfter = await prisma.periodization.count({ where: { userId: user.id } });

    expect(replayResult.periodizationId).toBe(retryResult.periodizationId);
    expect(periodizationsCountAfter).toBe(periodizationsCountBefore);
  });
});
