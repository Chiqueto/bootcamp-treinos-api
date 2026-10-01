# 08 — Arquitetura de Histórico & Evolução (Fase 3)

## 1. Visão Geral e Escopo

A Fase 3 do Trainvy introduz a camada de inteligência e acompanhamento longitudinal sobre os treinos executados no tracker real (Fase 1) e organizados no hub de planejamento (Fase 2).

O objetivo é transformar os registros brutos de execução em métricas acionáveis de progresso:
- **Histórico cronológico unificado:** visualização contínua de sessões concluídas (planejadas e avulsas).
- **Histórico e evolução por exercício:** progressão de carga, repetições, esforço percebido (RIR) e volume de carga.
- **Volume semanal e distribuição muscular:** contagem de séries efetivas (`workingSets`) divididas em estímulos diretos (`PRIMARY`) e indiretos (`SECONDARY`), além da tonelagem total (`loadVolume`).
- **Recordes pessoais (PRs):** identificação automática do `loadPR` por exercício.
- **Comparação planejado vs executado:** contraste auditável entre prescrição e execução real sem dependência do estado mutável do plano.

---

## 2. Auditoria do Domínio Atual e Diagnóstico de Gaps

### 2.1 Entidades Existentes

```text
WorkoutSession (Sessão de treino)
├── id: String (UUID)
├── workoutDayId: String? (FK nullable -> WorkoutDay, onDelete: SetNull)
├── athleteId: String (FK -> User, onDelete: Cascade)
├── startedAt: Timestamptz
├── completedAt: Timestamptz?
├── createdAt / updatedAt: Timestamptz
└── sessionExercises: SessionExercise[]

SessionExercise (Snapshot do exercício na sessão)
├── id: String (UUID)
├── workoutSessionId: String (FK -> WorkoutSession, onDelete: Cascade)
├── sourceWorkoutExerciseId: String? (FK nullable -> WorkoutExercise, onDelete: SetNull)
├── exerciseId: String? (FK nullable -> Exercise, onDelete: SetNull)
├── exerciseNameSnapshot: String
├── order: Int
├── plannedSets: Int?
├── plannedReps: Int?
├── plannedRestTimeInSeconds: Int?
├── notes: String?
└── sets: WorkoutSet[]

WorkoutSet (Série executada)
├── id: String (UUID)
├── sessionExerciseId: String (FK -> SessionExercise, onDelete: Cascade)
├── order: Int
├── type: SetType (WARMUP | WORKING, default: WORKING)
├── weightInGrams: Int?
├── reps: Int?
├── rir: Int? (0..10)
├── durationInSeconds: Int?
├── notes: String?
└── completedAt: Timestamptz?

Exercise (Catálogo de exercícios)
├── id: String (UUID)
├── ownerUserId: String? (FK nullable -> User, onDelete: Cascade)
├── name: String
└── indexes: global unique name (case-insensitive), user unique name (case-insensitive)
```

### 2.2 Diagnóstico de Gaps Identificados

| Componente | Estado Atual | Problema Identificado | Solução Fase 3 |
|---|---|---|---|
| **Origem da Sessão** | Inferida por `workoutDayId != null` | Se o `WorkoutDay` for deletado, `workoutDayId` vira `null` (`SetNull`), descaracterizando treino planejado como avulso. | Adicionar enum explícito e imutável `WorkoutSessionOrigin { PLANNED, FREE }`. |
| **Snapshot de Plano/Dia** | Ausente em `WorkoutSession` | Se o plano ou dia forem renomeados ou excluídos, a linha do tempo histórica perde o nome original do plano/etapa. | Adicionar `workoutPlanId` (nullable FK), `workoutPlanNameSnapshot` e `workoutDayNameSnapshot`. |
| **Grupos Musculares** | Inexistente em `Exercise` | Impossível calcular volume muscular (quantas séries de peito, costas ou quadríceps foram feitas). | Criar enum `MuscleGroup` e tabela de relação `ExerciseMuscle` (`PRIMARY` vs `SECONDARY`). |
| **Identidade do Exercício** | `exerciseId` nullable em `SessionExercise` | Se o `Exercise` for excluído, vira `null`. Legados antigos podem não ter `exerciseId`. | Fallback determinístico (`exerciseId` primário -> fallback `LOWER(TRIM(exerciseNameSnapshot))`). |
| **Índices de Performance** | Sem índice composto para consultas analíticas | Agregações de séries por exercício e atleta exigem scan relacional profundo. | Novos índices compostos para histórico e paginação por cursor. |

---

## 3. Decisões Fundamentais de Domínio

### 3.1 Identidade Histórica do Exercício
- **Regra canônica:** O histórico de um exercício é composto por todas as execuções associadas ao mesmo `Exercise.id` canônico (`SessionExercise.exerciseId === Exercise.id`).
- **Renomeação de Exercício:** A alteração do nome no catálogo `Exercise` não fragmenta o histórico. O agrupamento analítico é feito por `exerciseId`. O campo `SessionExercise.exerciseNameSnapshot` preserva com exatidão como o exercício era chamado no dia da execução.
- **Prevenção de Perda Histórica:** Exercícios que possuem histórico (`SessionExercise`) não devem ser fisicamente deletados do banco de dados (recomenda-se soft delete / flag de arquivamento no catálogo).
- **Fallback para Legado:** Para registros anteriores onde `exerciseId IS NULL`, a agregação utiliza `LOWER(TRIM(exerciseNameSnapshot))` como critério de agrupamento secundário.

### 3.2 Imutabilidade da Origem e do Contexto (PLANNED vs FREE)
- Introdução do enum:
  ```prisma
  enum WorkoutSessionOrigin {
    PLANNED
    FREE
  }
  ```
- **Campos imutáveis gravados na inicialização da sessão (`WorkoutSession`):**
  - Sessão Planejada (`origin = PLANNED`):
    - `workoutPlanId`: ID do plano no momento do início.
    - `workoutPlanNameSnapshot`: Nome do plano (ex: "Hipertrofia A").
    - `workoutDayId`: ID do dia de treino.
    - `workoutDayNameSnapshot`: Nome do dia (ex: "Superior A").
  - Sessão Avulsa (`origin = FREE`):
    - `workoutPlanId = null`, `workoutPlanNameSnapshot = null`, `workoutDayId = null`, `workoutDayNameSnapshot = null`.
- **Garantia:** O passado é imutável. Alterações futuras no Hub de Planejamento (renomeações, exclusões de planos ou reordenação de blocos de periodização) não distorcem os registros históricos.

### 3.3 Filtro de Séries e Regras de Analytics
- **`SetType.WORKING` (Séries Efetivas):**
  - Único tipo considerado nas métricas de volume, carga, tonelagem, PR e gráficos de progresso.
  - Padrão do sistema (`@default(WORKING)`).
- **`SetType.WARMUP` (Séries de Aquecimento / Feeder):**
  - Exibidas no detalhe cronológico do treino para contexto do atleta.
  - Estritamente ignoradas no cômputo de volume semanal e nos recordes de carga.
- **Critério de Conclusão:**
  - Apenas séries com `completedAt IS NOT NULL` são consideradas nas agregações analíticas.

### 3.4 Distinção Rigorosa de Volume
A arquitetura adota duas métricas distintas para evitar ambiguidades:

1. **Volume por Séries (`workingSets`):**
   - Número inteiro de séries `WORKING` concluídas no período/músculo.
   - Métrica principal para hipertrofia e fadiga.
2. **Volume de Carga / Tonnage (`loadVolume`):**
   - Tonelagem calculada por:
     $$\text{loadVolumeGrams} = \sum (\text{weightInGrams} \times \text{reps})$$
   - Computada para séries `WORKING` concluídas.
   - Armazenada em gramas (inteiro de alta precisão). A conversão para quilogramas (`loadVolumeKg = loadVolumeGrams / 1000`) ocorre unicamente no DTO/camada de apresentação.
   - Exercícios sem sobrecarga externa (`weightInGrams === null` ou `0`) contabilizam `0` de sobrecarga externa na tonelagem, mas somam normalmente em `workingSets`.

---

## 4. Modelagem de Grupos Musculares (Muscle Groups)

### 4.1 Enums e Tabela de Relação

```prisma
enum MuscleGroup {
  CHEST        // Peitoral
  BACK         // Costas / Dorsal
  QUADRICEPS   // Quadríceps
  HAMSTRINGS   // Posteriores de Coxa
  GLUTES       // Glúteos
  CALVES       // Panturrilhas
  SHOULDERS    // Ombros / Deltoides
  BICEPS       // Bíceps
  TRICEPS      // Tríceps
  FOREARMS     // Antebraços
  CORE         // Abdômen e Lombar
}

enum MuscleRole {
  PRIMARY      // Músculo motor primário (série direta)
  SECONDARY    // Músculo sinergista / auxiliar (série indireta)
}

model ExerciseMuscle {
  id          String      @id @default(uuid())
  exerciseId  String
  exercise    Exercise    @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  muscleGroup MuscleGroup
  role        MuscleRole  @default(PRIMARY)
  createdAt   DateTime    @default(now()) @db.Timestamptz()

  @@unique([exerciseId, muscleGroup])
  @@index([muscleGroup, role])
}
```

### 4.2 Séries Diretas e Indiretas (Sem Ponderação Arbitrária)
- Uma série `WORKING` em um exercício com papel `PRIMARY` soma **+1 série direta** naquele grupo muscular.
- Uma série `WORKING` em um exercício com papel `SECONDARY` soma **+1 série indireta** naquele grupo muscular.
- **Exemplo Real:**
  - Supino Reto: `CHEST (PRIMARY)`, `TRICEPS (SECONDARY)`, `SHOULDERS (SECONDARY)`.
  - 4 séries de Supino contabilizam:
    - Peito: 4 séries diretas.
    - Tríceps: 4 séries indiretas.
    - Ombros: 4 séries indiretas.
- **Decisão:** Não aplicar fatores fracionários subjetivos (ex: 0.5 tríceps, 0.3 ombro). A separação limpa entre diretas e indiretas reflete com precisão as melhores práticas da ciência do exercício e mantém a UI transparente.

### 4.3 Histórico Muscular e Atualizações do Catálogo
- Para o MVP da Fase 3, as agregações musculares consultam a relação relacional atual `Exercise -> ExerciseMuscle`.
- Como a biomecânica e o envolvimento muscular dos exercícios canônicos são estáveis, não é necessário duplicar tabelas de snapshot muscular por série individual.

---

## 5. Evolução por Exercício e Recordes Pessoais (PR)

### 5.1 Critérios de Evolução (Tríade Transparente)
Não será criado um "score de evolução sintético". A evolução é avaliada através de métricas objetivas:
1. **Carga (`weightInGrams`):** Aumento de carga mantendo repetições e RIR.
2. **Repetições (`reps`):** Aumento de repetições mantendo carga e RIR.
3. **Esforço Percebido (`rir`):** Manutenção de carga e reps com maior reserva (ex: RIR 1 -> RIR 3 = série mais fácil/maior eficiência).
4. **Volume de Carga (`loadVolume`):** Aumento do trabalho total no exercício durante a sessão.

### 5.2 RIR Ausente
- O RIR é opcional no tracker real.
- As consultas e gráficos analíticos operam normalmente quando `rir === null`.

### 5.3 Definição de Load PR (`loadPR`)
- O `loadPR` representa a **maior carga (`weightInGrams`) concluída** em uma série `WORKING` para aquele exercício.
- **Desempate e Contexto Histórico:**
  - Em caso de empate de carga máxima, prioriza-se a série com mais repetições (`reps DESC`).
  - Persistindo empate, prioriza-se a data mais recente (`completedAt DESC`).
  - O payload da resposta inclui metadados contextuais: `reps`, `rir`, `completedAt` e `workoutSessionId`.
- **Roadmap Futuro (Fase 3+):** e1RM (Estimated 1-Rep Max via fórmulas Brzycki/Epley) e PRs por faixa de repetições (5RM, 8RM, 10RM).

---

## 6. Histórico Cronológico e Paginação

### 6.1 Estratégia de Paginação: Cursor-Based Pagination
- A timeline de treinos do Trainvy é uma visualização contínua pensada para scroll infinito no mobile.
- A paginação por Offset (`OFFSET n LIMIT m`) é desaconselhada devido ao custo em tabelas de histórico e ao problema de itens duplicados/deslocados quando novos treinos são finalizados.
- **Cursor determinístico:** `completedAt DESC, id DESC`.
- O cliente envia `cursor` (codificação de `completedAt` + `id`) e recebe a próxima página de forma atômica e indexada.

### 6.2 Separação Entre Timeline e Analytics
- A listagem cronológica paginada atende à tela de histórico.
- Os endpoints de analytics (semanal, mensal, grupos musculares) operam sobre **janelas temporais fechadas** (ex: `startDate` e `endDate` ou `lastWeeks=4`), sem vínculo com a página atual do scroll.

---

## 7. Agregações Temporais e Timezone

### 7.1 Semanas de Treino
- A semana do Trainvy inicia na **Segunda-feira 00:00:00** e encerra no **Domingo 23:59:59**.
- Os timestamps no PostgreSQL são gravados em UTC (`Timestamptz`).
- **Resolução de Timezone:**
  - Endpoints de analytics temporal devem receber o timezone IANA do usuário (ex: `?tz=America/Sao_Paulo`).
  - A query de agrupamento semanal utiliza:
    ```sql
    DATE_TRUNC('week', "completedAt" AT TIME ZONE :userTimezone)
    ```
  - Isso previne que treinos realizados no domingo à noite caiam na semana seguinte devido ao deslocamento para UTC.

---

## 8. Comparação Planejado vs Executado (*Planned vs Performed*)

- Para cada exercício da sessão:
  - **Planejado:** derivado dos snapshots imutáveis em `SessionExercise` (`plannedSets`, `plannedReps`, `plannedRestTimeInSeconds`).
  - **Executado:** derivado dos `WorkoutSet`s concluídos vinculados ao `SessionExercise` (contagem de sets, reps reais, cargas, RIR).
- Para sessões avulsas (`FREE`):
  - `plannedSets = null`, `plannedReps = null`. A interface exibe apenas o executado, sem indicadores de meta prescrita.
- Independência total: O cálculo não consulta nem depende do estado do `WorkoutPlan` ativo.

---

## 9. Performance e Índices Recomendados

Para sustentar as consultas da Fase 3 sem degradação:

```sql
-- 1. Paginação da timeline cronológica por cursor
CREATE INDEX "WorkoutSession_athleteId_completedAt_id_desc_idx"
ON "WorkoutSession" ("athleteId", "completedAt" DESC, "id" DESC)
WHERE "completedAt" IS NOT NULL;

-- 2. Histórico de sessões de um exercício específico
CREATE INDEX "SessionExercise_exerciseId_workoutSessionId_idx"
ON "SessionExercise" ("exerciseId", "workoutSessionId");

-- 3. Agregações analíticas rápidas de séries concluídas por tipo
CREATE INDEX "WorkoutSet_sessionExerciseId_completed_type_idx"
ON "WorkoutSet" ("sessionExerciseId", "completedAt", "type");
```

---

## 10. Arquitetura de Endpoints Recomendada

Para evitar o padrão N+1 no frontend:

1. `GET /history/sessions`
   - Parâmetros: `cursor?`, `limit?` (default: 15), `origin?` (`PLANNED` | `FREE`).
   - Retorna: itens de sessão com métricas agregadas pré-computadas na query (`workingSetsCount`, `totalLoadVolumeKg`, `exercisesCount`, `durationInSeconds`).
2. `GET /history/sessions/:sessionId`
   - Retorna: detalhe completo da sessão com snapshots de plano/dia, exercícios e séries completas comparando planejado vs executado.
3. `GET /history/exercises/:exerciseId`
   - Retorna: histórico longitudinal do exercício, `loadPR` com contexto, e histórico das últimas execuções ordenadas cronologicamente.
4. `GET /history/analytics/weekly`
   - Parâmetros: `tz`, `startDate`, `endDate` (ou `weeksCount`).
   - Retorna: métricas semanais consolidadas (treinos finalizados, `workingSets`, `loadVolumeKg`, média de duração).
5. `GET /history/analytics/muscles`
   - Parâmetros: `tz`, `startDate`, `endDate`.
   - Retorna: distribuição de volume por `MuscleGroup` separando séries diretas (`directWorkingSets`) e indiretas (`indirectWorkingSets`).

---

## 11. Plano de Decomposição em Tasks (Fase 3)

1. **Task 3.1B — Modelagem de Dados, Snapshots e Origem da Sessão:**
   - Adicionar enum `WorkoutSessionOrigin`, campos de snapshot em `WorkoutSession`.
   - Migration e backfill determinístico de registros existentes.
   - Atualizar use cases `StartWorkoutSession` e `StartFreeWorkoutSession`.
2. **Task 3.1C — Catálogo de Grupos Musculares (`MuscleGroup` & `ExerciseMuscle`):**
   - Enums `MuscleGroup` e `MuscleRole`.
   - Modelo `ExerciseMuscle` com constraints de unicidade e migration.
   - Seed dos exercícios existentes do catálogo global com suas musculaturas primárias e secundárias.
3. **Task 3.2 — History Timeline API:**
   - Implementação de `GET /history/sessions` (cursor pagination) e `GET /history/sessions/:sessionId`.
   - Contratos Zod e testes de integração de isolamento e paginação.
4. **Task 3.3 — Exercise Evolution & Load PR API:**
   - Implementação de `GET /history/exercises/:exerciseId`.
   - Cálculo determinístico de `loadPR` e evolução temporal.
5. **Task 3.4 — Weekly & Muscle Analytics API:**
   - Implementação de `GET /history/analytics/weekly` e `GET /history/analytics/muscles` com suporte a timezone.
6. **Task 3.5 — Frontend: Histórico de Treinos:**
   - Rota `/history`, scroll infinito, cards unificados de treinos planejados e avulsos, tela de detalhe com contraste planejado vs executado.
7. **Task 3.6 — Frontend: Evolução e Métricas Musculares:**
   - Dashboard de evolução, gráficos semanais de volume, mapa/distribuição muscular e visualização de recordes pessoais (PRs).

---

## 12. Histórico de Execução e Status de Implementação

### Task 3.1B — Persistência Histórica, Origem da Sessão e Snapshots
- **Status:** `3.1B IMPLEMENTADA`
- **Data:** 2026-10-01
- **Migration criada:** `prisma/migrations/20261001120000_task3_1b_history_origin_snapshots/migration.sql`
- **Campos efetivamente adotados:**
  - `WorkoutSession.origin`: enum `WorkoutSessionOrigin { PLANNED, FREE }` (NOT NULL, sem `@default` em runtime/schema final para exigir declaração explícita na criação).
  - `WorkoutSession.workoutPlanId`: `String?` (FK com `onDelete: SetNull` preservando a sessão histórica caso o plano seja excluído).
  - `WorkoutSession.workoutPlanNameSnapshot`: `String?` (snapshot imutável do nome do plano no momento de início do treino).
  - `WorkoutSession.workoutDayNameSnapshot`: `String?` (snapshot imutável do nome do dia no momento de início do treino).
  - `WorkoutPlan.workoutSessions`: relação inversa tipada.
- **Estratégia de Backfill e Execução Segura:**
  1. Criação do enum `WorkoutSessionOrigin`.
  2. Adição da coluna `origin` inicialmente nula, além de `workoutPlanId`, `workoutPlanNameSnapshot`, `workoutDayNameSnapshot`.
  3. Preenchimento de sessões planejadas (`workoutDayId IS NOT NULL`):
     - `origin = 'PLANNED'`
     - Preenchimento de `workoutPlanId`, `workoutPlanNameSnapshot`, `workoutDayNameSnapshot` consultando `WorkoutDay` e `WorkoutPlan`.
  4. Preenchimento de sessões avulsas (`workoutDayId IS NULL`):
     - `origin = 'FREE'`
  5. Alteração da coluna `origin` para `NOT NULL`.
  6. Criação de Foreign Keys e Índices.
- **Auditoria de Dados e Contagem do Backfill:**
  - Ambiente de Teste (`TEST_DATABASE_URL`): 1 sessão total com `workoutDayId` $\rightarrow$ migrada para `PLANNED` com snapshots íntegros.
  - Ambiente de Produção (`DATABASE_URL`): 3 sessões totais (1 planejada com `workoutDayId`, 2 com `workoutDayId IS NULL`). Migration mantida estritamente como **pendente** (não aplicada em produção conforme regra de release).
- **Índices Criados:**
  - `WorkoutSession_athleteId_completedAt_id_desc_idx`: Índice parcial `ON "WorkoutSession" ("athleteId", "completedAt" DESC, "id" DESC) WHERE "completedAt" IS NOT NULL;` para cursor pagination determinístico.
  - `WorkoutSession_workoutPlanId_idx`: Índice para FK `WorkoutSession(workoutPlanId)`.
  - `SessionExercise_exerciseId_workoutSessionId_idx`: Índice composto em `SessionExercise(exerciseId, workoutSessionId)` para histórico longitudinal por exercício.
  - `WorkoutSet_sessionExerciseId_type_completedAt_idx`: Índice analítico em `WorkoutSet(sessionExerciseId, type, completedAt)` para agregações e filtros por tipo de série (com `type` posicionado para filtragem direta de séries efetivas `WORKING`).
- **Limitação de Legado Documentada:**
  - Caso histórico em que um `WorkoutDay` tenha sido deletado no passado (tornando `workoutDayId = NULL` por `SetNull`), a sessão é classificada como `FREE` no backfill, pois sem audit trail prévio não há base para distinguir de um treino livre genuíno.
- **Use Cases Atualizados:**
  - `StartWorkoutSession`: Valida integridade e ownership de `WorkoutDay` e `WorkoutPlan`, define `origin: PLANNED`, `workoutPlanId`, e snapshots imutáveis.
  - `StartFreeWorkoutSession`: Define explicitamente `origin: FREE` com contexto e snapshots nulos.
  - `GetWorkoutSession`: DTO atualizado de forma aditiva para expor `origin`, `workoutPlanId`, `workoutPlanNameSnapshot`, `workoutDayNameSnapshot`.
  - `GetActiveWorkoutSession`: Preservado retornando dados íntegros e snapshots.
  - Schemas HTTP: `WorkoutSessionOriginSchema` criado e acoplado de forma compatível e aditiva.

### Task 3.1C — Catálogo de Grupos Musculares & Resolução Canônica
- **Status:** `3.1C IMPLEMENTADA`
- **Data:** 2026-10-01
- **Migration criada:** `prisma/migrations/20261001140000_task3_1c_exercise_muscles/migration.sql`
- **Taxonomia Adotada:**
  - `enum MuscleGroup`: `CHEST`, `BACK`, `SHOULDERS`, `BICEPS`, `TRICEPS`, `FOREARMS`, `QUADRICEPS`, `HAMSTRINGS`, `GLUTES`, `ADDUCTORS`, `HIP_ABDUCTORS`, `CALVES`, `CORE` (13 grupos anatômicos moderados).
  - `enum MuscleRole`: `PRIMARY` (estímulo direto), `SECONDARY` (estímulo indireto).
  - Modelo `ExerciseMuscle`: `(id, exerciseId, muscleGroup, role, createdAt)` com constraint única `@@unique([exerciseId, muscleGroup])` e índice composto `@@index([muscleGroup, role])`.
- **Regras de Negócio e Validação:**
  - Um exercício classificado deve possuir pelo menos 1 grupo `PRIMARY`.
  - O domínio aceita múltiplos grupos `PRIMARY` (ex: Agachamento Livre com `QUADRICEPS` e `GLUTES` como `PRIMARY`).
  - O mesmo músculo é impedido de figurar simultaneamente como `PRIMARY` e `SECONDARY`.
  - Duplicatas de grupos no mesmo papel são sanitizadas/deduplicadas automaticamente.
  - Exercícios sem relações (`muscles = []`) representam conceitualmente `UNCLASSIFIED`.
- **Inventário de Exercícios e Taxas de Nulidade Auditadas:**
  - **TEST (`TEST_DATABASE_URL`):**
    - Total de Exercícios: 26 (0 globais, 26 customizados do usuário).
    - `WorkoutExercise.exerciseId`: 80 total, 54 nulos, 26 vinculados (67,50% nulos).
    - `SessionExercise.exerciseId`: 0 registros.
  - **PRODUÇÃO (`DATABASE_URL`):**
    - Total de Exercícios: 28 (0 globais, 28 customizados do usuário).
    - `WorkoutExercise.exerciseId`: 80 total, 54 nulos, 26 vinculados (67,50% nulos).
    - `SessionExercise.exerciseId`: 9 total, 7 nulos, 2 vinculados (77,78% nulos).
- **Catálogo Global e Sincronização:**
  - Mapeamento determinístico versionado em código (`GLOBAL_EXERCISE_MUSCLE_MAPPING` em `src/domain/muscle-taxonomy.ts`) cobrindo 27 exercícios padrão da musculação.
  - Função `syncGlobalExerciseMuscles`: operação idempotente de catálogo que insere relações para exercícios globais conhecidos, sem duplicatas e que NUNCA altera exercícios de usuários.
- **Estratégia de Resolução Canônica (`resolveCanonicalExerciseId`):**
  - Igualdade exata sobre `LOWER(TRIM(name))`.
  - Ordem estrita de prioridade:
    1. Exercício personalizado do próprio usuário (`ownerUserId === userId`).
    2. Exercício global do catálogo (`ownerUserId === null`).
    3. Nenhum match $\rightarrow$ retorna `null`.
  - NUNCA associa com exercícios de outros usuários.
  - NUNCA utiliza correspondência fuzzy (evita vincular "Agachamento" a "Agachamento Búlgaro").
  - Integrado em `CreateWorkoutPlan`, `CreateWorkoutPlanInPeriodization` e `CreatePeriodizationDraftFromAI`.
  - Exercícios propostos pela IA sem correspondência exata permanecem com `exerciseId = null` (a IA não cria exercícios silenciosamente no catálogo).
  - `DuplicateWorkoutPlan` preserva com fidelidade o `exerciseId` existente.
- **Custom Exercises e Frontend:**
  - `CreateExercise` atualizado para receber `primaryMuscleGroups` e `secondaryMuscleGroups`.
  - Novo endpoint `PUT /exercises/:id/muscles` com use case `UpdateExerciseMuscles` realizando substituição atômica dentro de transação e checagem estrita de ownership (retorna 404 para exercícios globais ou de terceiros).
  - Modal de seleção de exercícios (`ExerciseSelectorModal`) exibe grupos musculares em português via helper centralizado (`app/_lib/muscle-labels.ts`).
  - Exercícios legados sem músculos exibem discretamente "Sem classificação" com acionador "Classificar".
  - Formulário mobile simplificado: exige 1 `PRIMARY` e permite seleção dinâmica de `N SECONDARY`.
- **Limitações e Decisões de Escopo:**
  - Nesta task, não são computados volumes musculares nem expostos endpoints de analytics.
  - A contagem futura tratará 1 working set em `PRIMARY` como 1 série direta e em `SECONDARY` como 1 série indireta (sem pesos decimais 0.5 / 0.3).
  - Não foi criado snapshot de músculos em `SessionExercise` (analytics consultarão a relação atual `Exercise -> ExerciseMuscle`).

### Task 3.1D — Catálogo Canônico Global & Backfill de Legado
- **Status:** `3.1D IMPLEMENTADA`
- **Data:** 2026-10-01
- **Migration criada:** `prisma/migrations/20261001143000_task3_1d_canonical_catalog_backfill/migration.sql`
- **Catálogo Global Oficial:**
  - 33 exercícios canônicos padrão da musculação criados com `ownerUserId = NULL`.
  - IDs determinísticos com UUIDs RFC 4122 v4 fixos e estáveis entre ambientes (`00000000-0000-4000-8000-000000000101` a `00000000-0000-4000-8000-000000000133`), garantindo rastreabilidade e integridade longitudinal.
  - 71 relações `ExerciseMuscle` criadas deterministicamente com `PRIMARY` (estímulo direto) e `SECONDARY` (estímulo indireto).
- **Estratégia de Rollout via Migration (Justificativa):**
  - O catálogo canônico é domínio essencial do produto. Depender de `prisma db seed` manual pós-deploy introduz risco operacional e dependência humana.
  - A inclusão direta dos dados de referência e do backfill em migration SQL transacional e idempotente assegura que a estrutura e os vínculos canônicos existam atomicamente logo após o pipeline de deploy (`prisma migrate deploy`).
  - Totalmente idempotente através de `ON CONFLICT DO NOTHING` e `WHERE NOT EXISTS`.
- **Classificação Segura de Custom Exercises Legados:**
  - Exercícios customizados (`ownerUserId IS NOT NULL`) que possuíam 0 músculos e cujo nome coincidiu com exact-match normalizado (`LOWER(TRIM(c.name)) = LOWER(TRIM(g.name))`) receberam a classificação muscular oficial do catálogo.
  - Exercícios customizados com classificação manual prévia (`muscles.length > 0`) foram mantidos 100% inalterados (precedência do usuário).
  - A identidade (`id` e `ownerUserId`) de todos os exercícios customizados foi preservada (nenhum custom foi convertido em global).
- **Backfill de `WorkoutExercise.exerciseId`:**
  - Para registros legados onde `exerciseId IS NULL`:
    1. Prioridade 1: Match exato normalizado com `Exercise` do próprio usuário criador do plano (`e.ownerUserId = wp.userId`).
    2. Prioridade 2: Match exato normalizado com `Exercise` canônico global (`e.ownerUserId IS NULL`).
    3. Sem match: Permanece `exerciseId = NULL`.
  - Nenhuma alteração textual ou prescritiva em `name`, `sets`, `reps`, `warmupSets`, ordem ou dia.
- **Backfill de `SessionExercise.exerciseId`:**
  - Para registros legados de sessão onde `exerciseId IS NULL`:
    1. Estratégia 1 (Preferencial): Herdar de `sourceWorkoutExercise.exerciseId` se este já estiver resolvido.
    2. Estratégia 2 (Fallback seguro): Match exato normalizado contra `Exercise` próprio do atleta da sessão ou global.
    3. Sem match: Permanece `exerciseId = NULL`.
  - Imutabilidade absoluta do histórico de execução (`exerciseNameSnapshot`, séries realizadas, cargas, RIR).
- **Cobertura Canônica Auditada (Antes vs Depois):**
  - **Ambiente TEST (`TEST_DATABASE_URL`):**
    - Globais no banco: 0 $\rightarrow$ **33** (+33)
    - Customizados com músculos: 0 / 26 (0%) $\rightarrow$ **26 / 26 (100%)**
    - `WorkoutExercise`:
      - Total: 80
      - Vinculados (`exerciseId IS NOT NULL`): 26 (32,5%) $\rightarrow$ **47 (58,75%)**
      - Nulos (`exerciseId IS NULL`): 54 (67,5%) $\rightarrow$ **33 (41,25%)**
    - `SessionExercise`: Total 0 no banco de testes.
    - Exercícios não resolvidos restantes (33 nomes): Variações específicas de periodização/IA sem correspondência exata no catálogo (ex: *"Puxada Alta"*, *"Leg Press"*, *"Remada Cavalinho"*, *"Salto em Caixa"*, *"Burpee"*, *"Levantamento Terra Sumô (leve)"*, etc.). Permanecem legitimamente nulos para não distorcer analytics futuros com falsos positivos.
  - **Ambiente de PRODUÇÃO (`DATABASE_URL` — Leitura / Estimativa):**
    - Globais no banco: 0 $\rightarrow$ 33 estimados após rollout.
    - Customizados: 28 existentes (27 exact-matched com catálogo; 1 legítimo custom sem correspondência: *"Sissy squat"*).
    - `WorkoutExercise` (80 total):
      - Antes: 26 vinculados, 54 nulos (67,5% nulos).
      - Estimativa após: 35 vinculados (+9 matches exatos com custom dos usuários), 45 nulos (56,25% nulos).
    - `SessionExercise` (9 total):
      - Antes: 2 vinculados, 7 nulos (77,78% nulos).
      - Estimativa após: 4 vinculados (+2 via `sourceWorkoutExercise`), 5 nulos (55,56% nulos).
    - **Regra de Produção Cumprida:** Nenhuma migration ou mutação executada contra produção nesta task.
- **Garantia para Novos Planos:**
  - Use cases `CreateWorkoutPlan`, `CreateWorkoutPlanInPeriodization` e `CreatePeriodizationDraftFromAI` utilizam `resolveCanonicalExerciseId` / `resolveCanonicalExerciseMap`, resolvendo automaticamente contra custom ou catálogo global durante a criação.


