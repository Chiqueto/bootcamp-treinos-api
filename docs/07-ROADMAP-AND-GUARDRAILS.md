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

## Fase 1 — Tracker real

- catálogo `Exercise`;
- `SessionExercise`;
- `WorkoutSet`;
- carga/reps/RIR;
- isometria;
- notas;
- UI rápida para série.

**Saída:** treino completo sem planilha externa.

## Fase 2 — Histórico/evolução

- histórico por exercício;
- últimas cargas;
- volume;
- PRs;
- RIR;
- recovery feedback.

## Fase 3 — PWA

- manifest;
- ícones;
- instalação;
- revisão mobile.

## Fase 4 — Biblioteca

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
