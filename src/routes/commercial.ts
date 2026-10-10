import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import z from "zod";

import { CommercialError } from "../domain/commercial.js";
import { auth } from "../lib/auth.js";
import {
  CommercialContextSchema,
  CompleteSignupBodySchema,
  CompleteSignupResponseSchema,
  PublicPlanSchema,
  PublicPlansQuerySchema,
  SignupIntentBodySchema,
  SignupIntentResponseSchema,
} from "../schemas/commercial.js";
import { ErrorSchema } from "../schemas/index.js";
import { CompleteSignup } from "../usecases/CompleteSignup.js";
import { CreateSignupIntent } from "../usecases/CreateSignupIntent.js";
import { GetCommercialContext } from "../usecases/GetCommercialContext.js";
import { ListPublicPlans } from "../usecases/ListPublicPlans.js";

function fail(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof CommercialError)
    return reply
      .status(error.status)
      .send({ error: error.message, code: error.code });
  // Do not log signup tokens or request bodies.
  request.log.error({ message: "Commercial operation failed" });
  return reply
    .status(500)
    .send({ error: "Internal server error", code: "INTERNAL_SERVER_ERROR" });
}
const errors = {
  400: ErrorSchema,
  401: ErrorSchema,
  404: ErrorSchema,
  409: ErrorSchema,
  500: ErrorSchema,
};

export const commercialRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/commercial/plans",
    {
      schema: {
        operationId: "listPublicPlans",
        tags: ["Commercial"],
        querystring: PublicPlansQuerySchema,
        response: { 200: z.array(PublicPlanSchema), ...errors },
      },
    },
    async (request, reply) => {
      try {
        return await new ListPublicPlans().execute(request.query);
      } catch (error) {
        return fail(error, request, reply);
      }
    },
  );
  app.post(
    "/commercial/signup-intents",
    {
      schema: {
        operationId: "createSignupIntent",
        tags: ["Commercial"],
        body: SignupIntentBodySchema,
        response: { 201: SignupIntentResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return reply
          .status(201)
          .send(await new CreateSignupIntent().execute(request.body));
      } catch (error) {
        return fail(error, request, reply);
      }
    },
  );
  app.post(
    "/account/complete-signup",
    {
      schema: {
        operationId: "completeSignup",
        tags: ["Account"],
        body: CompleteSignupBodySchema,
        response: { 200: CompleteSignupResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session)
          return reply
            .status(401)
            .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return await new CompleteSignup().execute({
          userId: session.user.id,
          token: request.body.token,
        });
      } catch (error) {
        return fail(error, request, reply);
      }
    },
  );
  app.get(
    "/account/commercial-context",
    {
      schema: {
        operationId: "getCommercialContext",
        tags: ["Account"],
        response: { 200: CommercialContextSchema, ...errors },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session)
          return reply
            .status(401)
            .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
        return await new GetCommercialContext().execute({
          userId: session.user.id,
        });
      } catch (error) {
        return fail(error, request, reply);
      }
    },
  );
};
