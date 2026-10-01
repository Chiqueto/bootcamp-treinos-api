import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  conversationId: string;
}

export class DeleteAiConversation {
  async execute(dto: InputDto): Promise<{ success: boolean; message: string }> {
    const conversation = await prisma.aiConversation.findFirst({
      where: {
        id: dto.conversationId,
        userId: dto.userId,
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversa não encontrada.");
    }

    // Cascade deletes AiMessage records.
    // NEVER removes WorkoutPlan, Periodization, or WorkoutSession.
    await prisma.aiConversation.delete({
      where: {
        id: dto.conversationId,
      },
    });

    return {
      success: true,
      message: "Conversa excluída com sucesso.",
    };
  }
}
