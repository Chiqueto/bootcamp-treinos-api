import { fromNodeHeaders } from "better-auth/node";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

import {
  InvalidCursorError,
  InvalidDateRangeError,
  InvalidTimezoneError,
  NotFoundError,
} from "../errors/index.js";
import { auth } from "../lib/auth.js";
import {
  ErrorSchema,
  GetExerciseEvolutionParamsSchema,
  GetExerciseEvolutionQuerySchema,
  GetExerciseEvolutionResponseSchema,
  GetMuscleAnalyticsQuerySchema,
  GetMuscleAnalyticsResponseSchema,
  GetWeeklyAnalyticsQuerySchema,
  GetWeeklyAnalyticsResponseSchema,
  GetWorkoutHistorySessionParamsSchema,
  GetWorkoutHistorySessionResponseSchema,
  ListWorkoutHistoryQuerySchema,
  ListWorkoutHistoryResponseSchema,
} from "../schemas/index.js";
import { GetExerciseEvolution } from "../usecases/GetExerciseEvolution.js";
import { GetMuscleTrainingAnalytics } from "../usecases/GetMuscleTrainingAnalytics.js";
import { GetWeeklyTrainingAnalytics } from "../usecases/GetWeeklyTrainingAnalytics.js";
import { GetWorkoutHistorySession } from "../usecases/GetWorkoutHistorySession.js";
import { ListWorkoutHistory } from "../usecases/ListWorkoutHistory.js";

export const historyRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /history/analytics/weekly
  app.route({
    method: "GET",
    url: "/analytics/weekly",
    schema: {
      operationId: "getWeeklyTrainingAnalytics",
      tags: ["History"],
      summary: "Get weekly volume and duration training analytics",
      querystring: GetWeeklyAnalyticsQuerySchema,
      response: {
        200: GetWeeklyAnalyticsResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
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

        const getWeeklyTrainingAnalytics = new GetWeeklyTrainingAnalytics();
        const result = await getWeeklyTrainingAnalytics.execute({
          userId: session.user.id,
          tz: request.query.tz,
          startDate: request.query.startDate,
          endDate: request.query.endDate,
          weeksCount: request.query.weeksCount,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof InvalidTimezoneError || error instanceof InvalidDateRangeError) {
          return reply.status(400).send({
            error: error.message,
            code: error.code,
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

  // GET /history/analytics/muscles
  app.route({
    method: "GET",
    url: "/analytics/muscles",
    schema: {
      operationId: "getMuscleTrainingAnalytics",
      tags: ["History"],
      summary: "Get muscle direct and indirect working sets analytics",
      querystring: GetMuscleAnalyticsQuerySchema,
      response: {
        200: GetMuscleAnalyticsResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
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

        const getMuscleTrainingAnalytics = new GetMuscleTrainingAnalytics();
        const result = await getMuscleTrainingAnalytics.execute({
          userId: session.user.id,
          tz: request.query.tz,
          startDate: request.query.startDate,
          endDate: request.query.endDate,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof InvalidTimezoneError || error instanceof InvalidDateRangeError) {
          return reply.status(400).send({
            error: error.message,
            code: error.code,
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

  // GET /history/sessions
  app.route({
    method: "GET",
    url: "/sessions",
    schema: {
      operationId: "listWorkoutHistory",
      tags: ["History"],
      summary: "List completed workout sessions history with cursor pagination",
      querystring: ListWorkoutHistoryQuerySchema,
      response: {
        200: ListWorkoutHistoryResponseSchema,
        400: ErrorSchema,
        401: ErrorSchema,
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

        const listWorkoutHistory = new ListWorkoutHistory();
        const result = await listWorkoutHistory.execute({
          userId: session.user.id,
          cursor: request.query.cursor,
          limit: request.query.limit,
          origin: request.query.origin,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          return reply.status(400).send({
            error: error.message,
            code: error.code,
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

  // GET /history/sessions/:sessionId
  app.route({
    method: "GET",
    url: "/sessions/:sessionId",
    schema: {
      operationId: "getWorkoutHistorySession",
      tags: ["History"],
      summary: "Get details of a completed workout session in history",
      params: GetWorkoutHistorySessionParamsSchema,
      response: {
        200: GetWorkoutHistorySessionResponseSchema,
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

        const getWorkoutHistorySession = new GetWorkoutHistorySession();
        const result = await getWorkoutHistorySession.execute({
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

  // GET /history/exercises/:exerciseId
  app.route({
    method: "GET",
    url: "/exercises/:exerciseId",
    schema: {
      operationId: "getExerciseEvolution",
      tags: ["History"],
      summary: "Get longitudinal evolution and load PR for a specific canonical exercise",
      params: GetExerciseEvolutionParamsSchema,
      querystring: GetExerciseEvolutionQuerySchema,
      response: {
        200: GetExerciseEvolutionResponseSchema,
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

        const getExerciseEvolution = new GetExerciseEvolution();
        const result = await getExerciseEvolution.execute({
          userId: session.user.id,
          exerciseId: request.params.exerciseId,
          cursor: request.query.cursor,
          limit: request.query.limit,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          return reply.status(400).send({
            error: error.message,
            code: "INVALID_CURSOR",
          });
        }

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: error.code || "NOT_FOUND",
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
