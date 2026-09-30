import { fromNodeHeaders } from "better-auth/node";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import {
  ConflictError,
  NotFoundError,
  PendingWorkoutSetsError,
  ValidationError,
  WorkoutSessionAlreadyCompletedError,
} from "../errors/index.js";
import { auth } from "../lib/auth.js";
import {
  AddSessionExerciseBodySchema,
  AddSessionExerciseParamsSchema,
  CompleteWorkoutSessionResponseSchema,
  CreateWorkoutSetBodySchema,
  CreateWorkoutSetParamsSchema,
  DeleteSessionExerciseParamsSchema,
  DeleteWorkoutSetParamsSchema,
  DeleteWorkoutSetResponseSchema,
  ErrorSchema,
  GetWorkoutSessionParamsSchema,
  GetWorkoutSessionResponseSchema,
  StartFreeWorkoutSessionResponseSchema,
  UpdateWorkoutSetBodySchema,
  UpdateWorkoutSetParamsSchema,
  WorkoutSessionExerciseResponseSchema,
  WorkoutSetResponseSchema,
} from "../schemas/index.js";
import { AddExerciseToWorkoutSession } from "../usecases/AddExerciseToWorkoutSession.js";
import { CompleteWorkoutSession } from "../usecases/CompleteWorkoutSession.js";
import { CreateWorkoutSet } from "../usecases/CreateWorkoutSet.js";
import { DeleteWorkoutSet } from "../usecases/DeleteWorkoutSet.js";
import { GetActiveWorkoutSession } from "../usecases/GetActiveWorkoutSession.js";
import { GetWorkoutSession } from "../usecases/GetWorkoutSession.js";
import { RemoveExerciseFromWorkoutSession } from "../usecases/RemoveExerciseFromWorkoutSession.js";
import { StartFreeWorkoutSession } from "../usecases/StartFreeWorkoutSession.js";
import { UpdateWorkoutSet } from "../usecases/UpdateWorkoutSet.js";

export const workoutSessionRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /workout-sessions/active
  app.route({
    method: "GET",
    url: "/workout-sessions/active",
    schema: {
      operationId: "getActiveWorkoutSession",
      tags: ["Workout Session"],
      summary: "Get current active workout session with all exercises and sets",
      response: {
        200: GetWorkoutSessionResponseSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const getActiveWorkoutSession = new GetActiveWorkoutSession();
        const result = await getActiveWorkoutSession.execute({
          userId: session.user.id,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // GET /workout-sessions/:sessionId
  app.route({
    method: "GET",
    url: "/workout-sessions/:sessionId",
    schema: {
      operationId: "getWorkoutSession",
      tags: ["Workout Session"],
      summary: "Get a workout session with all exercises and sets",
      params: GetWorkoutSessionParamsSchema,
      response: {
        200: GetWorkoutSessionResponseSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const getWorkoutSession = new GetWorkoutSession();
        const result = await getWorkoutSession.execute({
          userId: session.user.id,
          sessionId: request.params.sessionId,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // POST /workout-sessions/:sessionId/complete
  app.route({
    method: "POST",
    url: "/workout-sessions/:sessionId/complete",
    schema: {
      operationId: "completeWorkoutSession",
      tags: ["Workout Session"],
      summary: "Complete an active workout session",
      params: GetWorkoutSessionParamsSchema,
      response: {
        200: CompleteWorkoutSessionResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const completeWorkoutSession = new CompleteWorkoutSession();
        const result = await completeWorkoutSession.execute({
          userId: session.user.id,
          sessionId: request.params.sessionId,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof PendingWorkoutSetsError) {
          return reply.status(400).send({
            error: error.message,
            code: "PENDING_WORKOUT_SETS",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // POST /session-exercises/:sessionExerciseId/sets
  app.route({
    method: "POST",
    url: "/session-exercises/:sessionExerciseId/sets",
    schema: {
      operationId: "createWorkoutSet",
      tags: ["Workout Session"],
      summary: "Create a new workout set for a session exercise",
      params: CreateWorkoutSetParamsSchema,
      body: CreateWorkoutSetBodySchema,
      response: {
        201: WorkoutSetResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const createWorkoutSet = new CreateWorkoutSet();
        const result = await createWorkoutSet.execute({
          userId: session.user.id,
          sessionExerciseId: request.params.sessionExerciseId,
          ...request.body,
        });

        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof WorkoutSessionAlreadyCompletedError) {
          return reply.status(409).send({
            error: error.message,
            code: "WORKOUT_SESSION_ALREADY_COMPLETED",
          });
        }

        if (error instanceof ValidationError) {
          return reply.status(400).send({
            error: error.message,
            code: "VALIDATION_ERROR",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // PATCH /workout-sets/:setId
  app.route({
    method: "PATCH",
    url: "/workout-sets/:setId",
    schema: {
      operationId: "updateWorkoutSet",
      tags: ["Workout Session"],
      summary: "Update an existing workout set",
      params: UpdateWorkoutSetParamsSchema,
      body: UpdateWorkoutSetBodySchema,
      response: {
        200: WorkoutSetResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const updateWorkoutSet = new UpdateWorkoutSet();
        const result = await updateWorkoutSet.execute({
          userId: session.user.id,
          setId: request.params.setId,
          ...request.body,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof WorkoutSessionAlreadyCompletedError) {
          return reply.status(409).send({
            error: error.message,
            code: "WORKOUT_SESSION_ALREADY_COMPLETED",
          });
        }

        if (error instanceof ValidationError) {
          return reply.status(400).send({
            error: error.message,
            code: "VALIDATION_ERROR",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // DELETE /workout-sets/:setId
  app.route({
    method: "DELETE",
    url: "/workout-sets/:setId",
    schema: {
      operationId: "deleteWorkoutSet",
      tags: ["Workout Session"],
      summary: "Delete a workout set",
      params: DeleteWorkoutSetParamsSchema,
      response: {
        200: DeleteWorkoutSetResponseSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const deleteWorkoutSet = new DeleteWorkoutSet();
        const result = await deleteWorkoutSet.execute({
          userId: session.user.id,
          setId: request.params.setId,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof WorkoutSessionAlreadyCompletedError) {
          return reply.status(409).send({
            error: error.message,
            code: "WORKOUT_SESSION_ALREADY_COMPLETED",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // POST /workout-sessions/free
  app.route({
    method: "POST",
    url: "/workout-sessions/free",
    schema: {
      operationId: "startFreeWorkoutSession",
      tags: ["Workout Session"],
      summary: "Start a free workout session without a workout plan or day",
      response: {
        201: StartFreeWorkoutSessionResponseSchema,
        401: ErrorSchema,
        409: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const startFreeWorkoutSession = new StartFreeWorkoutSession();
        const result = await startFreeWorkoutSession.execute({
          userId: session.user.id,
        });

        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof ConflictError) {
          return reply.status(409).send({
            error: error.message,
            code: "CONFLICT",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // POST /workout-sessions/:sessionId/exercises
  app.route({
    method: "POST",
    url: "/workout-sessions/:sessionId/exercises",
    schema: {
      operationId: "addExerciseToWorkoutSession",
      tags: ["Workout Session"],
      summary: "Add an exercise to an active free workout session",
      params: AddSessionExerciseParamsSchema,
      body: AddSessionExerciseBodySchema,
      response: {
        201: WorkoutSessionExerciseResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const addExercise = new AddExerciseToWorkoutSession();
        const result = await addExercise.execute({
          userId: session.user.id,
          sessionId: request.params.sessionId,
          exerciseId: request.body.exerciseId,
        });

        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof WorkoutSessionAlreadyCompletedError) {
          return reply.status(409).send({
            error: error.message,
            code: "WORKOUT_SESSION_ALREADY_COMPLETED",
          });
        }

        if (error instanceof ValidationError) {
          return reply.status(400).send({
            error: error.message,
            code: "VALIDATION_ERROR",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // DELETE /session-exercises/:sessionExerciseId
  app.route({
    method: "DELETE",
    url: "/session-exercises/:sessionExerciseId",
    schema: {
      operationId: "removeExerciseFromWorkoutSession",
      tags: ["Workout Session"],
      summary: "Remove an exercise from an active free workout session",
      params: DeleteSessionExerciseParamsSchema,
      response: {
        200: DeleteWorkoutSetResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const removeExercise = new RemoveExerciseFromWorkoutSession();
        const result = await removeExercise.execute({
          userId: session.user.id,
          sessionExerciseId: request.params.sessionExerciseId,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof WorkoutSessionAlreadyCompletedError) {
          return reply.status(409).send({
            error: error.message,
            code: "WORKOUT_SESSION_ALREADY_COMPLETED",
          });
        }

        if (error instanceof ValidationError) {
          return reply.status(400).send({
            error: error.message,
            code: "VALIDATION_ERROR",
          });
        }

        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });
};
