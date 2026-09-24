# 06 — Arquitetura e Integrações

## Arquitetura recomendada

```text
Next.js / PWA
      │
      │ OpenAPI / Orval
      ▼
Fastify API
   ├── PostgreSQL
   ├── Storage de PDFs
   ├── Vector/RAG
   └── Provedores de IA
```

Manter os dois repositórios separados.

## Frontend

Responsabilidades:

- UI;
- navegação;
- formulários;
- execução do treino;
- histórico;
- chat;
- PWA.

Não concentrar regra de autorização/comercial apenas no cliente.

## Backend

Responsabilidades:

- auth/autorização;
- domínio;
- persistência;
- IA;
- RAG;
- metering;
- billing futuro.

Preservar:

```text
Route -> Use Case -> Prisma
```

## API Contract

Zod + OpenAPI continuam sendo contrato. Frontend regenera Orval após mudanças relevantes.

## Auth

Atual: Better Auth + Google OAuth.

Status da Fase 0 (concluído):

- `.onrender.com` hardcoded removido;
- domínio parametrizado via `AUTH_COOKIE_DOMAIN` (host-only por padrão);
- `trustedOrigins` unificado e sincronizado com o CORS do Fastify;
- suporte a protocolo HTTPS atrás de proxies reversos (`x-forwarded-proto`).

## Banco

PostgreSQL + Prisma permanecem.

Docker Compose continua útil localmente; produção usa Postgres gerenciado.

## Storage

PDFs ficam em object storage. Banco armazena chave/URL e metadados, não o binário bruto.

## Vetores

Primeira opção: PostgreSQL + pgvector, evitando nova infraestrutura sem necessidade.

## Deploy

- Frontend: Vercel.
- API Fastify: Vercel é compatível, sujeito a testes de streaming, upload, cookies e processamento.
- Jobs longos podem migrar para fila no futuro.

## PWA — ALVO

```text
manifest
ícones
display standalone
metadata
service worker quando necessário
```

Primeiro objetivo é instalabilidade; offline completo pode vir depois.

## Observabilidade

Antes da monetização:

- logs estruturados;
- tracking de erros;
- AI usage;
- billing events;
- auditoria de ações do Coach.
