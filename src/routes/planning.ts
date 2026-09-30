import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";

import { ConflictError, NotFoundError } from "../errors/index.js";
import { auth } from "../lib/auth.js";
import {
  ErrorSchema,
  PlanningOverviewResponseSchema,
} from "../schemas/index.js";
import { GetPlanningOverview } from "../usecases/GetPlanningOverview.js";

export const planningRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/overview",
    schema: {
      operationId: "getPlanningOverview",
      tags: ["Planning"],
      summary: "Get planning overview for authenticated user",
      response: {
        200: PlanningOverviewResponseSchema,
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

        const usecase = new GetPlanningOverview();
        const result = await usecase.execute({
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
        if (error instanceof ConflictError) {
          return reply.status(409).send({
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
};
