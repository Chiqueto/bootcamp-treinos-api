-- ==============================================================================
-- Trainvy — Migration 3.1D: Catálogo Canônico Global & Backfill de Legado
-- ==============================================================================

-- 1. Inserção Idempotente dos 33 Exercícios Canônicos Globais (ownerUserId IS NULL)
-- com UUIDs determinísticos e estáveis entre ambientes.
INSERT INTO "Exercise" ("id", "name", "ownerUserId", "createdAt", "updatedAt")
VALUES
  ('00000000-0000-4000-8000-000000000101', 'Supino Reto com Barra', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000102', 'Supino Reto', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000103', 'Supino Inclinado com Halteres', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000104', 'Supino Inclinado', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000105', 'Agachamento Livre', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000106', 'Agachamento', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000107', 'Agachamento Búlgaro', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000108', 'Leg Press 45', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000109', 'Leg Press Horizontal', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000110', 'Cadeira Extensora', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000111', 'Cadeira Flexora', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000112', 'Mesa Flexora', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000113', 'Stiff', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000114', 'Elevação Pélvica', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000115', 'Cadeira Abdutora', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000116', 'Cadeira Adutora', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000117', 'Panturrilha em Pé', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000118', 'Panturrilha Sentado', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000119', 'Puxada Frontal na Máquina', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000120', 'Puxada Frontal', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000121', 'Remada Curvada com Barra', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000122', 'Remada Curvada', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000123', 'Desenvolvimento Militar', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000124', 'Desenvolvimento com Halteres', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000125', 'Elevação Lateral', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000126', 'Crucifixo Inverso na Máquina', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000127', 'Rosca Direta com Barra', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000128', 'Rosca Direta', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000129', 'Rosca Martelo', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000130', 'Rosca Scott', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000131', 'Tríceps Corda', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000132', 'Tríceps Testa', NULL, NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000133', 'Tríceps Francês Unilateral', NULL, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- 2. Inserção Idempotente dos Músculos (PRIMARY e SECONDARY) dos Globais
-- UUIDs RFC 4122 v4 determinísticos (ex: 00000000-0000-4000-8001-...)
INSERT INTO "ExerciseMuscle" ("id", "exerciseId", "muscleGroup", "role", "createdAt")
VALUES
  ('00000000-0000-4000-8001-000000000101', '00000000-0000-4000-8000-000000000101', 'CHEST'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8002-000000000101', '00000000-0000-4000-8000-000000000101', 'TRICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8003-000000000101', '00000000-0000-4000-8000-000000000101', 'SHOULDERS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8004-000000000102', '00000000-0000-4000-8000-000000000102', 'CHEST'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8005-000000000102', '00000000-0000-4000-8000-000000000102', 'TRICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8006-000000000102', '00000000-0000-4000-8000-000000000102', 'SHOULDERS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8007-000000000103', '00000000-0000-4000-8000-000000000103', 'CHEST'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8008-000000000103', '00000000-0000-4000-8000-000000000103', 'TRICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8009-000000000103', '00000000-0000-4000-8000-000000000103', 'SHOULDERS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8010-000000000104', '00000000-0000-4000-8000-000000000104', 'CHEST'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8011-000000000104', '00000000-0000-4000-8000-000000000104', 'TRICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8012-000000000104', '00000000-0000-4000-8000-000000000104', 'SHOULDERS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8013-000000000105', '00000000-0000-4000-8000-000000000105', 'QUADRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8014-000000000105', '00000000-0000-4000-8000-000000000105', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8015-000000000105', '00000000-0000-4000-8000-000000000105', 'HAMSTRINGS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8016-000000000106', '00000000-0000-4000-8000-000000000106', 'QUADRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8017-000000000106', '00000000-0000-4000-8000-000000000106', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8018-000000000106', '00000000-0000-4000-8000-000000000106', 'HAMSTRINGS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8019-000000000107', '00000000-0000-4000-8000-000000000107', 'QUADRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8020-000000000107', '00000000-0000-4000-8000-000000000107', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8021-000000000107', '00000000-0000-4000-8000-000000000107', 'HAMSTRINGS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8022-000000000108', '00000000-0000-4000-8000-000000000108', 'QUADRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8023-000000000108', '00000000-0000-4000-8000-000000000108', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8024-000000000108', '00000000-0000-4000-8000-000000000108', 'HAMSTRINGS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8025-000000000108', '00000000-0000-4000-8000-000000000108', 'CALVES'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8026-000000000109', '00000000-0000-4000-8000-000000000109', 'QUADRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8027-000000000109', '00000000-0000-4000-8000-000000000109', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8028-000000000109', '00000000-0000-4000-8000-000000000109', 'HAMSTRINGS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8029-000000000109', '00000000-0000-4000-8000-000000000109', 'CALVES'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8030-000000000110', '00000000-0000-4000-8000-000000000110', 'QUADRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8031-000000000111', '00000000-0000-4000-8000-000000000111', 'HAMSTRINGS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8032-000000000112', '00000000-0000-4000-8000-000000000112', 'HAMSTRINGS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8033-000000000113', '00000000-0000-4000-8000-000000000113', 'HAMSTRINGS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8034-000000000113', '00000000-0000-4000-8000-000000000113', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8035-000000000113', '00000000-0000-4000-8000-000000000113', 'BACK'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8036-000000000113', '00000000-0000-4000-8000-000000000113', 'CORE'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8037-000000000114', '00000000-0000-4000-8000-000000000114', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8038-000000000114', '00000000-0000-4000-8000-000000000114', 'HAMSTRINGS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8039-000000000115', '00000000-0000-4000-8000-000000000115', 'HIP_ABDUCTORS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8040-000000000115', '00000000-0000-4000-8000-000000000115', 'GLUTES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8041-000000000116', '00000000-0000-4000-8000-000000000116', 'ADDUCTORS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8042-000000000117', '00000000-0000-4000-8000-000000000117', 'CALVES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8043-000000000118', '00000000-0000-4000-8000-000000000118', 'CALVES'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8044-000000000119', '00000000-0000-4000-8000-000000000119', 'BACK'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8045-000000000119', '00000000-0000-4000-8000-000000000119', 'BICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8046-000000000120', '00000000-0000-4000-8000-000000000120', 'BACK'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8047-000000000120', '00000000-0000-4000-8000-000000000120', 'BICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8048-000000000121', '00000000-0000-4000-8000-000000000121', 'BACK'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8049-000000000121', '00000000-0000-4000-8000-000000000121', 'BICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8050-000000000121', '00000000-0000-4000-8000-000000000121', 'CORE'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8051-000000000122', '00000000-0000-4000-8000-000000000122', 'BACK'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8052-000000000122', '00000000-0000-4000-8000-000000000122', 'BICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8053-000000000122', '00000000-0000-4000-8000-000000000122', 'CORE'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8054-000000000123', '00000000-0000-4000-8000-000000000123', 'SHOULDERS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8055-000000000123', '00000000-0000-4000-8000-000000000123', 'TRICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8056-000000000123', '00000000-0000-4000-8000-000000000123', 'CORE'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8057-000000000124', '00000000-0000-4000-8000-000000000124', 'SHOULDERS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8058-000000000124', '00000000-0000-4000-8000-000000000124', 'TRICEPS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8059-000000000125', '00000000-0000-4000-8000-000000000125', 'SHOULDERS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8060-000000000126', '00000000-0000-4000-8000-000000000126', 'SHOULDERS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8061-000000000126', '00000000-0000-4000-8000-000000000126', 'BACK'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8062-000000000127', '00000000-0000-4000-8000-000000000127', 'BICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8063-000000000127', '00000000-0000-4000-8000-000000000127', 'FOREARMS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8064-000000000128', '00000000-0000-4000-8000-000000000128', 'BICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8065-000000000128', '00000000-0000-4000-8000-000000000128', 'FOREARMS'::"MuscleGroup", 'SECONDARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8066-000000000129', '00000000-0000-4000-8000-000000000129', 'BICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8067-000000000129', '00000000-0000-4000-8000-000000000129', 'FOREARMS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8068-000000000130', '00000000-0000-4000-8000-000000000130', 'BICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8069-000000000131', '00000000-0000-4000-8000-000000000131', 'TRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8070-000000000132', '00000000-0000-4000-8000-000000000132', 'TRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW()),
  ('00000000-0000-4000-8071-000000000133', '00000000-0000-4000-8000-000000000133', 'TRICEPS'::"MuscleGroup", 'PRIMARY'::"MuscleRole", NOW())
ON CONFLICT ("exerciseId", "muscleGroup") DO NOTHING;

-- 3. Classificação Segura de Exercícios Customizados Legados
-- Copia PRIMARY e SECONDARY do catálogo para custom que possua muscles.length === 0
-- Somente em caso de correspondência EXATA normalizada (LOWER(TRIM(c.name)) = LOWER(TRIM(g.name))).
-- Não sobrescreve custom que já possua classificação manual (muscles.length > 0).
INSERT INTO "ExerciseMuscle" ("id", "exerciseId", "muscleGroup", "role", "createdAt")
SELECT
  gen_random_uuid(),
  c."id",
  gm."muscleGroup",
  gm."role",
  NOW()
FROM "Exercise" c
JOIN "Exercise" g ON g."ownerUserId" IS NULL AND LOWER(TRIM(g."name")) = LOWER(TRIM(c."name"))
JOIN "ExerciseMuscle" gm ON gm."exerciseId" = g."id"
WHERE c."ownerUserId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ExerciseMuscle" em WHERE em."exerciseId" = c."id"
  )
ON CONFLICT ("exerciseId", "muscleGroup") DO NOTHING;

-- 4. Backfill de WorkoutExercise.exerciseId Legado
-- Prioridade 1: Exercício do próprio usuário com match exato normalizado
UPDATE "WorkoutExercise" we
SET "exerciseId" = matched."id"
FROM (
  SELECT DISTINCT ON (we_inner."id")
    we_inner."id" AS we_id,
    e."id"
  FROM "WorkoutExercise" we_inner
  JOIN "WorkoutDay" wd ON wd."id" = we_inner."workoutDayId"
  JOIN "WorkoutPlan" wp ON wp."id" = wd."workoutPlanId"
  JOIN "Exercise" e ON e."ownerUserId" = wp."userId"
                   AND LOWER(TRIM(e."name")) = LOWER(TRIM(we_inner."name"))
  WHERE we_inner."exerciseId" IS NULL
  ORDER BY we_inner."id", e."createdAt" ASC
) matched
WHERE we."id" = matched.we_id;

-- Prioridade 2: Exercício global com match exato normalizado (apenas para os que continuam NULL)
UPDATE "WorkoutExercise" we
SET "exerciseId" = matched."id"
FROM (
  SELECT DISTINCT ON (we_inner."id")
    we_inner."id" AS we_id,
    e."id"
  FROM "WorkoutExercise" we_inner
  JOIN "Exercise" e ON e."ownerUserId" IS NULL
                   AND LOWER(TRIM(e."name")) = LOWER(TRIM(we_inner."name"))
  WHERE we_inner."exerciseId" IS NULL
  ORDER BY we_inner."id", e."createdAt" ASC
) matched
WHERE we."id" = matched.we_id;

-- 5. Backfill de SessionExercise.exerciseId Legado
-- Estratégia 1: Herdar do sourceWorkoutExercise correspondente se já possuir exerciseId
UPDATE "SessionExercise" se
SET "exerciseId" = we."exerciseId"
FROM "WorkoutExercise" we
WHERE se."sourceWorkoutExerciseId" = we."id"
  AND se."exerciseId" IS NULL
  AND we."exerciseId" IS NOT NULL;

-- Estratégia 2 (Fallback): Match exato normalizado com custom do atleta
UPDATE "SessionExercise" se
SET "exerciseId" = matched."id"
FROM (
  SELECT DISTINCT ON (se_inner."id")
    se_inner."id" AS se_id,
    e."id"
  FROM "SessionExercise" se_inner
  JOIN "WorkoutSession" ws ON ws."id" = se_inner."workoutSessionId"
  JOIN "Exercise" e ON e."ownerUserId" = ws."athleteId"
                   AND LOWER(TRIM(e."name")) = LOWER(TRIM(se_inner."exerciseNameSnapshot"))
  WHERE se_inner."exerciseId" IS NULL
  ORDER BY se_inner."id", e."createdAt" ASC
) matched
WHERE se."id" = matched.se_id;

-- Estratégia 3 (Fallback): Match exato normalizado com global canônico
UPDATE "SessionExercise" se
SET "exerciseId" = matched."id"
FROM (
  SELECT DISTINCT ON (se_inner."id")
    se_inner."id" AS se_id,
    e."id"
  FROM "SessionExercise" se_inner
  JOIN "Exercise" e ON e."ownerUserId" IS NULL
                   AND LOWER(TRIM(e."name")) = LOWER(TRIM(se_inner."exerciseNameSnapshot"))
  WHERE se_inner."exerciseId" IS NULL
  ORDER BY se_inner."id", e."createdAt" ASC
) matched
WHERE se."id" = matched.se_id;
