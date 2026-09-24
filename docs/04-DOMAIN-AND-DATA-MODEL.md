# 04 — Domínio e Modelo de Dados

## Estratégia

Evoluir o domínio existente sem reescrita geral.

## Separação essencial

### Prescrição

```text
WorkoutPlan
WorkoutDay
WorkoutExercise
```

### Execução

```text
WorkoutSession
SessionExercise
WorkoutSet
```

## Exercise — ALVO

```text
Exercise
- id
- ownerUserId nullable
- name
- description nullable
- equipment nullable
- category nullable
- muscleGroup nullable
- isUnilateral
- createdAt
- updatedAt
```

`ownerUserId = null` pode representar catálogo global.

## WorkoutExercise — ALVO

Evoluir para suportar:

```text
exerciseId
order
sets
repsMin/repsMax
targetRir
targetRpe
targetLoad
restTimeInSeconds
tempo
durationInSeconds
notes
```

Durante migração, `name` pode continuar temporariamente.

## WorkoutSession — ALVO

Execução real em uma data:

```text
id
workoutDayId
athleteId
startedAt
completedAt
notes
perceivedEffort
painDuring
```

Não limitar a uma sessão por `WorkoutDay`.

## SessionExercise — ALVO

Snapshot do exercício durante a sessão:

```text
id
workoutSessionId
sourceWorkoutExerciseId nullable
exerciseId nullable
exerciseNameSnapshot
order
notes
```

Objetivo: edição futura do plano não altera histórico antigo.

## WorkoutSet — ALVO

```text
id
sessionExerciseId
order
weightInGrams nullable
reps nullable
rir nullable
rpe nullable
durationInSeconds nullable
distanceInCentimeters nullable
completed
notes nullable
```

## RecoveryCheck — ALVO

```text
id
workoutSessionId
type: POST_WORKOUT | NEXT_DAY
pain
fatigue
soreness
sleepQuality
feeling
notes
createdAt
```

## RAG — ALVO

```text
SourceDocument
- id
- ownerUserId
- title
- originalFileName
- storageKey
- mimeType
- status

SourceChunk
- id
- sourceDocumentId
- content
- page
- section
- embedding
- metadata

SourceReference
- id
- sourceChunkId
- entityType
- entityId
```

## Coach — ALVO

```text
CoachAthlete
- id
- coachId
- athleteId
- status
- createdAt
- acceptedAt
- revokedAt
```

## Comercial — FUTURO

```text
Subscription
Plan
Entitlement
AIUsage
AIUsageLedger
```

## Regras de histórico

1. editar plano não reescreve sessão antiga;
2. excluir template não apaga execução;
3. carga/reps/RIR executados permanecem auditáveis;
4. plano gerado por IA usa o mesmo fluxo de execução do plano manual.

## Índices importantes

```text
WorkoutPlan(userId, isActive)
WorkoutSession(athleteId, startedAt)
WorkoutSet(sessionExerciseId, order)
CoachAthlete(coachId, athleteId, status)
SourceDocument(ownerUserId, status)
SourceChunk(sourceDocumentId)
```
