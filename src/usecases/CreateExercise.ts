import { ConflictError, ValidationError } from "../errors/index.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  name: string;
}

interface OutputDto {
  id: string;
  name: string;
  ownerUserId: string;
}

export class CreateExercise {
  async execute(dto: InputDto): Promise<OutputDto> {
    const trimmedName = dto.name.trim();

    if (!trimmedName) {
      throw new ValidationError("Exercise name cannot be empty");
    }

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
        },
      });

      return {
        id: exercise.id,
        name: exercise.name,
        ownerUserId: dto.userId,
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
