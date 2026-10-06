import { google } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, UIMessage } from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import { getSystemPrompt } from "../ai/system-prompt.js";
import { getAiTools } from "../ai/tools.js";
import { InvalidTimezoneError, NotFoundError } from "../errors/index.js";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/db.js";
import {
  AiConversationParamsSchema,
  CreateAiConversationBodySchema,
  CreateAiConversationResponseSchema,
  ErrorSchema,
  GetAiConversationResponseSchema,
  ListAiConversationsResponseSchema,
  SuccessResponseSchema,
} from "../schemas/index.js";
import { CreateAiConversation } from "../usecases/CreateAiConversation.js";
import { DeleteAiConversation } from "../usecases/DeleteAiConversation.js";
import { GetAiConversation } from "../usecases/GetAiConversation.js";
import { ListAiConversations } from "../usecases/ListAiConversations.js";
import { SaveAiMessages } from "../usecases/SaveAiMessages.js";

function getFirstUserMessageText(messages: UIMessage[]): string | null {
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (
            part.type === "text" &&
            typeof (part as { text?: string }).text === "string"
          ) {
            const text = (part as { text: string }).text.trim();
            if (text) return text;
          }
        }
      }
    }
  }
  return null;
}

export const aiRoutes = async (app: FastifyInstance) => {
  // 1. Chat with AI Coach: POST /ai
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["AI"],
      summary: "Chat with AI Coach (Trainvy)",
      querystring: z.object({
        conversationId: z.string().uuid().optional(),
      }),
      body: z.object({
        messages: z.array(z.any()),
        conversationId: z.string().uuid().optional(),
        timezone: z.string().max(255).optional(),
      }),
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const userId = session.user.id;
      const userName = session.user.name;
      const {
        messages,
        conversationId: bodyConversationId,
        timezone,
      } = request.body as {
        messages: UIMessage[];
        conversationId?: string;
        timezone?: string;
      };

      let tools;
      try {
        tools = getAiTools(userId, { timezone });
      } catch (error) {
        if (error instanceof InvalidTimezoneError) {
          return reply.status(400).send({
            error: error.message,
            code: "INVALID_TIMEZONE",
          });
        }
        throw error;
      }

      const queryConversationId = request.query.conversationId;
      const requestedConversationId = bodyConversationId || queryConversationId;

      let conversationId = requestedConversationId;

      if (conversationId) {
        const existing = await prisma.aiConversation.findFirst({
          where: {
            id: conversationId,
            userId,
          },
        });

        if (!existing) {
          return reply.status(404).send({
            error: "Conversa não encontrada.",
            code: "NOT_FOUND",
          });
        }
      } else {
        const initialText = getFirstUserMessageText(messages);
        const createConversation = new CreateAiConversation();
        const created = await createConversation.execute({
          userId,
          initialMessageText: initialText,
        });
        conversationId = created.id;
      }

      const result = streamText({
        model: google("gemini-2.5-flash"),
        system: getSystemPrompt(userName),
        messages: await convertToModelMessages(messages),
        stopWhen: stepCountIs(10),
        tools,
      });

      const response = result.toUIMessageStreamResponse({
        originalMessages: messages,
        onFinish: async ({ messages: finalMessages }) => {
          try {
            const saveAiMessages = new SaveAiMessages();
            await saveAiMessages.execute({
              userId,
              conversationId: conversationId!,
              messages: finalMessages,
            });
          } catch (err) {
            app.log.error(err, "Failed to persist AI messages on finish");
          }
        },
      });

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.header("x-conversation-id", conversationId);
      return reply.send(response.body);
    },
  });

  // 2. List Conversations: GET /ai/conversations
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/conversations",
    schema: {
      tags: ["AI"],
      summary: "List all AI conversations for current user",
      response: {
        200: ListAiConversationsResponseSchema,
        401: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const listConversations = new ListAiConversations();
      const conversations = await listConversations.execute({
        userId: session.user.id,
      });

      return reply.status(200).send({ conversations });
    },
  });

  // 3. Create Conversation: POST /ai/conversations
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/conversations",
    schema: {
      tags: ["AI"],
      summary: "Create a new AI conversation thread",
      body: CreateAiConversationBodySchema,
      response: {
        201: CreateAiConversationResponseSchema,
        401: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const createConversation = new CreateAiConversation();
      const created = await createConversation.execute({
        userId: session.user.id,
        title: request.body.title,
      });

      return reply.status(201).send(created);
    },
  });

  // 4. Get Conversation: GET /ai/conversations/:id
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/conversations/:id",
    schema: {
      tags: ["AI"],
      summary: "Get AI conversation by ID with messages",
      params: AiConversationParamsSchema,
      response: {
        200: GetAiConversationResponseSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      try {
        const getConversation = new GetAiConversation();
        const result = await getConversation.execute({
          userId: session.user.id,
          conversationId: request.params.id,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }
        throw error;
      }
    },
  });

  // 5. Delete Conversation: DELETE /ai/conversations/:id
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "DELETE",
    url: "/conversations/:id",
    schema: {
      tags: ["AI"],
      summary:
        "Delete AI conversation (never removes workout plans or periodizations)",
      params: AiConversationParamsSchema,
      response: {
        200: SuccessResponseSchema,
        401: ErrorSchema,
        404: ErrorSchema,
        500: ErrorSchema,
      },
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      try {
        const deleteConversation = new DeleteAiConversation();
        const result = await deleteConversation.execute({
          userId: session.user.id,
          conversationId: request.params.id,
        });

        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }
        throw error;
      }
    },
  });
};
