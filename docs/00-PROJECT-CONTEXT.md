# 00 — Contexto do Projeto

## Produto

**FIT.AI** é uma plataforma mobile-first para criação, execução e acompanhamento de treinos.

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

## Bugs/riscos já identificados

### BUG-001 — plano ativo sem escopo por usuário

`CreateWorkoutPlan` procura `isActive: true` sem `userId`. Um usuário pode desativar o plano ativo de outro.

### BUG-002 — sessão não recorrente

`StartWorkoutSession` bloqueia novas sessões após existir qualquer sessão anterior do mesmo `WorkoutDay`. O domínio precisa permitir o mesmo treino em datas diferentes.

### BUG-003 — dia de descanso inconsistente

O prompt admite `estimatedDurationInSeconds = 0`, mas o schema HTTP usa `.min(1)`.

### TECH-001 — cookie de produção

Better Auth ainda contém domínio `.onrender.com` hardcoded para produção.

### TECH-002 — testes

Não foi encontrado conjunto de testes automatizados.

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
