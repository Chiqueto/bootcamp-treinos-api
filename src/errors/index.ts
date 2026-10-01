export class NotFoundError extends Error {
  readonly code: string;

  constructor(message: string, code = "NOT_FOUND") {
    super(message);
    this.name = "NotFoundError";
    this.code = code;
  }
}

export class WorkoutPlanNotActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkoutPlanNotActiveError";
  }
}

export class ConflictError extends Error {
  readonly code: string;

  constructor(message: string, code = "CONFLICT") {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

export class ActiveWorkoutSessionError extends ConflictError {
  constructor(
    message = "Não é possível alterar o planejamento ativo enquanto houver uma sessão de treino em andamento.",
  ) {
    super(message, "ACTIVE_WORKOUT_SESSION");
    this.name = "ActiveWorkoutSessionError";
  }
}

export class PlanBelongsToPeriodizationError extends ConflictError {
  constructor(
    message = "Este plano pertence a uma periodização e não pode ser ativado diretamente como plano standalone.",
  ) {
    super(message, "PLAN_BELONGS_TO_PERIODIZATION");
    this.name = "PlanBelongsToPeriodizationError";
  }
}

export class PlanIsActivePeriodizationBlockError extends ConflictError {
  constructor(
    message = "Este plano é o bloco atual de uma periodização ativa. Pause a periodização para desativá-lo.",
  ) {
    super(message, "PLAN_IS_ACTIVE_PERIODIZATION_BLOCK");
    this.name = "PlanIsActivePeriodizationBlockError";
  }
}

export class ActivePeriodizationError extends ConflictError {
  constructor(
    message = "Existe uma periodização ativa. Crie o plano como inativo ou pause a periodização primeiro.",
  ) {
    super(message, "ACTIVE_PERIODIZATION");
    this.name = "ActivePeriodizationError";
  }
}

export class WorkoutSessionAlreadyCompletedError extends Error {
  constructor(message = "Workout session is already completed") {
    super(message);
    this.name = "WorkoutSessionAlreadyCompletedError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class PendingWorkoutSetsError extends Error {
  constructor(
    message = "Existem séries pendentes nesta sessão. Conclua ou remova todas as séries antes de finalizar o treino.",
  ) {
    super(message);
    this.name = "PendingWorkoutSetsError";
  }
}

export class PeriodizationAlreadyStartedError extends ConflictError {
  constructor(
    message = "A periodização já foi iniciada e não pode ser excluída.",
  ) {
    super(message, "PERIODIZATION_ALREADY_STARTED");
    this.name = "PeriodizationAlreadyStartedError";
  }
}

export class PeriodizationCompletedError extends ConflictError {
  constructor(
    message = "A periodização já foi concluída e sua estrutura não pode ser alterada.",
  ) {
    super(message, "PERIODIZATION_COMPLETED");
    this.name = "PeriodizationCompletedError";
  }
}

export class PlanAlreadyInPeriodizationError extends ConflictError {
  constructor(
    message = "Este plano de treino já pertence a uma periodização.",
  ) {
    super(message, "PLAN_ALREADY_IN_PERIODIZATION");
    this.name = "PlanAlreadyInPeriodizationError";
  }
}

export class ActivePlanCannotBeAttachedError extends ConflictError {
  constructor(
    message = "Um plano ativo não pode ser anexado a uma periodização. Desative-o primeiro.",
  ) {
    super(message, "ACTIVE_PLAN_CANNOT_BE_ATTACHED");
    this.name = "ActivePlanCannotBeAttachedError";
  }
}

export class ActiveBlockCannotBeRemovedError extends ConflictError {
  constructor(
    message = "O bloco atual em andamento não pode ser removido da periodização.",
  ) {
    super(message, "ACTIVE_BLOCK_CANNOT_BE_REMOVED");
    this.name = "ActiveBlockCannotBeRemovedError";
  }
}

export class CompletedBlockCannotBeRemovedError extends ConflictError {
  constructor(
    message = "Um bloco já concluído não pode ser removido da periodização.",
  ) {
    super(message, "COMPLETED_BLOCK_CANNOT_BE_REMOVED");
    this.name = "CompletedBlockCannotBeRemovedError";
  }
}

export class CompletedBlockImmutableError extends ConflictError {
  constructor(
    message = "As datas previstas de um bloco já concluído não podem ser alteradas.",
  ) {
    super(message, "COMPLETED_BLOCK_IMMUTABLE");
    this.name = "CompletedBlockImmutableError";
  }
}

export class InvalidReorderBlocksError extends ConflictError {
  constructor(
    message = "A reordenação deve conter exatamente os blocos futuros/planejados da periodização.",
  ) {
    super(message, "INVALID_REORDER_BLOCKS");
    this.name = "InvalidReorderBlocksError";
  }
}

export class PeriodizationHasNoPlansError extends ConflictError {
  constructor(
    message = "A periodização não possui planos cadastrados e não pode ser ativada.",
  ) {
    super(message, "PERIODIZATION_HAS_NO_PLANS");
    this.name = "PeriodizationHasNoPlansError";
  }
}

export class PeriodizationNotStartedError extends ConflictError {
  constructor(
    message = "A periodização ainda não foi iniciada.",
  ) {
    super(message, "PERIODIZATION_NOT_STARTED");
    this.name = "PeriodizationNotStartedError";
  }
}

export class PeriodizationNotActiveError extends ConflictError {
  constructor(
    message = "A periodização não está ativa.",
  ) {
    super(message, "PERIODIZATION_NOT_ACTIVE");
    this.name = "PeriodizationNotActiveError";
  }
}

export class NoOpenBlockError extends ConflictError {
  constructor(
    message = "Não há bloco aberto em andamento nesta periodização.",
  ) {
    super(message, "NO_OPEN_BLOCK");
    this.name = "NoOpenBlockError";
  }
}

export class InconsistentPlanningStateError extends ConflictError {
  constructor(
    message = "O estado do planejamento está inconsistente. Entre em contato com o suporte ou redefina o plano ativo.",
  ) {
    super(message, "INCONSISTENT_PLANNING_STATE");
    this.name = "InconsistentPlanningStateError";
  }
}

export class InvalidCursorError extends Error {
  readonly code = "INVALID_CURSOR";

  constructor(message = "Cursor de paginação inválido ou corrompido.") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export class InvalidTimezoneError extends Error {
  readonly code = "INVALID_TIMEZONE";

  constructor(message = "Timezone IANA inválido.") {
    super(message);
    this.name = "InvalidTimezoneError";
  }
}

export class InvalidDateRangeError extends Error {
  readonly code = "INVALID_DATE_RANGE";

  constructor(message = "Intervalo de datas inválido.") {
    super(message);
    this.name = "InvalidDateRangeError";
  }
}



