# 05 — IA e RAG

## Objetivo

```text
perfil
+ fontes selecionadas
+ histórico
+ agenda
+ feedback
= geração estruturada
```

A IA deve organizar/adaptar treino; não ser apenas um gerador genérico.

## Estado ATUAL

- Gemini 2.5 Flash;
- Vercel AI SDK;
- `streamText`;
- tools;
- chat React.

Tools existentes:

```text
getUserTrainData
updateUserTrainData
getWorkoutPlans
createWorkoutPlan
```

## Mudança principal

O `SYSTEM_PROMPT` deve conter papel, formato, limites, uso de tools e segurança. Metodologia específica deve vir das fontes quando selecionadas.

## Pipeline de PDF — ALVO

```text
upload
↓
storage
↓
extração de texto
↓
normalização
↓
chunking
↓
embeddings
↓
vector store
↓
READY
```

Começar com PostgreSQL + pgvector se o provedor escolhido suportar de forma simples.

## Retrieval — ALVO

Tool conceitual:

```ts
searchTrainingSources({
  query,
  documentIds,
  limit,
});
```

A tool deve aplicar ownership e permissão antes da busca.

## Contexto de histórico — ALVO

Tools futuras:

```text
getExerciseHistory
getRecentWorkoutSessions
getRecoveryContext
getAthleteSchedule
```

Enviar resumo estruturado, não histórico bruto infinito.

## Saída estruturada

Nunca:

```text
LLM -> markdown -> gravação direta
```

Sempre:

```text
LLM
↓
schema estruturado
↓
Zod
↓
validação de negócio
↓
preview/edição
↓
use case
↓
banco
```

## Modos de geração

### SOURCE_ONLY

Usa apenas fontes selecionadas + regras do produto.

### SOURCE_ADAPTIVE

Prioriza fontes, adaptando com histórico, calendário e feedback.

### GENERAL

Sem fonte selecionada; conhecimento geral permitido pelo produto.

## Referências

Preservar, quando possível:

```text
documentId
chunkId
page
section
```

A UI pode exibir a origem da prescrição.

## Saúde e segurança

A IA pode organizar protocolo, resumir fonte e adaptar treino de forma conservadora. Não deve alegar diagnóstico definitivo nem substituir profissional de saúde.

## Uso e custo

Criar metering:

```text
userId
feature
model
inputTokens
outputTokens
creditsCharged
createdAt
```

## Biblioteca do treinador

```text
Coach Library
↓
RAG
↓
planejamento para atletas vinculados
```

Permissões do retrieval devem respeitar vínculo ativo e ownership.

## Coach Training Context Tools — Task 3.4.1

O Coach AI consulta o histórico real do atleta pelas mesmas regras de domínio usadas nas rotas HTTP:

```text
AI SDK Tool -> Use Case <- HTTP Route

futuro:
MCP Tool -> mesmo Use Case
```

Não existe servidor, transporte ou endpoint MCP nesta fase.

Tools de leitura disponíveis:

- `getRecentTrainingHistory` -> `ListWorkoutHistory` (padrão 5, máximo 10 sessões);
- `getWorkoutHistorySession` -> `GetWorkoutHistorySession`;
- `searchExercises` -> `ListExercises` (padrão 8, máximo 15 resultados);
- `getExerciseEvolution` -> `GetExerciseEvolution` (padrão 6, máximo 12 sessões);
- `getWeeklyTrainingAnalytics` -> `GetWeeklyTrainingAnalytics` (padrão 4, máximo 12 semanas);
- `getMuscleTrainingAnalytics` -> `GetMuscleTrainingAnalytics`.

Todas recebem o `userId` exclusivamente da sessão autenticada e são read-only. IDs de usuário, atleta ou owner nunca fazem parte do schema exposto ao modelo. O catálogo retorna apenas exercícios globais e customizados do próprio usuário. A descoberta por nome usa correspondência determinística normalizada (exato/prefixo/contains); a identidade histórica permanece baseada em `Exercise.id`, sem fuzzy matching.

O navegador envia o timezone IANA obtido por `Intl.DateTimeFormat().resolvedOptions().timeZone` no body de `POST /ai`, junto com o `conversationId` quando houver. O backend valida esse valor e o injeta no contexto interno das tools; o modelo não escolhe timezone. Clientes antigos continuam funcionando, mas tools temporais retornam `TIMEZONE_REQUIRED` quando ele está ausente. Timezones inválidos são rejeitados com `INVALID_TIMEZONE`.

O Coach pode encadear múltiplas tools na mesma resposta. Retornos omitem cursores e metadados redundantes, com limites conservadores para proteger o contexto. O prompt exige consulta aos dados antes de respostas factuais, distingue fatos de interpretação, declara histórico insuficiente e pede esclarecimento quando uma busca de exercício é ambígua.
