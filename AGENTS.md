# FIT.AI — Contexto para Agentes de Código

Este arquivo é o ponto de entrada obrigatório para qualquer agente que trabalhe no FIT.AI.

## Leia antes de alterar código

1. `docs/00-PROJECT-CONTEXT.md`
2. `docs/01-PRODUCT-REQUIREMENTS.md`
3. `docs/02-ROLES-AND-PERMISSIONS.md`
4. `docs/03-PLANS-AND-FEATURES.md`
5. `docs/04-DOMAIN-AND-DATA-MODEL.md`
6. `docs/05-AI-AND-RAG.md`
7. `docs/06-ARCHITECTURE-AND-INTEGRATIONS.md`
8. `docs/07-ROADMAP-AND-GUARDRAILS.md`

## Estado atual x visão alvo

- **ATUAL**: confirmado no código existente.
- **ALVO**: planejado; não assuma que já foi implementado.

## Repositórios

- Frontend: `Chiqueto/bootcamp-treinos-frontend`
- Backend: `Chiqueto/bootcamp-treinos-api`

## Regras obrigatórias

- Preservar Next.js no frontend e Fastify no backend.
- Preservar o padrão da API `Route -> Use Case -> Prisma`.
- Contratos HTTP devem continuar em Zod/OpenAPI e ser consumidos via Orval.
- Toda operação multiusuário deve respeitar ownership ou vínculo Coach ↔ Atleta.
- IA não grava estruturas arbitrárias direto no banco; toda saída persistível passa por schema validado e use case.
- Metodologia de treino não deve ficar hardcoded no prompt quando puder vir das fontes selecionadas.
- Treinos gerados por IA devem permanecer editáveis.
- Não fazer reescrita geral do projeto sem necessidade real.
