# 07 — Roadmap e Guardrails

# Roadmap

## Fase 0 — Correções estruturais [CONCLUÍDA]

- [x] Task 0.1: infraestrutura de testes (Vitest + Neon isolado via TEST_DATABASE_URL e guarda de segurança);
- [x] Task 0.2: corrigir ownership de plano ativo por `userId` em `CreateWorkoutPlan`;
- [x] Task 0.3: permitir sessões recorrentes (`WorkoutSession`) com concorrência de 1 sessão ativa por usuário;
- [x] Task 0.4: alinhar invariantes de descanso no `WorkoutDaySchema` e unificar cálculo de streak;
- [x] Task 0.5: parametrizar cookie/domain (`AUTH_COOKIE_DOMAIN`), remover Render e sincronizar CORS/trustedOrigins;
- [x] Task 0.6: auditoria completa, validação de invariantes e encerramento da Fase 0.

**Saída alcançada:** Dois usuários utilizam o sistema com isolamento completo e sem qualquer interferência mútua. Base homologada e pronta para a Fase 1.

## Fase 1 — Tracker Real [CONCLUÍDA] ✅

- catálogo `Exercise`;
- `SessionExercise`;
- `WorkoutSet`;
- carga/reps/RIR;
- isometria;
- notas;
- UI rápida para série;
- Treino avulso (`FreeWorkoutSession`).

**Saída alcançada:** Registro completo da sessão de treino em tempo real com integridade transacional e snapshot imutável.

## Fase 2 — Planning & Periodization [CONCLUÍDA] ✅

- [x] Task 2.1A, 2.1B, 2.1C: Modelagem, persistência e hardening de integridade da `Periodization` e `PeriodizationPlan`;
- [x] Task 2.2: Ciclo de vida e duplicação atômica de `WorkoutPlan` (ativação/desativação/duplicação);
- [x] Task 2.3A, 2.3B: Composição e ciclo de vida da `Periodization` (ativação, pausa, retomada, avanço e conclusão);
- [x] Task 2.4, 2.4B: Planning Overview API (`/planning/overview`) com agregação de `activeContext`, planos e periodizações;
- [x] Task 2.5A, 2.5B1, 2.5B2: Hub de Planejamento frontend (`/planning`), editores de plano e periodização, navegação completa;
- [x] Task 2.6: IA de Planejamento V1 (Coach AI) integrada ao domínio:
  - lê planejamento e contexto atual (`getPlanningOverview`, `getWorkoutPlan`, `getPeriodization`);
  - propõe planos de 7 dias e periodizações sem persistir no banco (`proposeWorkoutPlan`, `proposePeriodization`);
  - salva exclusivamente como rascunho inativo (`activate: false`, `isActive: false`);
  - persistência atômica de periodização com rollback garantido (`CreatePeriodizationDraftFromAI`);
  - não ativa, não desativa, não avança e não conclui planos ou periodizações;
  - não utiliza histórico de performance;
  - não possui RAG/PDF;
- [x] Task 2.7: Approval Hardening determinístico (`needsApproval: true`), idempotência contra replay, auditoria geral e readiness.

**Saída alcançada:** Hub completo de planejamento onde o usuário gerencia planos standalone, ciclos macro de periodização e interage com o Coach AI de forma estritamente consentida.

## Fase 3 — Histórico & Evolução [READY]

Fronteiras e escopo previsto:
- sessões executadas e histórico temporal;
- histórico por exercício e evolução de carga;
- carga / reps / RIR / volume por grupo muscular;
- recordes pessoais (PRs);
- evolução temporal de rendimento;
- comparação planejado vs executado (planned vs performed).

## Fase 4 — Identity & Commercial [EM ANDAMENTO]

- [x] Task 4.1 — Identity & Commercial Foundation.
- [ ] Task 4.2 — Admin Console (próxima; não iniciada).

Identidade, planos, assinaturas, entitlements, intent OAuth, backfill e bootstrap operacional:
[09 — Commercial Foundation](09-COMMERCIAL-FOUNDATION.md).
Fase 4 não está marcada como pronta. Não há gating global, cobrança ou vínculo CoachAthlete.

## Backlog futuro — Biblioteca (antiga proposta de Fase 4)

- upload PDF;
- storage;
- extração;
- chunks;
- embeddings;
- pgvector;
- seleção de fontes.

## Fase 5 — IA 2.0

- reduzir metodologia hardcoded;
- retrieval;
- histórico estruturado;
- geração tipada;
- preview/edit;
- referências de fonte.

## Fase 6 — Beta

- feature flags;
- observabilidade;
- onboarding;
- privacidade/termos;
- usuários reais.

## Fase 7 — Coach

- vínculo CoachAthlete;
- dashboard;
- templates;
- atribuição;
- feedback.

## Fase 8 — Billing

- Free;
- AI Individual;
- Coach;
- Coach + AI;
- entitlements;
- créditos;
- cobrança/webhooks;
- INTERNAL.

# Engineering Guardrails

## Não reescrever por preferência

Não migrar Fastify para Server Actions, Prisma para outro ORM ou juntar repos sem necessidade comprovada.

## Camadas

Route: HTTP/auth/schema.

Use Case: regra de negócio.

Prisma: persistência.

## Multiusuário

Toda feature deve responder:

```text
quem é dono?
quem pode ler?
quem pode alterar?
```

## IA

Proibido:

```text
LLM -> SQL direto
LLM -> Prisma arbitrário
LLM -> persistência sem schema
```

Obrigatório:

```text
LLM -> tool/schema -> validação -> use case -> persistência
```

## RAG

Retrieval também exige autorização antes de retornar chunks.

## API

Toda rota nova precisa de:

- schema Zod;
- operationId;
- tag;
- responses;
- auth;
- erros consistentes.

Regenerar Orval após alterar OpenAPI.

## Migrações

Não apagar histórico para simplificar schema. Preferir adição -> migração -> adaptação -> remoção posterior.

## Testes

Todo bug de segurança ganha teste de regressão.

Prioridade:

```text
ownership > billing > IA persistence > tracker
```

## UX de treino

- poucos toques;
- inputs grandes;
- RIR rápido;
- última carga visível;
- salvar sem perder contexto;
- erro não pode apagar input.

## Definition of Done

Quando aplicável:

- domínio definido;
- autorização revisada;
- migration criada;
- Zod atualizado;
- OpenAPI válido;
- Orval regenerado;
- UI pronta;
- erros tratados;
- teste criado;
- docs atualizadas.
