import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  conversationId: string;
}

export interface AiConversationDetailDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: unknown[];
}

export class GetAiConversation {
  async execute(dto: InputDto): Promise<AiConversationDetailDto> {
    const conversation = await prisma.aiConversation.findFirst({
      where: {
        id: dto.conversationId,
        userId: dto.userId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversa não encontrada.");
    }

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((m) => m.payload),
    };
  }
}
