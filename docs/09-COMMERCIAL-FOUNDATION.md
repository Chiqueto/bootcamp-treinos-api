# 09 — Identity & Commercial Foundation

## Status e limites

Task 4.1 implementada. Fase 4 continua em andamento; próxima task: **4.2 Admin Console**.
Não há /admin visual, CoachAthlete, gestão de terceiros, checkout, cobranças, webhooks, integração Asaas, RAG ou MCP.
A fundação de entitlements não aplica gating às features individuais existentes (Coach AI, Planning, Tracker, History e Stats).

## Conceitos separados

- `User.accountType`: ATHLETE ou COACH; ambos continuam sendo User e treinam para si.
- `User.systemRole`: USER ou ADMIN. COACH não implica ADMIN; ADMIN não implica COACH nem assinatura ativa.
- `User.accountSetupCompletedAt`: marca explicitamente a conclusão do cadastro. Novos usuários OAuth têm NULL.
- `Plan`: catálogo comercial, código estável, audiência ATHLETE/COACH/INTERNAL, preço em centavos, moeda, publicação, ativação e ordenação.
- `PlanEntitlement`: chave e limite opcional, unique(planId, entitlement). NULL significa sem limite quantitativo configurado; ausência significa não concedido.
- `Subscription`: única por userId; estado, provedor, snapshot de preço/moeda, trial/período/cancelamento e ID externo opcional.
- `BillingCustomer`: unique(userId, provider) e unique(provider, externalCustomerId). Não aceita NONE; nada é criado automaticamente nesta etapa.
- `SignupIntent`: hash SHA-256 de token criptográfico aleatório de 32 bytes, accountType, planId, expiresAt, consumedAt e createdAt. TTL de 20 minutos. Token cru não é persistido no banco.

## Planos e bootstrap

| code | audiência | preço inicial/mês | público | limites |
|---|---|---:|---|---|
| ATHLETE_FREE | ATHLETE | R$ 0 | sim | recursos individuais preservados |
| COACH | COACH | R$ 39,90 | sim | MANAGE_ATHLETES = 5 |
| COACH_AI | COACH | R$ 79,90 | sim | MANAGE_ATHLETES = 15 |
| INTERNAL | INTERNAL | R$ 0 | não | conjunto completo sem limite configurado |

COACH recebe COACH_DASHBOARD, MANAGE_ATHLETES, ASSIGN_WORKOUTS, VIEW_ATHLETE_HISTORY e ADVANCED_STATS.
COACH_AI acrescenta AI_CHAT, AI_PLAN_GENERATION e SOURCE_LIBRARY. INTERNAL recebe as oito chaves.
Essas chaves preparam capacidades futuras, não anunciam implementação de gestão de alunos ou biblioteca.

A migration insere os defaults. `npm run commercial:bootstrap` permite repetir o bootstrap explicitamente.
SQL usa INSERT ... ON CONFLICT DO NOTHING e só insere entitlements para planos recém-criados.
**Nunca sobrescreve preço, publicação, limites ou entitlements editados/removidos administrativamente.**
Não roda automaticamente em deploy. A atribuição de INTERNAL não possui rota pública.

## Migration e backfill

`20261007120000_identity_commercial_foundation` é aditiva e transacional:
novos enums/tabelas, colunas no User, índices únicos, FKs e CHECKs de preços/limites não negativos.
Usuários presentes no momento da migration recebem ATHLETE, USER, setup concluído e assinatura ATHLETE_FREE / ACTIVE / NONE, snapshot 0 / BRL.
A inicialização de setup é **one-shot da migration**, nunca parte de seed recorrente; não deve ser reaplicada como script sobre usuários OAuth novos.
Backfill de assinatura usa ON CONFLICT(userId) DO NOTHING. Prisma registra a migration aplicada, tornando deploy repetível.
Nenhum reset, exclusão ou reconstrução de dados históricos é necessário.

`Subscription.priceInCentsSnapshot` e `currencySnapshot` vêm do Plan dentro da transação de conclusão.
Alterar preço do catálogo depois não altera a assinatura anterior.

## Resolver central

`GetCommercialContext` retorna tipo, papel, setup, plano, assinatura resumida e entitlements efetivos.
Somente setup completo + plano ativo + assinatura elegível concede entitlements:

- ACTIVE: respeita início/fim de período quando presentes.
- TRIALING: exige trialEndsAt futuro; respeita trialStartedAt quando presente.
- PENDING, PAST_DUE, CANCELED e EXPIRED: não concedem.
- Trial expirado não exige mutação automática para EXPIRED.
- Nenhum bypass por ADMIN, COACH ou nome do plano.

`hasEntitlement` e `getEntitlementLimit` centralizam consultas.
O resolver é infraestrutura: nenhuma feature existente ganhou paywall nesta task.

## HTTP / OpenAPI

| Endpoint | autenticação | função |
|---|---|---|
| GET /commercial/plans?audience=ATHLETE ou COACH | público | apenas planos públicos/ativos da audiência solicitada |
| POST /commercial/signup-intents | público | valida accountType + planCode, retorna token opaco + expiração |
| POST /account/complete-signup | sessão | consome token e inicializa a conta autenticada |
| GET /account/commercial-context | sessão | contexto comercial resolvido |

Inputs estritos rejeitam userId, systemRole, provider, preço e status fornecidos pelo cliente.
ATHLETE só aceita ATHLETE_FREE gratuito; COACH só aceita plano COACH ativo/público. INTERNAL nunca participa do signup.
Erro de plano: INVALID_SIGNUP_PLAN. Demais erros: INVALID_SIGNUP_INTENT, SIGNUP_INTENT_EXPIRED, SIGNUP_INTENT_CONSUMED e ACCOUNT_ALREADY_INITIALIZED.
Respostas de intent/completion/context usam Cache-Control: no-store.
OpenAPI atualizado pelos exporters; frontend usa somente funções/tipos gerados pelo Orval.

## OAuth: decisão baseada nas versões instaladas

Auditoria local: Better Auth **1.5.3 no backend**, **1.4.18 no frontend**.
O backend instalado implementa `disableImplicitSignUp` e lê `requestSignUp` do fluxo social; o client instalado tipa requestSignUp, callbackURL e errorCallbackURL.
Referências oficiais: [OAuth](https://better-auth.com/docs/concepts/oauth) e [opções](https://better-auth.com/docs/reference/options).
Não foi adicionado campo customizado ao state do Google nem configuração inexistente de Better Auth.

Fluxo:

1. /auth oferece login; /auth/signup separa ATHLETE e COACH.
2. Server Action `beginSignup` chama o client Orval e salva o token opaco em cookie **HttpOnly, host-only, SameSite=Lax, Secure em produção, path=/**, com a expiração fornecida pela API.
3. JavaScript recebe apenas sucesso/falha; não recebe o token e não usa localStorage como autoridade.
4. Signup chama signIn.social com requestSignUp=true. Login usa false; Google no backend usa disableImplicitSignUp=true para não criar conta acidentalmente pelo login normal.
5. callbackURL aponta para /auth/complete na mesma origem. A biblioteca mantém sua validação de state/OAuth. Falhas voltam a /auth com mensagem segura, sem ecoar erro arbitrário.
6. Completion Server Action lê contexto autenticado e cookie. Conta completa segue normalmente e descarta intent antigo sem trocar accountType.
7. Conta incompleta sem intent retorna para escolha segura; intent expirado/inválido oferece reinício. Nenhuma assinatura é concedida por ausência de token.
8. Athlete concluído: ACTIVE/NONE, onboarding atual. Coach concluído: PENDING/NONE, tela simples /auth/welcome informa ausência de cobrança e permite ir aos próprios treinos.

Home e onboarding verificam setup, não entitlements. Login de usuário migrado não volta à seleção.
Dispositivos/callbacks em outra origem não compartilham cookie: reiniciar signup nessa origem. Não configurar cookie de domínio amplo para contornar isso.
Um usuário que fecha OAuth após criação, ou usa requestSignUp diretamente sem intent, permanece incompleto e pode retomar /auth/signup.

## Transação, concorrência e segurança

CompleteSignup obtém userId exclusivamente da sessão e bloqueia a linha de User (FOR UPDATE), depois SignupIntent (FOR UPDATE).
Revalida token/expiração/consumo e bloqueia Plan (FOR SHARE) para ler publicação/audiência/preço durante criação.
Criação da assinatura, update do accountType/setup e consumo do intent ocorrem na mesma transação.
Unique(userId) e locks impedem dupla assinatura; requests concorrentes/replays recebem erro seguro sem mudar identidade.
Conta já inicializada retorna ACCOUNT_ALREADY_INITIALIZED e não permite conversão ATHLETE↔COACH.
Frontend trata esse conflito de retry como conclusão já realizada, sem reenviar outro tipo de conta.
Role administrativa não é campo adicional editável do Better Auth nem input de rotas de cadastro.

## Operação e futuro billing

```sh
npm run admin:grant -- --email=user@example.com
npm run admin:revoke -- --email=user@example.com
```

Comandos explícitos para operador confiável, email validado, usuário obrigatório, sem criar usuário.
Só alteram systemRole. Não são endpoint, seed ou tarefa automática.
MANUAL representa liberação/trial por operação confiável futura, a ser oferecida na Task 4.2.
ASAAS é apenas valor de provider; IDs externos permitem adapter futuro. Nenhum SDK, env, HTTP client ou webhook Asaas foi adicionado.

## Deploy e validação segura

- `npm run build` agora faz generate + tsc **sem alterar banco**.
- Deploy deve executar explicitamente `npm run migrate:deploy` no ambiente correto, com backup/controle operacional, antes de subir o backend novo e publicar o frontend.
- `npm run migrate:test` usa prisma.test.config.ts, exige TEST_DATABASE_URL e recusa o mesmo host/porta/database da URL principal.
- `npm test` mantém a guarda NODE_ENV=test existente e nunca usa DATABASE_URL como fallback.
- `npm run openapi:export` exporta swagger para o repo frontend irmão e executa Orval.
- Não usar migrate reset em banco real.

Testes cobrem políticas de assinatura, schemas estritos, token/hash/TTL, expiração, replay, transações concorrentes, preço imutável,
ownership de conclusão, catálogo público, backfill de usuário antigo em schema isolado e preservação de edições no bootstrap.
Frontend cobre login/cadastro, escolha de audiência/plano, preço da API, cookie/Server Actions, erros, redirects e setup sem paywall.
OAuth Google real exige navegador/credenciais e não é simulado como prova de integração externa.

## Validação desta entrega

Migration aplicada com sucesso em PostgreSQL 17 descartável local, exclusivamente por TEST_DATABASE_URL. Nenhum banco real foi migrado.
Suíte backend: 418 testes. Frontend: 210 testes (incluindo setup guard).
Prisma validate/generate, TypeScript, ESLint e builds são gates obrigatórios; resultados finais constam no relatório da entrega.
Layout de cadastro: coluna mobile com largura máxima, cards grandes de conta e plano, preço em destaque, estados de carregamento/erro e botão de continuação.
Sem screenshots ou OAuth Google manual nesta execução; validação visual em dispositivos reais permanece recomendada.

## Inventário da implementação

Backend — criados:

- `prisma/migrations/20261007120000_identity_commercial_foundation/migration.sql`
- `prisma/commercial-bootstrap.sql`, `prisma.test.config.ts`
- `src/domain/commercial.ts`, `src/schemas/commercial.ts`, `src/routes/commercial.ts`
- `src/usecases/ListPublicPlans.ts`, `CreateSignupIntent.ts`, `CompleteSignup.ts`, `GetCommercialContext.ts`
- `src/scripts/admin-role.ts`, `src/scripts/commercial-bootstrap.ts`
- `tests/commercial/domain.spec.ts`, `tests/commercial/integration.spec.ts`

Backend — alterados:

- `prisma/schema.prisma`, `src/lib/auth.ts`, `src/index.ts`, `package.json`
- `src/scripts/export-swagger.ts`, `src/scripts/export_swagger.ts`

Frontend — criados:

- `app/auth/signup/page.tsx`, `app/auth/complete/page.tsx`, `app/auth/welcome/page.tsx`
- `app/auth/_actions.ts`
- `app/auth/_components/signup-form.tsx`, `app/auth/_components/signup-completion.tsx`
- `app/_lib/require-account-setup.ts`
- `tests/commercial-actions.test.ts`, `tests/commercial-ui.test.tsx`, `tests/account-setup.test.ts`

Frontend — alterados:

- `app/auth/page.tsx`, `app/auth/_components/sign-in-with-google.tsx`
- `app/page.tsx`, `app/onboarding/page.tsx`
- `swagger.json`, `app/_lib/api/fetch-generated/index.ts`
- `tests/planning.test.tsx` (fixture de usuário existente com setup completo)

Documentação nos dois repos: 02, 03, 04 e 07 atualizados; este documento 09 criado.
Fase 3 e seus arquivos de produto foram preservados.

## Resultado dos gates

- Backend: 32 arquivos / **418 testes aprovados**; 36 casos novos comerciais.
- Frontend: 21 arquivos / **210 testes aprovados**; 23 casos novos de identidade/cadastro.
- Frontend executado com `npm test -- --maxWorkers=2`: a execução inicial sem limite saturou os workers e causou timeouts; com dois workers todos passaram.
- Prisma validate, Prisma generate, TypeScript, ESLint e build: aprovados em ambos os projetos onde aplicáveis.
- Migration auditada e aplicada somente no banco descartável de teste. Backfill validado com fixture pré-existente.
- Bootstrap executado novamente no banco de teste sem sobrescrever catálogo.
- Banco da aplicação/produção: não alterado. Aplicação da migration em deploy segue operação explícita documentada acima.


## Integração local com origin/main — 09/10/2026

O resultado de gates acima se refere à conclusão da Task 4.1 antes desta integração.

- Backend atualizado por fast-forward até `ebe8ac91973373840c44a6860f9c7c524bb23f0b`.
- Frontend atualizado por fast-forward até `ab765d4f2e38bb8580459bac48b27713e8c91048`.
- Alterações locais de identidade/comercial e trabalho em andamento da Task 4.2 foram reaplicados. Não houve reset, descarte de arquivos locais, commit ou push desta integração.
- Stashes com arquivos não rastreados foram mantidos nos dois repositórios, além da referência `refs/backups/trainvy-before-origin-sync-20261009`.
- A migration `20261007120000_identity_commercial_foundation` foi comparada por hash Git e está idêntica ao backup anterior à sincronização.
- Preservadas as mudanças remotas de ordem sequencial dos treinos, gamificationTheme, cancelamento de sessão, tela de conclusão e atualizações visuais/navegação.
- Preservados cadastro ATHLETE/COACH, SignupIntent, completion OAuth, guardas de setup, modelo comercial, scripts operacionais e código administrativo local em andamento.
- OpenAPI e Orval foram regenerados a partir do backend combinado. Timestamps continuam com validação ISO estrita; o OpenAPI usa format date-time sem a regex longa que corrompia unions nullable no Orval 8.1. Snapshots de auditoria são objetos JSON anuláveis.
- Usados os .env atualizados pelo usuário, sem alteração ou exposição de valores. Confirmados bancos distintos por host/porta/nome. Migrations comerciais, auditoria e as duas novas migrations remotas foram aplicadas somente via migrate:test. Banco da aplicação não foi migrado por esta operação.
- Prisma validate/generate, TypeScript, ESLint e build passaram. Nenhuma funcionalidade remota foi removida para atender expectativas antigas dos testes.
- Backend: suíte completa executada com 418 casos, 416 aprovados e 2 falhas (paridade de streak Home/Stats e expectativa antiga de parcimônia no prompt de warmup). Os 3 novos testes unitários de timestamp também passaram em execução separada.
- Frontend: 210 casos, 169 aprovados e 41 falhas, além de 7 rejeições não tratadas por mock incompleto de loadInitialEvolutionExercises. Há expectativas de labels/layout anteriores à atualização remota; a suíte precisa ser revisada sem desfazer a nova UI.
- Container temporário trainvy-task42-test foi parado, não removido; seus dados permanecem recuperáveis. Os testes desta integração usaram TEST_DATABASE_URL, não esse container.

Esta sincronização não marca a Task 4.2 como concluída. Planos/auditoria na UI, cobertura administrativa e documentação final continuam pendentes. Nenhuma Task 4.3 foi iniciada.


### Ajustes e validação final da integração

Após a solicitação para ajustar e fazer o merge:

- O teste de streak passou a fixar o relógio na mesma data usada pelo cenário de Home. A divergência anterior era entre uma fixture de março e o relógio real de outubro; não foi necessário alterar a regra de streak.
- O teste do prompt valida as regras atuais de aquecimento principal, acessórios e séries válidas, preservando o prompt trazido pela main.
- Testes frontend foram adequados à navegação Treinos, rotinas sequenciais A/B/C, abas de planos/periodizações, gráficos interativos, descoberta de exercícios praticados e tela de resumo.
- Preservada a segurança do tracker: finalizar e cancelar ficam bloqueados enquanto séries estão sendo salvas. Cancelamento usa o client Orval existente no servidor, mantém confirmação explícita e só navega após sucesso confirmado.
- Labels de carga no gráfico preservam decimais (82,5 kg não vira 83 kg). Limpar a busca invalida respostas antigas em voo.
- Adicionados testes de confirmação/cancelamento, erro sem perder sessão, navegação para resumo, carga fracionária, descoberta sem N+1, filtros de catálogo, resposta antiga de busca e reordenação de treinos.
- Backend: npm test — **421 testes aprovados em 33 arquivos**.
- Frontend: npm test -- --maxWorkers=1 — **218 testes aprovados em 21 arquivos**. A execução com build concorrente provocou timeouts de 5 segundos; a validação final foi isolada, sem elevar timeouts ou remover testes.
- Prisma validate/generate, TypeScript, ESLint e ambos os builds passaram. OpenAPI/Orval combinado continua compatível com as APIs remotas e locais.
- Integração registrada em branch codex/integrate-commercial-20261009 e merge explícito na main local de cada repositório. Sem push. Backups anteriores mantidos; .env não incluído nos commits.

A fundação da Task 4.1 e o trabalho parcial da Task 4.2 permanecem presentes. Esta operação resolve a integração e suas falhas de testes, **não conclui a Task 4.2** nem inicia a Task 4.3. Banco da aplicação permanece sem alterações por esta operação.
