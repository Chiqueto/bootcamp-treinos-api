import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { describe, expect, it } from "vitest";

import { WeekDay } from "../../src/generated/prisma/enums.js";
import {
  calculateWorkoutStreak,
  StreakWorkoutDay,
} from "../../src/lib/streak.js";

dayjs.extend(utc);

describe("calculateWorkoutStreak Unit Tests", () => {
  // Configuração padrão de plano semanal:
  // Seg: Treino, Ter: Descanso, Qua: Treino, Qui: Treino, Sex: Treino, Sáb: Treino, Dom: Descanso
  function createStandardWeekPlan(): StreakWorkoutDay[] {
    return [
      { weekDay: WeekDay.MONDAY, isRest: false, sessions: [] },
      { weekDay: WeekDay.TUESDAY, isRest: true, sessions: [] },
      { weekDay: WeekDay.WEDNESDAY, isRest: false, sessions: [] },
      { weekDay: WeekDay.THURSDAY, isRest: false, sessions: [] },
      { weekDay: WeekDay.FRIDAY, isRest: false, sessions: [] },
      { weekDay: WeekDay.SATURDAY, isRest: false, sessions: [] },
      { weekDay: WeekDay.SUNDAY, isRest: true, sessions: [] },
    ];
  }

  it("1. Dois treinos concluídos consecutivos → streak 2", () => {
    // Quinta (hoje): concluído. Quarta (ontem): concluído.
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-12T12:00:00Z"); // Quinta-feira

    // Sessão Quarta
    plan.find((d) => d.weekDay === WeekDay.WEDNESDAY)!.sessions = [
      { startedAt: "2026-03-11T10:00:00Z", completedAt: "2026-03-11T11:00:00Z" },
    ];
    // Sessão Quinta
    plan.find((d) => d.weekDay === WeekDay.THURSDAY)!.sessions = [
      { startedAt: "2026-03-12T10:00:00Z", completedAt: "2026-03-12T11:00:00Z" },
    ];

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: 0,
    });

    expect(streak).toBe(2);
  });

  it("2. Treino + descanso + treino → streak 2", () => {
    // Quarta (hoje): concluído. Terça: descanso. Segunda: concluído.
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-11T12:00:00Z"); // Quarta-feira

    // Sessão Segunda
    plan.find((d) => d.weekDay === WeekDay.MONDAY)!.sessions = [
      { startedAt: "2026-03-09T10:00:00Z", completedAt: "2026-03-09T11:00:00Z" },
    ];
    // Sessão Quarta
    plan.find((d) => d.weekDay === WeekDay.WEDNESDAY)!.sessions = [
      { startedAt: "2026-03-11T10:00:00Z", completedAt: "2026-03-11T11:00:00Z" },
    ];

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: 0,
    });

    expect(streak).toBe(2);
  });

  it("3. Descanso não incrementa streak (apenas preserva)", () => {
    // Terça (hoje): descanso. Segunda: concluído.
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-10T12:00:00Z"); // Terça-feira (Descanso)

    // Sessão Segunda
    plan.find((d) => d.weekDay === WeekDay.MONDAY)!.sessions = [
      { startedAt: "2026-03-09T10:00:00Z", completedAt: "2026-03-09T11:00:00Z" },
    ];

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: 0,
    });

    // Deve ser 1 (de Segunda) e NÃO 2, comprovando que Terça não incrementou
    expect(streak).toBe(1);
  });

  it("4. Treino perdido no passado quebra streak", () => {
    // Quinta (hoje): concluído. Quarta: perdido. Terça: descanso. Segunda: concluído.
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-12T12:00:00Z"); // Quinta-feira

    // Sessão Segunda
    plan.find((d) => d.weekDay === WeekDay.MONDAY)!.sessions = [
      { startedAt: "2026-03-09T10:00:00Z", completedAt: "2026-03-09T11:00:00Z" },
    ];
    // Quarta NÃO tem sessão (treino perdido)
    // Sessão Quinta
    plan.find((d) => d.weekDay === WeekDay.THURSDAY)!.sessions = [
      { startedAt: "2026-03-12T10:00:00Z", completedAt: "2026-03-12T11:00:00Z" },
    ];

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: 0,
    });

    // Quarta quebrou o streak; apenas a Quinta é contada
    expect(streak).toBe(1);
  });

  it("5. Treino de hoje ainda não concluído não quebra streak", () => {
    // Quinta (hoje): ainda não treinou. Quarta: concluído. Terça: descanso. Segunda: concluído.
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-12T12:00:00Z"); // Quinta-feira

    // Sessão Segunda
    plan.find((d) => d.weekDay === WeekDay.MONDAY)!.sessions = [
      { startedAt: "2026-03-09T10:00:00Z", completedAt: "2026-03-09T11:00:00Z" },
    ];
    // Sessão Quarta
    plan.find((d) => d.weekDay === WeekDay.WEDNESDAY)!.sessions = [
      { startedAt: "2026-03-11T10:00:00Z", completedAt: "2026-03-11T11:00:00Z" },
    ];
    // Quinta: sem sessão

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: 0,
    });

    // O streak acumulado de Quarta e Segunda (2) deve ser preservado enquanto hoje está em andamento
    expect(streak).toBe(2);
  });

  it("6. Dia futuro não interfere no cálculo do streak", () => {
    // Quarta (hoje): concluído. Quinta (amanhã): tem sessão agendada/futura sem conclusão.
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-11T12:00:00Z"); // Quarta-feira

    // Sessão Quarta
    plan.find((d) => d.weekDay === WeekDay.WEDNESDAY)!.sessions = [
      { startedAt: "2026-03-11T10:00:00Z", completedAt: "2026-03-11T11:00:00Z" },
    ];

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: 0,
    });

    expect(streak).toBe(1);
  });

  it("7. TimezoneOffset: respeita a data civil local do usuário no cálculo", () => {
    // Usuário em São Paulo (UTC-3: timezoneOffset = -180).
    // Treino realizado às 22h do dia 11 em SP (que é 01:00 UTC do dia 12).
    const plan = createStandardWeekPlan();
    const currentDate = dayjs.utc("2026-03-11T23:00:00-03:00"); // Noite do dia 11 em SP

    plan.find((d) => d.weekDay === WeekDay.WEDNESDAY)!.sessions = [
      {
        startedAt: "2026-03-12T01:00:00Z", // 22h do dia 11 no fuso -180
        completedAt: "2026-03-12T02:00:00Z", // 23h do dia 11 no fuso -180
      },
    ];

    const streak = calculateWorkoutStreak({
      workoutDays: plan,
      currentDate,
      timezoneOffset: -180,
    });

    // Com timezoneOffset correto, a sessão pertence a 2026-03-11 e conta como concluída
    expect(streak).toBe(1);
  });
});
