import { UIMessage } from "ai";

import { NotFoundError } from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  conversationId: string;
  messages: UIMessage[];
}

export class SaveAiMessages {
  async execute(dto: InputDto): Promise<void> {
    const conversation = await prisma.aiConversation.findFirst({
      where: {
        id: dto.conversationId,
        userId: dto.userId,
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversa não encontrada.");
    }

    for (const msg of dto.messages) {
      if (!msg.id) continue;

      const payload = msg as unknown as Prisma.InputJsonValue;
      const rawCreatedAt = (msg as { createdAt?: Date | string }).createdAt;
      const createdAt = rawCreatedAt ? new Date(rawCreatedAt) : new Date();

      await prisma.aiMessage.upsert({
        where: {
          conversationId_sdkMessageId: {
            conversationId: dto.conversationId,
            sdkMessageId: msg.id,
          },
        },
        create: {
          conversationId: dto.conversationId,
          sdkMessageId: msg.id,
          payload,
          createdAt,
        },
        update: {
          payload,
        },
      });
    }

    await prisma.aiConversation.update({
      where: {
        id: dto.conversationId,
      },
      data: {
        updatedAt: new Date(),
      },
    });
  }
}
