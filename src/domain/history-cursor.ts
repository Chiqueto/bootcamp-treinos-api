import { InvalidCursorError } from "../errors/index.js";

export interface HistoryCursorPayload {
  v: 1;
  completedAt: string;
  id: string;
}

const UUID_REGEX =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/;

/**
 * Codifica a boundary do cursor de histórico em string base64url opaca.
 */
export function encodeHistoryCursor(payload: {
  completedAt: string | Date;
  id: string;
}): string {
  const completedAt =
    typeof payload.completedAt === "string"
      ? payload.completedAt
      : payload.completedAt.toISOString();

  const data: HistoryCursorPayload = {
    v: 1,
    completedAt,
    id: payload.id,
  };

  return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

/**
 * Decodifica e valida o cursor opaco de histórico.
 * Lança InvalidCursorError (HTTP 400 INVALID_CURSOR) para qualquer inconformidade.
 */
export function decodeHistoryCursor(cursor: string): {
  completedAt: Date;
  id: string;
} {
  if (!cursor || typeof cursor !== "string" || cursor.trim().length === 0) {
    throw new InvalidCursorError("O cursor não pode ser vazio.");
  }

  let rawString: string;
  try {
    const buffer = Buffer.from(cursor, "base64url");
    // Se a string re-codificada for completamente discrepante ou gerar caracteres corrompidos
    rawString = buffer.toString("utf8");
    if (!rawString || rawString.trim().length === 0) {
      throw new Error("Base64url vazio");
    }
  } catch {
    throw new InvalidCursorError("Cursor possui codificação base64url inválida.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawString);
  } catch {
    throw new InvalidCursorError("Payload do cursor não é um JSON válido.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidCursorError("Formato do payload do cursor é inválido.");
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.v !== 1) {
    throw new InvalidCursorError(
      `Versão do cursor incompatível. Esperado: 1, recebido: ${String(candidate.v)}.`,
    );
  }

  if (typeof candidate.completedAt !== "string" || candidate.completedAt.trim().length === 0) {
    throw new InvalidCursorError("Data de conclusão no cursor é inválida.");
  }

  const completedAtDate = new Date(candidate.completedAt);
  if (isNaN(completedAtDate.getTime())) {
    throw new InvalidCursorError("Timestamp do cursor não corresponde a uma data ISO válida.");
  }

  if (typeof candidate.id !== "string" || !UUID_REGEX.test(candidate.id)) {
    throw new InvalidCursorError("Identificador da sessão no cursor não é um UUID válido.");
  }

  return {
    completedAt: completedAtDate,
    id: candidate.id,
  };
}
