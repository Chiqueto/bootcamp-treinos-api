import { prisma } from "../lib/db.js";

export function generateCleanTitle(text?: string | null): string {
  if (!text || !text.trim()) {
    return "Nova conversa";
  }
  let title = text.trim();
  const prefixes = [
    /^quero montar\s+(uma?\s+)?/i,
    /^quero criar\s+(uma?\s+)?/i,
    /^crie\s+(uma?\s+)?/i,
    /^monte\s+(uma?\s+)?/i,
    /^ajude-me a\s+/i,
    /^me ajude a\s+/i,
    /^gostaria de\s+/i,
  ];
  for (const prefix of prefixes) {
    if (prefix.test(title)) {
      title = title.replace(prefix, "");
      break;
    }
  }
  title = title.trim();
  if (title.length === 0) {
    title = text.trim();
  }
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > 45) {
    const cut = title.slice(0, 45);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim() + "...";
  }
  return title;
}

interface InputDto {
  userId: string;
  title?: string | null;
  initialMessageText?: string | null;
}

export class CreateAiConversation {
  async execute(dto: InputDto) {
    const title =
      dto.title && dto.title.trim().length > 0
        ? dto.title.trim()
        : generateCleanTitle(dto.initialMessageText);

    const conversation = await prisma.aiConversation.create({
      data: {
        userId: dto.userId,
        title,
      },
    });

    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }
}
