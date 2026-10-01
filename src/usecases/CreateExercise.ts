import { validateAndSanitizeMuscles } from "../domain/muscle-taxonomy.js";
import { ConflictError, ValidationError } from "../errors/index.js";
import { MuscleGroup, MuscleRole, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  name: string;
  primaryMuscleGroups?: MuscleGroup[];
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

export class CreateExercise {
  async execute(dto: InputDto): Promise<OutputDto> {
    const trimmedName = dto.name.trim();

    if (!trimmedName) {
      throw new ValidationError("Exercise name cannot be empty");
    }

    const { primary, secondary } = validateAndSanitizeMuscles(
      dto.primaryMuscleGroups,
      dto.secondaryMuscleGroups,
    );

    try {
      const existing = await prisma.exercise.findFirst({
        where: {
          ownerUserId: dto.userId,
          name: { equals: trimmedName, mode: "insensitive" },
        },
      });

      if (existing) {
        throw new ConflictError("An exercise with this name already exists");
      }

      const exercise = await prisma.exercise.create({
        data: {
          id: crypto.randomUUID(),
          name: trimmedName,
          ownerUserId: dto.userId,
          muscles: {
            create: [
              ...primary.map((mg) => ({
                id: crypto.randomUUID(),
                muscleGroup: mg,
                role: MuscleRole.PRIMARY,
              })),
              ...secondary.map((mg) => ({
                id: crypto.randomUUID(),
                muscleGroup: mg,
                role: MuscleRole.SECONDARY,
              })),
            ],
          },
        },
        include: {
          muscles: {
            select: {
              id: true,
              muscleGroup: true,
              role: true,
            },
            orderBy: [{ role: "asc" }, { muscleGroup: "asc" }],
          },
        },
      });

      return {
        id: exercise.id,
        name: exercise.name,
        ownerUserId: dto.userId,
        muscles: exercise.muscles,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError("An exercise with this name already exists");
      }
      throw error;
    }
  }
}
