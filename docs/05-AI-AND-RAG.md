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
  limit
})
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
