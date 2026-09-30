import {
  NotFoundError,
  PeriodizationAlreadyStartedError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  periodizationId: string;
}

export class DeletePeriodization {
  async execute(dto: InputDto): Promise<{ success: boolean; message: string }> {
    const periodization = await prisma.periodization.findFirst({
      where: {
        id: dto.periodizationId,
        userId: dto.userId,
      },
    });

    if (!periodization) {
      throw new NotFoundError("Periodização não encontrada.");
    }

    if (
      periodization.startedAt !== null ||
      periodization.completedAt !== null
    ) {
      throw new PeriodizationAlreadyStartedError(
        "A periodização já foi iniciada e não pode ser excluída.",
      );
    }

    // Exclusão permitida apenas para rascunhos nunca iniciados.
    // PeriodizationPlan é excluído via Cascade de banco.
    // WorkoutPlans vinculados permanecem no banco como planos standalone.
    await prisma.periodization.delete({
      where: {
        id: dto.periodizationId,
      },
    });

    return {
      success: true,
      message: "Periodização excluída com sucesso.",
    };
  }
}
