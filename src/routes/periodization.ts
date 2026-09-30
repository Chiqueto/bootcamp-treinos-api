import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../errors/index.js";
import { auth } from "../lib/auth.js";
import {
  AddWorkoutPlanToPeriodizationBodySchema,
  CreatePeriodizationBodySchema,
  CreateWorkoutPlanInPeriodizationBodySchema,
  CreateWorkoutPlanInPeriodizationResponseSchema,
  ErrorSchema,
  GetPeriodizationResponseSchema,
  ListPeriodizationsResponseSchema,
  PeriodizationLifecycleResponseSchema,
  PeriodizationParamsSchema,
  PeriodizationPlanDetailResponseSchema,
  PeriodizationPlanParamsSchema,
  PeriodizationResponseSchema,
  ReorderPeriodizationPlansBodySchema,
  SuccessResponseSchema,
  UpdatePeriodizationBodySchema,
  UpdatePeriodizationPlanBodySchema,
} from "../schemas/index.js";
import { ActivatePeriodization } from "../usecases/ActivatePeriodization.js";
import { AddWorkoutPlanToPeriodization } from "../usecases/AddWorkoutPlanToPeriodization.js";
import { AdvancePeriodizationPlan } from "../usecases/AdvancePeriodizationPlan.js";
import { CompletePeriodization } from "../usecases/CompletePeriodization.js";
import { CreatePeriodization } from "../usecases/CreatePeriodization.js";
import { CreateWorkoutPlanInPeriodization } from "../usecases/CreateWorkoutPlanInPeriodization.js";
import { DeactivatePeriodization } from "../usecases/DeactivatePeriodization.js";
import { DeletePeriodization } from "../usecases/DeletePeriodization.js";
import { GetPeriodization } from "../usecases/GetPeriodization.js";
import { ListPeriodizations } from "../usecases/ListPeriodizations.js";
import { RemoveWorkoutPlanFromPeriodization } from "../usecases/RemoveWorkoutPlanFromPeriodization.js";
import { ReorderPeriodizationPlans } from "../usecases/ReorderPeriodizationPlans.js";
import { UpdatePeriodization } from "../usecases/UpdatePeriodization.js";
import { UpdatePeriodizationPlan } from "../usecases/UpdatePeriodizationPlan.js";

export const periodizationRoutes = async (app: FastifyInstance) => {
  // 1. CreatePeriodization: POST /periodizations
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      operationId: "createPeriodization",
      tags: ["Periodization"],
      summary: "Create a new periodization draft",
      body: CreatePeriodizationBodySchema,
      response: {
        201: PeriodizationResponseSchema,
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

        const usecase = new CreatePeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          name: request.body.name,
          goal: request.body.goal,
          notes: request.body.notes,
        });

        return reply.status(201).send(result);
      } catch (error) {
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

  // 2. ListPeriodizations: GET /periodizations
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/",
    schema: {
      operationId: "listPeriodizations",
      tags: ["Periodization"],
      summary: "List periodizations for authenticated user",
      response: {
        200: ListPeriodizationsResponseSchema,
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

        const usecase = new ListPeriodizations();
        const result = await usecase.execute({
          userId: session.user.id,
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

  // 3. GetPeriodization: GET /periodizations/:id
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/:id",
    schema: {
      operationId: "getPeriodization",
      tags: ["Periodization"],
      summary: "Get a periodization with all plans ordered",
      params: PeriodizationParamsSchema,
      response: {
        200: GetPeriodizationResponseSchema,
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

        const usecase = new GetPeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
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

  // 4. UpdatePeriodization: PATCH /periodizations/:id
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "PATCH",
    url: "/:id",
    schema: {
      operationId: "updatePeriodization",
      tags: ["Periodization"],
      summary: "Update periodization metadata",
      params: PeriodizationParamsSchema,
      body: UpdatePeriodizationBodySchema,
      response: {
        200: PeriodizationResponseSchema,
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

        const usecase = new UpdatePeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
          name: request.body.name,
          goal: request.body.goal,
          notes: request.body.notes,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
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

  // 5. DeletePeriodization: DELETE /periodizations/:id
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "DELETE",
    url: "/:id",
    schema: {
      operationId: "deletePeriodization",
      tags: ["Periodization"],
      summary: "Delete an unstarted periodization draft",
      params: PeriodizationParamsSchema,
      response: {
        200: SuccessResponseSchema,
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

        const usecase = new DeletePeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
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

  // 6. AddWorkoutPlanToPeriodization: POST /periodizations/:id/plans
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:id/plans",
    schema: {
      operationId: "addWorkoutPlanToPeriodization",
      tags: ["Periodization"],
      summary: "Add an existing workout plan to periodization",
      params: PeriodizationParamsSchema,
      body: AddWorkoutPlanToPeriodizationBodySchema,
      response: {
        201: PeriodizationPlanDetailResponseSchema,
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

        const usecase = new AddWorkoutPlanToPeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
          workoutPlanId: request.body.workoutPlanId,
          plannedStartDate: request.body.plannedStartDate,
          plannedEndDate: request.body.plannedEndDate,
          notes: request.body.notes,
        });

        return reply.status(201).send(result);
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

  // 7. CreateWorkoutPlanInPeriodization: POST /periodizations/:id/plans/create
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:id/plans/create",
    schema: {
      operationId: "createWorkoutPlanInPeriodization",
      tags: ["Periodization"],
      summary: "Create a workout plan directly inside a periodization",
      params: PeriodizationParamsSchema,
      body: CreateWorkoutPlanInPeriodizationBodySchema,
      response: {
        201: CreateWorkoutPlanInPeriodizationResponseSchema,
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

        const usecase = new CreateWorkoutPlanInPeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
          name: request.body.name,
          workoutDays: request.body.workoutDays,
          plannedStartDate: request.body.plannedStartDate,
          plannedEndDate: request.body.plannedEndDate,
          notes: request.body.notes,
        });

        return reply.status(201).send(result);
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

  // 8. UpdatePeriodizationPlan: PATCH /periodizations/:periodizationId/plans/:periodizationPlanId
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "PATCH",
    url: "/:periodizationId/plans/:periodizationPlanId",
    schema: {
      operationId: "updatePeriodizationPlan",
      tags: ["Periodization"],
      summary: "Update planned dates or notes of a periodization plan",
      params: PeriodizationPlanParamsSchema,
      body: UpdatePeriodizationPlanBodySchema,
      response: {
        200: PeriodizationPlanDetailResponseSchema,
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

        const usecase = new UpdatePeriodizationPlan();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.periodizationId,
          periodizationPlanId: request.params.periodizationPlanId,
          plannedStartDate: request.body.plannedStartDate,
          plannedEndDate: request.body.plannedEndDate,
          notes: request.body.notes,
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

  // 9. RemoveWorkoutPlanFromPeriodization: DELETE /periodizations/:periodizationId/plans/:periodizationPlanId
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "DELETE",
    url: "/:periodizationId/plans/:periodizationPlanId",
    schema: {
      operationId: "removeWorkoutPlanFromPeriodization",
      tags: ["Periodization"],
      summary: "Remove a planned block from periodization",
      params: PeriodizationPlanParamsSchema,
      response: {
        200: SuccessResponseSchema,
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

        const usecase = new RemoveWorkoutPlanFromPeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.periodizationId,
          periodizationPlanId: request.params.periodizationPlanId,
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

  // 10. ReorderPeriodizationPlans: PUT /periodizations/:id/plans/order
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "PUT",
    url: "/:id/plans/order",
    schema: {
      operationId: "reorderPeriodizationPlans",
      tags: ["Periodization"],
      summary: "Reorder planned blocks of a periodization",
      params: PeriodizationParamsSchema,
      body: ReorderPeriodizationPlansBodySchema,
      response: {
        200: z.array(PeriodizationPlanDetailResponseSchema),
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

        const usecase = new ReorderPeriodizationPlans();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
          periodizationPlanIds: request.body.periodizationPlanIds,
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

  // 11. ActivatePeriodization: POST /periodizations/:id/activate
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:id/activate",
    schema: {
      operationId: "activatePeriodization",
      tags: ["Periodization"],
      summary: "Activate or resume a periodization and its current block",
      params: PeriodizationParamsSchema,
      response: {
        200: PeriodizationLifecycleResponseSchema,
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

        const usecase = new ActivatePeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
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

  // 12. DeactivatePeriodization: POST /periodizations/:id/deactivate
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:id/deactivate",
    schema: {
      operationId: "deactivatePeriodization",
      tags: ["Periodization"],
      summary: "Pause an active periodization",
      params: PeriodizationParamsSchema,
      response: {
        200: PeriodizationLifecycleResponseSchema,
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

        const usecase = new DeactivatePeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
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

  // 13. AdvancePeriodizationPlan: POST /periodizations/:id/advance
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:id/advance",
    schema: {
      operationId: "advancePeriodization",
      tags: ["Periodization"],
      summary: "Complete current block and advance to the next block or conclude periodization",
      params: PeriodizationParamsSchema,
      response: {
        200: PeriodizationLifecycleResponseSchema,
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

        const usecase = new AdvancePeriodizationPlan();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
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

  // 14. CompletePeriodization: POST /periodizations/:id/complete
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:id/complete",
    schema: {
      operationId: "completePeriodization",
      tags: ["Periodization"],
      summary: "Conclude periodization manually, completing open block and preserving future blocks",
      params: PeriodizationParamsSchema,
      response: {
        200: PeriodizationLifecycleResponseSchema,
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

        const usecase = new CompletePeriodization();
        const result = await usecase.execute({
          userId: session.user.id,
          periodizationId: request.params.id,
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
