# 00 — Contexto do Projeto

## Produto

**Trainvy** (anteriormente FIT.AI) é uma plataforma mobile-first para criação, execução e acompanhamento de treinos.

Visão:

```text
metodologia escolhida pelo usuário
+ histórico real
+ contexto atual
+ inteligência artificial
= planejamento e sessões estruturadas
```

A proposta não é ser apenas um gerador genérico. Usuário e treinador devem poder usar as próprias fontes, metodologias e documentos.

## Estado ATUAL — Frontend

Repo: `Chiqueto/bootcamp-treinos-frontend`

Confirmado no código:

- Next.js 16.1.6 + App Router
- React 19.2.3
- TypeScript
- Tailwind CSS 4 + shadcn/ui
- Better Auth client
- Vercel AI SDK no chat
- Orval gerando client HTTP pelo OpenAPI
- dayjs

Fluxos atuais:

- login Google;
- onboarding via chat;
- home;
- consistência;
- plano semanal;
- dia de treino;
- cards de exercícios;
- iniciar/concluir sessão;
- estatísticas;
- perfil;
- chat Coach AI.

Comunicação Frontend ↔ Backend:

- **APIs comuns de domínio:** client gerado pelo Orval (`app/_lib/api/fetch-generated/index.ts`);
- **`/ai`:** Vercel AI SDK através de `DefaultChatTransport` no chat (`app/_components/chat.tsx`);
- **`/api/auth/*`:** Better Auth Client (`app/_lib/auth-client.ts`);
- O mutator do Orval continua centralizado em `app/_lib/fetch.ts`, responsável por injetar cookies de autenticação do Next.js Server Components.

## Estado ATUAL — Backend

Repo: `Chiqueto/bootcamp-treinos-api`

Confirmado no código:

- Node.js 24.x
- Fastify 5.7.x
- TypeScript
- Prisma 7.4
- PostgreSQL
- Better Auth + Google OAuth
- Zod 4
- Swagger/OpenAPI + Scalar
- Vercel AI SDK 6
- Gemini 2.5 Flash no fluxo atual

Arquitetura:

```text
Route -> Use Case -> Prisma -> PostgreSQL
```

Rotas principais:

```text
/api/auth/*
/ai
/home
/me
/stats
/workout-plans
```

## Domínio ATUAL

```text
User
 └─ WorkoutPlan
     └─ WorkoutDay
         ├─ WorkoutExercise
         └─ WorkoutSession
```

`WorkoutExercise` atualmente armazena apenas prescrição simples:

```text
name
order
sets
reps
restTimeInSeconds
```

`WorkoutSession` armazena apenas início/fim. Ainda não existe registro real por série.

## IA ATUAL

A rota `/ai` já utiliza tools reais:

```text
getUserTrainData
updateUserTrainData
getWorkoutPlans
createWorkoutPlan
```

Fluxo existente e desejado:

```text
LLM -> Tool tipada -> Use Case -> Prisma
```

A metodologia hoje está hardcoded no `SYSTEM_PROMPT`. Na visão ALVO, o conhecimento metodológico específico deve vir das fontes selecionadas, templates e configurações do treinador.

## Bugs e pendências da Fase 0 (RESOLVIDOS)

### BUG-001 — plano ativo sem escopo por usuário [RESOLVIDO na Task 0.2]

`CreateWorkoutPlan` desativa atomicamente apenas os planos do próprio `userId` (`tx.workoutPlan.updateMany({ where: { userId, isActive: true } })`). Planos de outros usuários permanecem intactos.

### BUG-002 — sessão não recorrente [RESOLVIDO na Task 0.3]

`StartWorkoutSession` permite que o mesmo `WorkoutDay` seja executado repetidas vezes ao longo do tempo. Sessões concluídas ficam registradas no histórico. Apenas sessões em andamento (`completedAt === null`) são limitadas a no máximo 1 simultânea por usuário.

### BUG-003 — dia de descanso inconsistente e streak divergente [RESOLVIDO na Task 0.4]

`WorkoutDaySchema` agora valida invariantes estritas via Zod (`isRest: true` exige duração 0 e exercícios vazios; `isRest: false` exige duração > 0 e exercícios não vazios). A regra de streak foi unificada na função pura `calculateWorkoutStreak`, compartilhada entre `GetHomeData` e `GetStats`.

### TECH-001 — cookie de produção e Render [RESOLVIDO na Task 0.5]

Removido qualquer domínio `.onrender.com` hardcoded. Adicionada parametrização via `AUTH_COOKIE_DOMAIN`. Sem essa variável, cookies são estritamente host-only (`crossSubDomainCookies` desabilitado). Fastify CORS e Better Auth `trustedOrigins` unificados.

### TECH-002 — infraestrutura de testes automatizados [RESOLVIDO na Task 0.1]

Implementada suíte de testes com Vitest, executando contra banco isolado via `TEST_DATABASE_URL` com guarda estrita impedindo execução contra `DATABASE_URL` principal. Suíte com 41 testes cobrindo ownership, sessões, schemas, streak e auth.

## Funcionalidades ainda NÃO implementadas

- PWA;
- registro por série;
- RIR por série;
- catálogo completo de exercícios;
- PDFs/RAG/embeddings;
- biblioteca de fontes;
- Coach ↔ Atleta;
- assinaturas/créditos;
- billing;
- dashboard de treinador.
