import { validateAndSanitizeMuscles } from "../domain/muscle-taxonomy.js";
import { NotFoundError, ValidationError } from "../errors/index.js";
import { MuscleGroup, MuscleRole } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  exerciseId: string;
  primaryMuscleGroups: MuscleGroup[];
  secondaryMuscleGroups?: MuscleGroup[];
}

interface OutputDto {
  id: string;
  name: string;
  ownerUserId: string;
  muscles: Array<{
    id: string;
    muscleGroup: MuscleGroup;
    role: MuscleRole;
  }>;
}

export class UpdateExerciseMuscles {
  async execute(dto: InputDto): Promise<OutputDto> {
    const exercise = await prisma.exercise.findUnique({
      where: { id: dto.exerciseId },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
      },
    });

    // Invariante de Ownership: Usuário nunca pode editar classificação de
    // global (ownerUserId === null) nem de exercício de outro usuário.
    // Retornar 404 (NotFoundError) para prevenir IDOR / enumeração.
    if (!exercise || exercise.ownerUserId !== dto.userId) {
      throw new NotFoundError("Exercise not found");
    }

    if (!dto.primaryMuscleGroups || dto.primaryMuscleGroups.length === 0) {
      throw new ValidationError(
        "Pelo menos um grupo muscular primário (PRIMARY) é obrigatório.",
      );
    }

    const { primary, secondary } = validateAndSanitizeMuscles(
      dto.primaryMuscleGroups,
      dto.secondaryMuscleGroups,
    );

    return prisma.$transaction(async (tx) => {
      // Substituição atômica: remover relações antigas
      await tx.exerciseMuscle.deleteMany({
        where: { exerciseId: exercise.id },
      });

      // Inserir novas relações
      const newMusclesData = [
        ...primary.map((mg) => ({
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          muscleGroup: mg,
          role: MuscleRole.PRIMARY,
        })),
        ...secondary.map((mg) => ({
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          muscleGroup: mg,
          role: MuscleRole.SECONDARY,
        })),
      ];

      if (newMusclesData.length > 0) {
        await tx.exerciseMuscle.createMany({
          data: newMusclesData,
        });
      }

      const updatedMuscles = await tx.exerciseMuscle.findMany({
        where: { exerciseId: exercise.id },
        select: {
          id: true,
          muscleGroup: true,
          role: true,
        },
        orderBy: [{ role: "asc" }, { muscleGroup: "asc" }],
      });

      return {
        id: exercise.id,
        name: exercise.name,
        ownerUserId: dto.userId,
        muscles: updatedMuscles,
      };
    });
  }
}
