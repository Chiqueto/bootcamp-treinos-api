-- CreateIndex: Unicidade case-insensitive para exercícios globais
CREATE UNIQUE INDEX "Exercise_global_unique_name"
ON "Exercise" (LOWER(TRIM("name")))
WHERE "ownerUserId" IS NULL;

-- CreateIndex: Unicidade case-insensitive para exercícios por usuário
CREATE UNIQUE INDEX "Exercise_user_unique_name"
ON "Exercise" ("ownerUserId", LOWER(TRIM("name")))
WHERE "ownerUserId" IS NOT NULL;
