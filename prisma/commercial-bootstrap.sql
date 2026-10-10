-- Insert-only bootstrap: an existing plan and its entitlements are never overwritten.
WITH inserted AS (
 INSERT INTO "Plan" ("id", "code", "name", "description", "audience", "monthlyPriceInCents", "currency", "isPublic", "isActive", "sortOrder", "updatedAt")
 VALUES
 ('commercial-athlete-free', 'ATHLETE_FREE', 'Atleta Grátis', 'Treinos individuais sem mensalidade.', 'ATHLETE', 0, 'BRL', true, true, 0, NOW()),
 ('commercial-coach', 'COACH', 'Coach', 'Planejamento e acompanhamento de até 5 atletas. Liberação manual nesta fase.', 'COACH', 3990, 'BRL', true, true, 10, NOW()),
 ('commercial-coach-ai', 'COACH_AI', 'Coach + AI', 'Até 15 atletas e recursos de IA. Liberação manual nesta fase.', 'COACH', 7990, 'BRL', true, true, 20, NOW()),
 ('commercial-internal', 'INTERNAL', 'Internal', 'Uso interno, atribuição exclusivamente confiável.', 'INTERNAL', 0, 'BRL', false, true, 100, NOW())
 ON CONFLICT ("code") DO NOTHING RETURNING "id", "code"
)
INSERT INTO "PlanEntitlement" ("id", "planId", "entitlement", "limitValue")
SELECT p."id" || '-' || e.key, p."id", e.key::"EntitlementKey",
 CASE WHEN e.key = 'MANAGE_ATHLETES' THEN CASE p."code" WHEN 'COACH' THEN 5 WHEN 'COACH_AI' THEN 15 ELSE NULL END ELSE NULL END
FROM inserted p CROSS JOIN (VALUES ('COACH_DASHBOARD'), ('MANAGE_ATHLETES'), ('ASSIGN_WORKOUTS'), ('VIEW_ATHLETE_HISTORY'), ('ADVANCED_STATS'), ('AI_CHAT'), ('AI_PLAN_GENERATION'), ('SOURCE_LIBRARY')) e(key)
WHERE p."code" IN ('COACH', 'COACH_AI', 'INTERNAL')
 AND (p."code" <> 'COACH' OR e.key NOT IN ('AI_CHAT', 'AI_PLAN_GENERATION', 'SOURCE_LIBRARY'))
ON CONFLICT ("planId", "entitlement") DO NOTHING;
