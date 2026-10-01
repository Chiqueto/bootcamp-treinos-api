import { InvalidDateRangeError, InvalidTimezoneError } from "../errors/index.js";
import { MuscleGroup } from "../generated/prisma/client.js";

/**
 * Ordem canônica estável dos 13 grupos musculares para respostas analíticas.
 */
export const CANONICAL_MUSCLE_ORDER: MuscleGroup[] = [
  MuscleGroup.CHEST,
  MuscleGroup.BACK,
  MuscleGroup.SHOULDERS,
  MuscleGroup.BICEPS,
  MuscleGroup.TRICEPS,
  MuscleGroup.FOREARMS,
  MuscleGroup.QUADRICEPS,
  MuscleGroup.HAMSTRINGS,
  MuscleGroup.GLUTES,
  MuscleGroup.ADDUCTORS,
  MuscleGroup.HIP_ABDUCTORS,
  MuscleGroup.CALVES,
  MuscleGroup.CORE,
];

/**
 * Valida se a string informada é um fuso horário IANA válido.
 * Rejeita explicitamente offsets brutos como '-03:00' ou 'GMT-3'.
 */
export function validateIanaTimezone(tz: unknown): string {
  if (typeof tz !== "string" || !tz.trim()) {
    throw new InvalidTimezoneError("Timezone IANA é obrigatório.");
  }
  const trimmed = tz.trim();

  // Rejeitar offsets brutos fixos (ex: -03:00, +02, GMT-3, UTC+2)
  if (
    /^[+-]\d{1,2}(:\d{2})?$/.test(trimmed) ||
    /^GMT[+-]\d+$/i.test(trimmed) ||
    /^UTC[+-]\d+$/i.test(trimmed)
  ) {
    throw new InvalidTimezoneError(
      `Timezone '${trimmed}' é um offset fixo. Forneça um identificador IANA válido (ex: America/Sao_Paulo).`,
    );
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
  } catch {
    throw new InvalidTimezoneError(`Timezone '${trimmed}' não é um identificador IANA válido.`);
  }

  return trimmed;
}

/**
 * Valida uma data civil no formato YYYY-MM-DD e checa sua validade no calendário real.
 * Não permite que datas inexistentes (ex: 2026-02-31) sejam convertidas silenciosamente.
 */
export function validateCivilDate(dateStr: unknown, paramName = "date"): string {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    throw new InvalidDateRangeError(
      `Data '${dateStr}' para '${paramName}' é inválida. Formato esperado: YYYY-MM-DD.`,
    );
  }
  const trimmed = dateStr.trim();
  const [yearStr, monthStr, dayStr] = trimmed.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new InvalidDateRangeError(
      `Data '${trimmed}' contém valores de mês ou dia fora dos limites válidos.`,
    );
  }

  // Validação real de dias válidos no mês
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new InvalidDateRangeError(`Data civil '${trimmed}' não existe no calendário.`);
  }

  return trimmed;
}

/**
 * Valida intervalo de datas [startDate, endDate], garantindo formato, calendário real e startDate <= endDate.
 */
export function validateDateRange(
  startDateStr: unknown,
  endDateStr: unknown,
): { startDate: string; endDate: string } {
  if (!startDateStr || !endDateStr) {
    throw new InvalidDateRangeError("startDate e endDate devem ser ambos fornecidos.");
  }
  const startDate = validateCivilDate(startDateStr, "startDate");
  const endDate = validateCivilDate(endDateStr, "endDate");

  if (startDate > endDate) {
    throw new InvalidDateRangeError(
      `startDate (${startDate}) não pode ser posterior a endDate (${endDate}).`,
    );
  }

  return { startDate, endDate };
}

/**
 * Formata um objeto Date UTC em string civil YYYY-MM-DD.
 */
export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Adiciona N dias a uma data civil YYYY-MM-DD.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return formatUtcDate(date);
}

/**
 * Retorna a Segunda-feira da semana que contém a data civil informada.
 * Semana oficial: Segunda a Domingo.
 */
export function getMondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  const daysToMonday = (dayOfWeek + 6) % 7; // Domingo -> 6, Segunda -> 0, Terça -> 1, etc.
  return addDays(dateStr, -daysToMonday);
}

/**
 * Retorna o Domingo correspondente ao fim da semana que começa na segunda-feira informada.
 */
export function getSundayOfWeek(mondayStr: string): string {
  return addDays(mondayStr, 6);
}

/**
 * Gera lista contínua de semanas { weekStartDate, weekEndDate } entre duas segundas-feiras (inclusive).
 */
export function generateWeeksSequence(
  startMonday: string,
  endMonday: string,
): Array<{ weekStartDate: string; weekEndDate: string }> {
  const weeks: Array<{ weekStartDate: string; weekEndDate: string }> = [];
  let currentMonday = startMonday;

  while (currentMonday <= endMonday) {
    weeks.push({
      weekStartDate: currentMonday,
      weekEndDate: getSundayOfWeek(currentMonday),
    });
    currentMonday = addDays(currentMonday, 7);
  }

  return weeks;
}

/**
 * Obtém a data civil local atual em um timezone IANA.
 */
export function getTodayLocalDate(tz: string, now = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

/**
 * Calcula a janela de semanas quando weeksCount é fornecido (semana atual + N-1 anteriores).
 */
export function calculateWeeksCountRange(
  tz: string,
  weeksCount: number,
  now = new Date(),
): {
  startDate: string;
  endDate: string;
  weeks: Array<{ weekStartDate: string; weekEndDate: string }>;
} {
  const todayLocal = getTodayLocalDate(tz, now);
  const currentMonday = getMondayOfWeek(todayLocal);
  const startMonday = addDays(currentMonday, -(weeksCount - 1) * 7);
  const endSunday = getSundayOfWeek(currentMonday);

  const weeks = generateWeeksSequence(startMonday, currentMonday);

  return {
    startDate: startMonday,
    endDate: endSunday,
    weeks,
  };
}
