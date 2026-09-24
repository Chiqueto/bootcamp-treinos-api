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

## API Contract e Canais de Comunicação

- **APIs de domínio:** contratos definidos em Zod + OpenAPI na API Fastify e consumidos no frontend via cliente gerado pelo Orval (`app/_lib/api/fetch-generated/index.ts`).
- **Mutator centralizado:** `app/_lib/fetch.ts` atua como mutator do Orval, anexando cookies de sessão do Next.js Server Components.
- **IA e Streaming:** `/ai` é consumido diretamente via Vercel AI SDK através de `DefaultChatTransport` no componente de chat.
- **Autenticação:** `/api/auth/*` é consumido pelo Better Auth React Client (`app/_lib/auth-client.ts`).

### Arquitetura de Gateway First-Party (/backend) para Homologação

Para contornar as limitações de cookies entre subdomínios `*.vercel.app` (restrições da Public Suffix List), adota-se um rewrite first-party no frontend Next.js:

```text
Browser / Client
      │
      │ https://trainvy-web.vercel.app/backend/*
      ▼
Next.js Gateway (Rewrite transparente via next.config.ts)
      │
      │ https://trainvy-api.vercel.app/* (BACKEND_ORIGIN)
      ▼
Fastify API (Sem prefixo /backend nas rotas internas)
```

**Mapeamento de Rotas:**

| Canal | Browser URL | Next.js Rewrite | Fastify Route |
| :--- | :--- | :--- | :--- |
| **Orval (Domínio)** | `https://trainvy-web.vercel.app/backend/<endpoint>` | `${BACKEND_ORIGIN}/<endpoint>` | `/<endpoint>` (ex: `/home`, `/workout-plans`) |
| **AI SDK** | `https://trainvy-web.vercel.app/backend/ai` | `${BACKEND_ORIGIN}/ai` | `/ai` |
| **Better Auth Client** | `https://trainvy-web.vercel.app/backend/api/auth/*` | `${BACKEND_ORIGIN}/api/auth/*` | `/api/auth/*` (ex: `/api/auth/get-session`) |

## Auth

Atual: Better Auth + Google OAuth.

Status da Fase 0 (concluído):

- `.onrender.com` hardcoded removido;
- Domínio de cookies parametrizado via `AUTH_COOKIE_DOMAIN` (deixar vazio em homologação `*.vercel.app` para cookies host-only);
- `trustedOrigins` unificado e sincronizado com o CORS do Fastify (sem `*`, mantendo `WEB_APP_BASE_URL`);
- Separação explícita entre URL física da API (`API_BASE_URL`) e URL pública de autenticação (`AUTH_BASE_URL`);
- Remoção de inferência insegura de Host (`request.headers.host`) na rota `/api/auth/*`;
- Preservação correta de múltiplos cabeçalhos `Set-Cookie` através de `getSetCookie()`.

### Configuração do Google Cloud Console (OAuth 2.0) para Homologação

- **Authorized JavaScript origins:**
  - `https://trainvy-web.vercel.app`
  - `http://localhost:3000` (desenvolvimento local)
- **Authorized redirect URIs:**
  - `https://trainvy-web.vercel.app/backend/api/auth/callback/google`
  - `http://localhost:8080/api/auth/callback/google` (desenvolvimento local direto)
  - `http://localhost:3000/backend/api/auth/callback/google` (desenvolvimento local via proxy)

> [!IMPORTANT]
> A URL física da API (`https://trainvy-api.vercel.app`) **NÃO** deve ser usada como callback do navegador enquanto a estratégia de gateway proxy estiver ativa.

## Banco

PostgreSQL + Prisma permanecem.

Docker Compose continua útil localmente; produção usa Postgres gerenciado.

## Storage

PDFs ficam em object storage. Banco armazena chave/URL e metadados, não o binário bruto.

## Vetores

Primeira opção: PostgreSQL + pgvector, evitando nova infraestrutura sem necessidade.

## Deploy & Variáveis de Ambiente (Homologação Vercel)

- Frontend: Vercel (`trainvy-web.vercel.app`).
- API Fastify: Vercel (`trainvy-api.vercel.app`).

### Variáveis no Frontend (`bootcamp-treinos-frontend`)

| Variável | Valor para Homologação | Descrição |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_BASE_URL` | `https://trainvy-web.vercel.app` | URL canônica do frontend |
| `NEXT_PUBLIC_API_URL` | `https://trainvy-web.vercel.app/backend` | Gateway público para Orval, AI e Auth |
| `BACKEND_ORIGIN` | `https://trainvy-api.vercel.app` | **SERVER-ONLY**: Destino físico do rewrite |

### Variáveis no Backend (`bootcamp-treinos-api`)

| Variável | Valor para Homologação | Descrição |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://...` | Banco de produção/staging Neon |
| `BETTER_AUTH_SECRET` | `(secret 32+ chars)` | Chave do Better Auth |
| `API_BASE_URL` | `https://trainvy-api.vercel.app` | URL física da API (OpenAPI/Swagger) |
| `AUTH_BASE_URL` | `https://trainvy-web.vercel.app/backend/api/auth` | URL pública de autenticação e OAuth callbacks |
| `WEB_APP_BASE_URL` | `https://trainvy-web.vercel.app` | Frontend base para CORS e redirects |
| `AUTH_COOKIE_DOMAIN` | `(vazio)` | Host-only cookies para o frontend |
| `GOOGLE_CLIENT_ID` | `...` | Credenciais Google OAuth |
| `GOOGLE_CLIENT_SECRET` | `...` | Credenciais Google OAuth |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `...` | Gemini API Key |
| `NODE_ENV` | `production` | Ambiente de execução |

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
