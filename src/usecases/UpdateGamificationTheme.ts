import { prisma } from "../lib/db.js";
import { GamificationTheme } from "../schemas/index.js";

interface InputDto {
  userId: string;
  theme: GamificationTheme;
}

interface OutputDto {
  userId: string;
  gamificationTheme: GamificationTheme;
}

export class UpdateGamificationTheme {
  async execute(dto: InputDto): Promise<OutputDto> {
    const user = await prisma.user.update({
      where: { id: dto.userId },
      data: {
        gamificationTheme: dto.theme,
      },
    });

    return {
      userId: user.id,
      gamificationTheme: (user.gamificationTheme as GamificationTheme) || GamificationTheme.ALL,
    };
  }
}

