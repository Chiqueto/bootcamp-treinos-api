import { fromNodeHeaders } from "better-auth/node";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import z from "zod";

import { ConflictError, NotFoundError, ValidationError } from "../errors/index.js";
import { auth } from "../lib/auth.js";
import {
  CreateExerciseBodySchema,
  ErrorSchema,
  ExerciseResponseSchema,
  ListExercisesQuerySchema,
  UpdateExerciseMusclesBodySchema,
  UpdateExerciseMusclesParamsSchema,
} from "../schemas/index.js";
import { CreateExercise } from "../usecases/CreateExercise.js";
import { ListExercises } from "../usecases/ListExercises.js";
import { UpdateExerciseMuscles } from "../usecases/UpdateExerciseMuscles.js";

export const exerciseRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /exercises
  app.route({
    method: "GET",
    url: "/",
    schema: {
      operationId: "listExercises",
      tags: ["Exercise"],
      summary: "List global exercises and user custom exercises with optional search query",
      querystring: ListExercisesQuerySchema,
      response: {
        200: z.array(ExerciseResponseSchema),
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

        const listExercises = new ListExercises();
        const result = await listExercises.execute({
          userId: session.user.id,
          query: request.query.q,
          onlyWithHistory: request.query.onlyWithHistory === "true",
        });

        return reply.status(200).send(result);
      } catch (error) {
        app.log.error(error);
        return reply.status(500).send({
          error: "Internal server error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  // POST /exercises
  app.route({
    method: "POST",
    url: "/",
    schema: {
      operationId: "createExercise",
      tags: ["Exercise"],
      summary: "Create a custom exercise for the authenticated user",
      body: CreateExerciseBodySchema,
      response: {
        201: ExerciseResponseSchema,
        400: ErrorSchema,
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

        const createExercise = new CreateExercise();
        const result = await createExercise.execute({
          userId: session.user.id,
          name: request.body.name,
          primaryMuscleGroups: request.body.primaryMuscleGroups,
          secondaryMuscleGroups: request.body.secondaryMuscleGroups,
        });

        return reply.status(201).send(result);
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.status(400).send({
            error: error.message,
            code: "VALIDATION_ERROR",
          });
        }

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

  // PUT /exercises/:id/muscles
  app.route({
    method: "PUT",
    url: "/:id/muscles",
    schema: {
      operationId: "updateExerciseMuscles",
      tags: ["Exercise"],
      summary: "Update muscle groups classification of a custom exercise",
      params: UpdateExerciseMusclesParamsSchema,
      body: UpdateExerciseMusclesBodySchema,
      response: {
        200: ExerciseResponseSchema,
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

        const updateExerciseMuscles = new UpdateExerciseMuscles();
        const result = await updateExerciseMuscles.execute({
          userId: session.user.id,
          exerciseId: request.params.id,
          primaryMuscleGroups: request.body.primaryMuscleGroups,
          secondaryMuscleGroups: request.body.secondaryMuscleGroups,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.status(400).send({
            error: error.message,
            code: "VALIDATION_ERROR",
          });
        }

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
};
