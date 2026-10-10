import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import z from "zod";

import { AdminError, requireAdmin } from "../lib/require-admin.js";
import * as s from "../schemas/admin.js";
import { ErrorSchema } from "../schemas/index.js";
import { AdminQueries } from "../usecases/AdminQueries.js";
import { ManageAdminPlan } from "../usecases/ManageAdminPlan.js";
import { ActivateManualSubscription, CancelManualSubscription, ChangeManualSubscriptionPlan, ExtendManualTrial, GrantManualTrial } from "../usecases/ManualSubscriptions.js";

const errors = { 400: ErrorSchema, 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 500: ErrorSchema };
const response = <T extends z.ZodType>(schema: T) => ({ 200: schema, ...errors });
export const adminRoutes: FastifyPluginAsyncZod = async app => {
  const actors = new WeakMap<FastifyRequest, string>();
  const actor = (request: FastifyRequest) => actors.get(request)!;
  app.addHook("preValidation", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    actors.set(request, await requireAdmin(request));
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AdminError) return reply.status(error.status).send({ error: error.code, code: error.code });
    if (error instanceof z.ZodError || (typeof error === "object" && error !== null && "validation" in error)) return reply.status(400).send({ error: "Invalid input", code: "VALIDATION_ERROR" });
    request.log.error({ message: "Administrative operation failed" });
    return reply.status(500).send({ error: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
  });
  const queries = new AdminQueries();
  app.get("/overview", { schema: { operationId: "getAdminOverview", tags: ["Admin"], response: response(s.AdminOverview) } },
    request => queries.overview(actor(request)));
  app.get("/users", { schema: { operationId: "listAdminUsers", tags: ["Admin"], querystring: s.AdminUsersQuery, response: response(s.AdminUsersPage) } },
    request => queries.users(actor(request), request.query));
  app.get("/users/:userId", { schema: { operationId: "getAdminUser", tags: ["Admin"], params: s.AdminUserParams, response: response(s.AdminUserDetail) } },
    request => queries.user(actor(request), request.params.userId));
  app.get("/plans", { schema: { operationId: "listAdminPlans", tags: ["Admin"], response: response(z.array(s.AdminPlan)) } },
    request => queries.plans(actor(request)));
  app.get("/plans/:planId", { schema: { operationId: "getAdminPlan", tags: ["Admin"], params: s.AdminPlanParams, response: response(s.AdminPlan) } },
    request => queries.plan(actor(request), request.params.planId));
  app.patch("/plans/:planId", { schema: { operationId: "updateAdminPlan", tags: ["Admin"], params: s.AdminPlanParams, body: s.AdminPlanPatch, response: response(s.AdminPlan) } },
    request => new ManageAdminPlan().update(actor(request), request.params.planId, request.body));
  app.put("/plans/:planId/entitlements", { schema: { operationId: "updateAdminPlanEntitlements", tags: ["Admin"], params: s.AdminPlanParams, body: s.AdminEntitlementsBody, response: response(s.AdminPlan) } },
    request => new ManageAdminPlan().entitlements(actor(request), request.params.planId, request.body));
  app.get("/subscriptions", { schema: { operationId: "listAdminSubscriptions", tags: ["Admin"], querystring: s.AdminSubscriptionsQuery, response: response(s.AdminSubscriptionsPage) } },
    request => queries.subscriptions(actor(request), request.query));
  app.get("/audit", { schema: { operationId: "listAdminAudit", tags: ["Admin"], querystring: s.AdminAuditQuery, response: response(s.AdminAuditPage) } },
    request => queries.audit(actor(request), request.query));
  app.post("/users/:userId/subscription/trial", { schema: { operationId: "grantManualTrial", tags: ["Admin"], params: s.AdminUserParams, body: s.AdminTrialBody, response: response(s.AdminSubscription) } },
    request => new GrantManualTrial().execute({ adminUserId: actor(request), userId: request.params.userId, ...request.body }));
  app.post("/users/:userId/subscription/extend-trial", { schema: { operationId: "extendManualTrial", tags: ["Admin"], params: s.AdminUserParams, body: s.AdminExtendBody, response: response(s.AdminSubscription) } },
    request => new ExtendManualTrial().execute({ adminUserId: actor(request), userId: request.params.userId, ...request.body }));
  app.post("/users/:userId/subscription/activate", { schema: { operationId: "activateManualSubscription", tags: ["Admin"], params: s.AdminUserParams, body: s.AdminAssignmentBody, response: response(s.AdminSubscription) } },
    request => new ActivateManualSubscription().execute({ adminUserId: actor(request), userId: request.params.userId, ...request.body }));
  app.post("/users/:userId/subscription/change-plan", { schema: { operationId: "changeManualSubscriptionPlan", tags: ["Admin"], params: s.AdminUserParams, body: s.AdminAssignmentBody, response: response(s.AdminSubscription) } },
    request => new ChangeManualSubscriptionPlan().execute({ adminUserId: actor(request), userId: request.params.userId, ...request.body }));
  app.post("/users/:userId/subscription/cancel", { schema: { operationId: "cancelManualSubscription", tags: ["Admin"], params: s.AdminUserParams, body: s.AdminCancelBody, response: response(s.AdminSubscription) } },
    request => new CancelManualSubscription().execute({ adminUserId: actor(request), userId: request.params.userId }));
};
