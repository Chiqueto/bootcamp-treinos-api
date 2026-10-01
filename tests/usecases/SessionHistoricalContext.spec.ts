import { afterEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "../../src/errors/index.js";
import { SetType, WeekDay, WorkoutSessionOrigin } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/db.js";
import { AddExerciseToWorkoutSession } from "../../src/usecases/AddExerciseToWorkoutSession.js";
import { CompleteWorkoutSession } from "../../src/usecases/CompleteWorkoutSession.js";
import { CreateWorkoutSet } from "../../src/usecases/CreateWorkoutSet.js";
import { GetActiveWorkoutSession } from "../../src/usecases/GetActiveWorkoutSession.js";
import { GetWorkoutSession } from "../../src/usecases/GetWorkoutSession.js";
import { StartFreeWorkoutSession } from "../../src/usecases/StartFreeWorkoutSession.js";
import { StartWorkoutSession } from "../../src/usecases/StartWorkoutSession.js";
import {
  cleanupTestUsers,
  createTestExercise,
  createTestUser,
  createTestWorkoutPlan,
} from "../helpers/test-db.js";

describe("Task 3.1B — Persistência Histórica, Origem da Sessão e Snapshots", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await cleanupTestUsers(createdUserIds);
  });

  describe("Start Planned WorkoutSession (Item 19)", () => {
    it("deve iniciar sessão planejada com origin=PLANNED, workoutPlanId e snapshots fiéis", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Hipertrofia Foco Pernas",
        isActive: true,
      });

      const day = await prisma.workoutDay.create({
        data: {
          workoutPlanId: plan.id,
          name: "Inferior Completo",
          weekDay: WeekDay.MONDAY,
          estimatedDurationInSeconds: 3600,
          isRest: false,
        },
      });

      const start = new StartWorkoutSession();
      const result = await start.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      expect(result.userWorkoutSessionId).toBeDefined();
      expect(result.origin).toBe(WorkoutSessionOrigin.PLANNED);
      expect(result.workoutPlanId).toBe(plan.id);
      expect(result.workoutPlanNameSnapshot).toBe("Hipertrofia Foco Pernas");
      expect(result.workoutDayNameSnapshot).toBe("Inferior Completo");

      // Consulta no banco diretamente
      const sessionInDb = await prisma.workoutSession.findUnique({
        where: { id: result.userWorkoutSessionId },
      });

      expect(sessionInDb?.origin).toBe(WorkoutSessionOrigin.PLANNED);
      expect(sessionInDb?.workoutDayId).toBe(day.id);
      expect(sessionInDb?.workoutPlanId).toBe(plan.id);
      expect(sessionInDb?.workoutPlanNameSnapshot).toBe("Hipertrofia Foco Pernas");
      expect(sessionInDb?.workoutDayNameSnapshot).toBe("Inferior Completo");
    });
  });

  describe("Start Free WorkoutSession (Item 20)", () => {
    it("deve iniciar sessão avulsa com origin=FREE e campos de contexto/snapshot estritamente nulos", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const startFree = new StartFreeWorkoutSession();
      const result = await startFree.execute({
        userId: user.id,
      });

      expect(result.userWorkoutSessionId).toBeDefined();
      expect(result.origin).toBe(WorkoutSessionOrigin.FREE);
      expect(result.workoutDayId).toBeNull();
      expect(result.workoutPlanId).toBeNull();
      expect(result.workoutPlanNameSnapshot).toBeNull();
      expect(result.workoutDayNameSnapshot).toBeNull();

      // Consulta no banco diretamente
      const sessionInDb = await prisma.workoutSession.findUnique({
        where: { id: result.userWorkoutSessionId },
      });

      expect(sessionInDb?.origin).toBe(WorkoutSessionOrigin.FREE);
      expect(sessionInDb?.workoutDayId).toBeNull();
      expect(sessionInDb?.workoutPlanId).toBeNull();
      expect(sessionInDb?.workoutPlanNameSnapshot).toBeNull();
      expect(sessionInDb?.workoutDayNameSnapshot).toBeNull();
    });
  });

  describe("Imutabilidade de Snapshot (Item 21)", () => {
    it("preserva snapshots históricos originais mesmo se WorkoutPlan ou WorkoutDay forem renomeados ou alterados", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Força Base Outono",
        isActive: true,
      });

      const day = await prisma.workoutDay.create({
        data: {
          workoutPlanId: plan.id,
          name: "Upper A - Força",
          weekDay: WeekDay.TUESDAY,
          estimatedDurationInSeconds: 3600,
          isRest: false,
        },
      });

      const start = new StartWorkoutSession();
      const started = await start.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      // Usuário altera o nome do plano e do dia posteriormente
      await prisma.workoutPlan.update({
        where: { id: plan.id },
        data: { name: "Força Avançada Inverno (Renomeado)" },
      });

      await prisma.workoutDay.update({
        where: { id: day.id },
        data: { name: "Upper A - Hipertrofia (Renomeado)" },
      });

      // Leitura da sessão via GetWorkoutSession e GetActiveWorkoutSession
      const getSession = new GetWorkoutSession();
      const getActive = new GetActiveWorkoutSession();

      const session = await getSession.execute({
        userId: user.id,
        sessionId: started.userWorkoutSessionId,
      });

      const active = await getActive.execute({
        userId: user.id,
      });

      // Snapshots devem continuar com os valores no momento em que o treino foi iniciado!
      expect(session.workoutPlanNameSnapshot).toBe("Força Base Outono");
      expect(session.workoutDayNameSnapshot).toBe("Upper A - Força");

      expect(active.workoutPlanNameSnapshot).toBe("Força Base Outono");
      expect(active.workoutDayNameSnapshot).toBe("Upper A - Força");
    });
  });

  describe("Sessão Recorrente & Invariantes de Sessão Ativa (Item 22)", () => {
    it("mantém a regra de 1 sessão ativa por atleta, mas permite reexecutar o mesmo WorkoutDay após concluir", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);

      const plan = await createTestWorkoutPlan(user.id, {
        name: "Plano Recorrente",
        isActive: true,
      });

      const day = await prisma.workoutDay.create({
        data: {
          workoutPlanId: plan.id,
          name: "Full Body A",
          weekDay: WeekDay.WEDNESDAY,
          estimatedDurationInSeconds: 3600,
          isRest: false,
        },
      });

      const start = new StartWorkoutSession();
      const complete = new CompleteWorkoutSession();

      // 1. Inicia primeira sessão
      const s1 = await start.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      // Tentar iniciar segunda sessão com a primeira em andamento deve falhar com conflito
      await expect(
        start.execute({
          userId: user.id,
          workoutPlanId: plan.id,
          workoutDayId: day.id,
        }),
      ).rejects.toThrow(ConflictError);

      // Conclui primeira sessão
      await complete.execute({
        userId: user.id,
        sessionId: s1.userWorkoutSessionId,
      });

      // 2. Permite reexecutar o mesmo WorkoutDay em nova sessão
      const s2 = await start.execute({
        userId: user.id,
        workoutPlanId: plan.id,
        workoutDayId: day.id,
      });

      expect(s2.userWorkoutSessionId).not.toBe(s1.userWorkoutSessionId);
      expect(s2.origin).toBe(WorkoutSessionOrigin.PLANNED);
      expect(s2.workoutDayNameSnapshot).toBe("Full Body A");
    });
  });

  describe("Fluxo de Treino Avulso (Item 23)", () => {
    it("completa fluxo de sessão avulsa FREE: criar, adicionar exercício, registrar série e concluir", async () => {
      const user = await createTestUser();
      createdUserIds.push(user.id);
      const exercise = await createTestExercise();

      const startFree = new StartFreeWorkoutSession();
      const addExercise = new AddExerciseToWorkoutSession();
      const createSet = new CreateWorkoutSet();
      const complete = new CompleteWorkoutSession();
      const getSession = new GetWorkoutSession();

      // 1. Inicia FREE
      const session = await startFree.execute({ userId: user.id });
      expect(session.origin).toBe(WorkoutSessionOrigin.FREE);

      // 2. Adiciona exercício
      const sessionExercise = await addExercise.execute({
        userId: user.id,
        sessionId: session.workoutSessionId,
        exerciseId: exercise.id,
      });

      // 3. Adiciona série concluída
      await createSet.execute({
        userId: user.id,
        sessionExerciseId: sessionExercise.id,
        order: 1,
        type: SetType.WORKING,
        reps: 10,
        weightInGrams: 50000,
        completed: true,
      });

      // 4. Conclui
      const completed = await complete.execute({
        userId: user.id,
        sessionId: session.workoutSessionId,
      });
      expect(completed.completedAt).toBeDefined();

      // 5. Verifica sessão salva
      const details = await getSession.execute({
        userId: user.id,
        sessionId: session.workoutSessionId,
      });
      expect(details.origin).toBe(WorkoutSessionOrigin.FREE);
      expect(details.workoutPlanId).toBeNull();
      expect(details.sessionExercises.length).toBe(1);
    });
  });

  describe("Ownership & Segurança contra IDOR (Item 25)", () => {
    it("não permite que Usuário B inicie sessão para WorkoutDay do Usuário A e deriva workoutPlanId do servidor", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      createdUserIds.push(userA.id, userB.id);

      const planA = await createTestWorkoutPlan(userA.id, {
        name: "Plano do Usuário A",
        isActive: true,
      });

      const dayA = await prisma.workoutDay.create({
        data: {
          workoutPlanId: planA.id,
          name: "Dia de A",
          weekDay: WeekDay.FRIDAY,
          estimatedDurationInSeconds: 3600,
          isRest: false,
        },
      });

      const start = new StartWorkoutSession();

      // Usuário B tentando iniciar com dados de A deve ser rejeitado com NotFoundError
      await expect(
        start.execute({
          userId: userB.id,
          workoutPlanId: planA.id,
          workoutDayId: dayA.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
