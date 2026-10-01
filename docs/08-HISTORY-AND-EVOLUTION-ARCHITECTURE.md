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

