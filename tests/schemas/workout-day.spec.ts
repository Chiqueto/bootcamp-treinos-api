import { describe, expect, it } from "vitest";

import { WeekDay } from "../../src/generated/prisma/enums.js";
import { WorkoutDaySchema } from "../../src/schemas/index.js";

describe("WorkoutDaySchema Invariants", () => {
  const validExercise = {
    order: 0,
    name: "Supino Reto",
    sets: 3,
    reps: 10,
    restTimeInSeconds: 60,
  };

  it("1. Descanso com duração 0 e exercícios vazios → válido", () => {
    const data = {
      name: "Descanso",
      weekDay: WeekDay.SUNDAY,
      isRest: true,
      estimatedDurationInSeconds: 0,
      coverImageUrl: null,
      exercises: [],
    };

    const parsed = WorkoutDaySchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it("2. Treino com duração positiva e exercício → válido", () => {
    const data = {
      name: "Superior A",
      weekDay: WeekDay.MONDAY,
      isRest: false,
      estimatedDurationInSeconds: 3600,
      coverImageUrl: null,
      exercises: [validExercise],
    };

    const parsed = WorkoutDaySchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it("3. Descanso com duração positiva → inválido", () => {
    const data = {
      name: "Descanso Inválido",
      weekDay: WeekDay.SUNDAY,
      isRest: true,
      estimatedDurationInSeconds: 3600,
      coverImageUrl: null,
      exercises: [],
    };

    const parsed = WorkoutDaySchema.safeParse(data);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(
        /estimatedDurationInSeconds igual a 0/i,
      );
    }
  });

  it("4. Descanso com exercício → inválido", () => {
    const data = {
      name: "Descanso com Exercício",
      weekDay: WeekDay.SUNDAY,
      isRest: true,
      estimatedDurationInSeconds: 0,
      coverImageUrl: null,
      exercises: [validExercise],
    };

    const parsed = WorkoutDaySchema.safeParse(data);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(
        /não devem conter exercícios/i,
      );
    }
  });

  it("5. Treino com duração 0 → inválido", () => {
    const data = {
      name: "Treino Duração Zero",
      weekDay: WeekDay.MONDAY,
      isRest: false,
      estimatedDurationInSeconds: 0,
      coverImageUrl: null,
      exercises: [validExercise],
    };

    const parsed = WorkoutDaySchema.safeParse(data);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(
        /estimatedDurationInSeconds maior que 0/i,
      );
    }
  });

  it("6. Treino sem exercícios → inválido", () => {
    const data = {
      name: "Treino Sem Exercício",
      weekDay: WeekDay.MONDAY,
      isRest: false,
      estimatedDurationInSeconds: 3600,
      coverImageUrl: null,
      exercises: [],
    };

    const parsed = WorkoutDaySchema.safeParse(data);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(
        /conter pelo menos um exercício/i,
      );
    }
  });
});
