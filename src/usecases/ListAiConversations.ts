import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
}

export interface AiConversationSummaryDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messagesCount: number;
}

export class ListAiConversations {
  async execute(dto: InputDto): Promise<AiConversationSummaryDto[]> {
    const conversations = await prisma.aiConversation.findMany({
      where: {
        userId: dto.userId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messagesCount: c._count.messages,
    }));
  }
}
