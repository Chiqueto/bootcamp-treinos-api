export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class WorkoutPlanNotActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkoutPlanNotActiveError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
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

