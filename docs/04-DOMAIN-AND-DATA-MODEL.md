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

## Periodização — FASE 2

```text
Periodization
- id
- userId
- name
- goal nullable
- notes nullable
- isActive: boolean (padrão false)
- startedAt nullable
- completedAt nullable

PeriodizationPlan
- id
- periodizationId
- workoutPlanId (unique global)
- order (unique por periodização, order > 0)
- plannedStartDate nullable (Date)
- plannedEndDate nullable (Date, plannedEndDate >= plannedStartDate)
- activatedAt nullable (Timestamptz)
- completedAt nullable (Timestamptz, completedAt >= activatedAt)
- notes nullable
```

### Invariantes de Integridade da Periodização (Task 2.1C / Task 2.3)

1. **Ownership Cruzado**:
   - `Periodization.userId === WorkoutPlan.userId`.
   - Um plano pertencente ao usuário B **nunca** pode ser inserido na periodização do usuário A.
   - Esta validação é obrigatória no use case de adição de plano à periodização (Task 2.3).
2. **Ciclo de Vida de Bloco (`PeriodizationPlan`)**:
   - Conclusão exige ativação: `completedAt IS NULL OR activatedAt IS NOT NULL`.
   - Não é possível concluir um bloco sem que ele tenha sido ativado previamente.
3. **Ciclo de Vida de Periodização (`Periodization`)**:
   - Conclusão exige início: `completedAt IS NULL OR startedAt IS NOT NULL`.
   - Ativação exige startedAt: `isActive = FALSE OR startedAt IS NOT NULL`.
   - Concluída não pode permanecer ativa: `NOT (isActive = TRUE AND completedAt IS NOT NULL)`.
4. **Sincronismo de Ativação**:
   - Não pode haver estado dessincronizado onde `Periodization.isActive = true` e o plano ativo global do usuário seja outro plano externo.
   - Os use cases de ativação da Task 2.2 e 2.3 centralizam a transição atômica de contexto ativo.

### Ciclo de Vida e Duplicação de WorkoutPlan (Task 2.2)

1. **ActivateWorkoutPlan (`POST /workout-plans/:id/activate`)**:
   - Ativa plano standalone atomicamente (`isActive = true`).
   - Se houver `Periodization` ativa: pausa a periodização (`isActive = false`) e desativa o plano da periodização sem alterar timestamps históricos.
   - Bloqueia com `ACTIVE_WORKOUT_SESSION` se houver sessão de treino aberta (`completedAt IS NULL`).
   - Bloqueia com `PLAN_BELONGS_TO_PERIODIZATION` se o plano fizer parte de uma periodização (deve ser ativado via periodização).
   - Idempotente se o plano já estiver ativo.
2. **DeactivateWorkoutPlan (`POST /workout-plans/:id/deactivate`)**:
   - Desativa plano standalone (`isActive = false`), permitindo ao usuário treinar avulso.
   - Bloqueia com `ACTIVE_WORKOUT_SESSION` se houver sessão aberta.
   - Bloqueia com `PLAN_IS_ACTIVE_PERIODIZATION_BLOCK` se o plano for bloco de uma periodização ativa.
   - Idempotente se já inativo.
3. **CreateWorkoutPlan com Periodization ativa**:
   - `activate = true` rejeitado com `ACTIVE_PERIODIZATION` se `Periodization.isActive = true`.
   - `activate = false` permitido normalmente.
4. **DuplicateWorkoutPlan (`POST /workout-plans/:id/duplicate`)**:
   - Clona `WorkoutPlan`, `WorkoutDay[]` e `WorkoutExercise[]`.
   - Preserva `exerciseId` canônico sem duplicar entidades `Exercise`.
   - Cópia sempre nasce inativa (`isActive = false`) e sem vínculo com `PeriodizationPlan`.
   - Não replica sessões ou histórico de execução.
   - Nome padrão: `${original.name} - Cópia`.

### Composição e Gerenciamento de Periodização (Task 2.3A)

1. **CreatePeriodization (`POST /periodizations`)**:
   - Cria rascunho inativo (`isActive: false`, `startedAt: null`, `completedAt: null`, `status: "DRAFT"`).
   - Nome obrigatório após trim.
2. **ListPeriodizations (`GET /periodizations`)**:
   - Lista periodizações do usuário (`createdAt DESC`) com contagem `totalPlans` e `status` derivado em tempo de execução:
     - `completedAt != null` $\rightarrow$ `COMPLETED`
     - `isActive == true` $\rightarrow$ `ACTIVE`
     - `startedAt != null` $\rightarrow$ `PAUSED`
     - Caso contrário $\rightarrow$ `DRAFT`
3. **GetPeriodization (`GET /periodizations/:id`)**:
   - Retorna detalhes completos com `plans` ordenados por `order ASC` e resumo do `workoutPlan` associado.
4. **UpdatePeriodization (`PATCH /periodizations/:id`)**:
   - Permite editar metadados (`name`, `goal`, `notes`) mesmo em periodizações concluídas.
   - Não permite mutação direta de campos operacionais de ciclo de vida (`isActive`, `startedAt`, `completedAt`).
5. **AddWorkoutPlanToPeriodization (`POST /periodizations/:id/plans`)**:
   - Associa plano existente inativo à periodização (`order = max(order) + 1`).
   - Valida ownership cruzado estrito: `Periodization.userId === WorkoutPlan.userId` (404 em caso de divergência).
   - Bloqueia planos ativos com `ACTIVE_PLAN_CANNOT_BE_ATTACHED` (409).
   - Bloqueia planos já associados com `PLAN_ALREADY_IN_PERIODIZATION` (409).
   - Em periodização ativa, permite apenas anexar ao final como bloco futuro (`activatedAt: null`, `completedAt: null`).
6. **CreateWorkoutPlanInPeriodization (`POST /periodizations/:id/plans/create`)**:
   - Cria atomicamente `WorkoutPlan` (com dias e exercícios) e o anexa a `PeriodizationPlan`.
   - Plano criado nasce estritamente inativo (`isActive: false`).
7. **UpdatePeriodizationPlan (`PATCH /periodizations/:id/plans/:planId`)**:
   - Edita datas previstas (`plannedStartDate`, `plannedEndDate`) e notas.
   - Se o bloco já estiver concluído (`completedAt != null`), datas previstas ficam congeladas (`COMPLETED_BLOCK_IMMUTABLE` / 409).
8. **RemoveWorkoutPlanFromPeriodization (`DELETE /periodizations/:id/plans/:planId`)**:
   - Remove apenas blocos planejados (`activatedAt == null && completedAt == null`).
   - Bloqueia blocos ativos (`ACTIVE_BLOCK_CANNOT_BE_REMOVED` / 409) e blocos concluídos (`COMPLETED_BLOCK_CANNOT_BE_REMOVED` / 409).
   - `WorkoutPlan` permanece intacto no banco de dados e retorna a ser standalone inativo.
   - Compacta ordens subsequentes (`order = order - 1`) na mesma transação.
9. **ReorderPeriodizationPlans (`PUT /periodizations/:id/plans/order`)**:
   - Permite reordenar exclusivamente blocos futuros/planejados.
   - Blocos históricos e bloco ativo permanecem congelados em suas posições.
10. **DeletePeriodization (`DELETE /periodizations/:id`)**:
    - Exclui rascunhos que nunca foram iniciados (`startedAt == null && completedAt == null`).
    - Cascata para `PeriodizationPlan`, mantendo todos os `WorkoutPlan`s associados intactos.
    - Bloqueia exclusão de periodizações já iniciadas (`PERIODIZATION_ALREADY_STARTED` / 409).

### Ciclo Operacional da Periodização (Task 2.3B)

1. **ActivatePeriodization (`POST /periodizations/:id/activate`)**:
   - Ativa ou retoma a periodização e seu bloco atual atomicamente.
   - Bloqueia com `ACTIVE_WORKOUT_SESSION` (409) se houver sessão de treino aberta (`completedAt IS NULL`).
   - Bloqueia com `PERIODIZATION_HAS_NO_PLANS` (409) se a periodização estiver vazia.
   - Bloqueia com `PERIODIZATION_COMPLETED` (409) se a periodização já foi concluída.
   - Na primeira ativação (`startedAt IS NULL`): preenche `startedAt = now()`, ativa o primeiro bloco não concluído (`activatedAt = now()`) e seu `WorkoutPlan` (`isActive = true`).
   - Ao retomar periodização pausada: preserva `startedAt` e `activatedAt` do bloco aberto intactos, ativando `WorkoutPlan.isActive = true`.
   - Se houver plano standalone ativo: desativa-o atomicamente sem concluí-lo.
   - Se houver outra periodização ativa: pausa-a atomicamente sem concluí-la e desativa seu plano aberto.
   - Idempotente se a periodização e seu bloco já estiverem ativos.
2. **DeactivatePeriodization (`POST /periodizations/:id/deactivate`)**:
   - Pausa a periodização ativa (`isActive = false`) e o plano do bloco aberto (`isActive = false`).
   - Preserva `startedAt`, `completedAt = null`, `activatedAt` e `completedAt = null` do bloco aberto.
   - Permite ao atleta ficar sem plano ativo.
   - Bloqueia com `ACTIVE_WORKOUT_SESSION` (409) se houver sessão aberta.
   - Bloqueia com `PERIODIZATION_NOT_STARTED` (409) se for rascunho nunca iniciado.
   - Idempotente se já estiver pausada.
3. **AdvancePeriodizationPlan (`POST /periodizations/:id/advance`)**:
   - Conclui o bloco atual (`completedAt = now()`, `workoutPlan.isActive = false`).
   - Se houver próximo bloco: ativa o próximo bloco (`activatedAt = now()`, `nextWorkoutPlan.isActive = true`).
   - Se o bloco concluído for o último: conclui a periodização (`Periodization.completedAt = now()`, `Periodization.isActive = false`).
   - Exige periodização ativa (`PERIODIZATION_NOT_ACTIVE` / 409) e bloco aberto (`NO_OPEN_BLOCK` / 409).
   - Bloqueia se houver sessão de treino aberta.
4. **CompletePeriodization (`POST /periodizations/:id/complete`)**:
   - Encerramento manual imediato da periodização (`completedAt = now()`, `isActive = false`).
   - Se houver bloco aberto: conclui-o e desativa seu `WorkoutPlan`.
   - Blocos futuros não iniciados permanecem preservados como histórico de planejamento não executado (`activatedAt = null, completedAt = null`).
   - Bloqueia com `PERIODIZATION_NOT_STARTED` (409) se for rascunho nunca iniciado.
   - Idempotente se já concluída (preserva o primeiro `completedAt`).
   - Bloqueia se houver sessão de treino aberta.
5. **Independência de Datas Previstas**:
   - Nenhuma transição de estado ocorre de forma automática por datas previstas (`plannedStartDate`, `plannedEndDate`). Todas as transições são explicitamente manuais e orientadas a use cases.

## Hub de Planejamento — Planning Overview (Task 2.4 & Task 2.4B Hardening)

O endpoint agregado `GET /planning/overview` (`operationId: getPlanningOverview`) fornece ao frontend uma visão completa do estado de planejamento do usuário em uma única requisição somente leitura, sem consultas N+1.

### 1. Active Context (`activeContext`)
União discriminada por `type`:
- `type: "NONE"`: nenhum plano e nenhuma periodização ativos. O usuário continua apto a realizar treinos livres.
- `type: "STANDALONE_PLAN"`: plano de treino ativo independente (não vinculado a periodização ativa). Retorna `{ id, name, workoutDaysCount, createdAt }`.
- `type: "PERIODIZATION"`: periodização ativa (`Periodization.isActive = true`). Retorna `{ id, name, goal, startedAt, currentBlock, totalBlocks, completedBlocks }`.
  - `currentBlock`: bloco aberto em andamento (`activatedAt != null && completedAt == null`), contendo `id`, `order`, `workoutPlanId`, `workoutPlanName`, `activatedAt`, `plannedStartDate` e `plannedEndDate`.

### 2. Prazos e Independência de Timezone do Servidor (Task 2.4B)
- `plannedStartDate` e `plannedEndDate` são `@db.Date` do PostgreSQL, serializados estritamente como strings de calendário `YYYY-MM-DD` puras.
- O backend não avalia nem deriva `isPastPlannedEndDate` a partir de relógio do servidor, eliminando deslocamentos acidentais de fuso horário. O frontend determina se um prazo expirou utilizando a data local do dispositivo do atleta.

### 3. Lista de WorkoutPlans (`plans`)
- Todos os planos do usuário com `_count.workoutDays`, `isActive`, `createdAt` e contexto de periodização `periodization`:
  - `null`: plano standalone.
  - `{ id, name, periodizationPlanId, order, status }`: vinculado a uma periodização. O `status` do bloco é derivado em tempo de execução:
    - `COMPLETED`: `completedAt != null`.
    - `ACTIVE`: `activatedAt != null && completedAt == null`.
    - `PLANNED`: `activatedAt == null && completedAt == null`.
- Ordenação determinística: plano ativo primeiro, depois `createdAt DESC`.

### 4. Lista de Periodizações (`periodizations`)
- Todas as periodizações do usuário com status derivado (`DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`), `totalBlocks`, `completedBlocks`, e `currentBlock` (se houver bloco aberto).
- **Periodização Pausada**: preserva o bloco em andamento como `currentBlock` (com seu plano `isActive = false`), permitindo que o frontend exiba a última etapa e a ação de retomar.
- **Contagem Histórica**: `completedBlocks` conta estritamente blocos com `completedAt != null`. Blocos futuros de periodizações encerradas manualmente não são computados como concluídos.
- Ordenação determinística: `ACTIVE > PAUSED > DRAFT > COMPLETED`, e dentro de cada grupo por `createdAt DESC`.

### 5. Integridade Defensiva e Sincronismo do Active Context (Task 2.4B)
- **100% Read-Only**: zero mutações ou reparações silenciosas no banco.
- **Validação Estrita de Sincronismo**:
  - Quando existir `Periodization.isActive = true`, exige-se:
    1. Exatamente um bloco aberto (`activatedAt != null && completedAt == null`);
    2. Exatamente um `WorkoutPlan` ativo do usuário;
    3. `activeWorkoutPlan.id === openPeriodizationPlan.workoutPlanId`.
  - Se não existir periodização ativa, mas existir um `WorkoutPlan.isActive = true` que pertença a uma periodização (`periodizationPlan != null`), ou mais de um plano ativo, isso representa descompasso de estado.
  - Diante de qualquer descompasso, o use case loga o diagnóstico interno e lança o erro de domínio `InconsistentPlanningStateError` (código tipado `INCONSISTENT_PLANNING_STATE`, HTTP 409), sem expor detalhes estruturais ao usuário final.
- Execução agregada em 2 queries paralelas com `include` e `_count`, garantindo escalabilidade sem N+1.

## Regras de histórico

1. editar plano não reescreve sessão antiga;
2. excluir template não apaga execução;
3. carga/reps/RIR executados permanecem auditáveis;
4. plano gerado por IA usa o mesmo fluxo de execução do plano manual;
5. excluir periodização não exclui os WorkoutPlans associados.

## Índices importantes

```text
WorkoutPlan(userId, isActive)
WorkoutSession(athleteId, startedAt)
WorkoutSet(sessionExerciseId, order)
CoachAthlete(coachId, athleteId, status)
SourceDocument(ownerUserId, status)
SourceChunk(sourceDocumentId)
```
