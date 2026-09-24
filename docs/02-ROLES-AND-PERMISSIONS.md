# 02 — Papéis e Permissões

## Princípio

Papéis comerciais não substituem ownership.

A autorização deve responder:

> Este usuário é dono deste dado ou possui vínculo explícito que permita acessá-lo?

## ATHLETE

Pode:

- editar próprio perfil;
- criar exercícios e planos próprios;
- executar treino;
- ver histórico;
- usar biblioteca/IA conforme plano;
- aceitar ou revogar vínculo com treinador.

## COACH

Também pode treinar como atleta.

Permissões adicionais:

- convidar/vincular atletas;
- criar e atribuir planos;
- acompanhar sessões;
- ver feedback;
- manter templates e biblioteca profissional;
- usar IA nos alunos conforme assinatura.

Não pode acessar atleta sem vínculo.

## ADMIN

Papel interno para suporte, operação e métricas administrativas. Ações críticas devem ser auditáveis.

## INTERNAL

Entitlement especial para fundador/dev/QA. Pode liberar recursos e ignorar cotas; não é plano comercial público.

## Relação Coach ↔ Atleta

Modelo alvo:

```text
CoachAthlete
- id
- coachId
- athleteId
- status: PENDING | ACTIVE | REVOKED
- createdAt
- acceptedAt
- revokedAt
```

## Ownership de plano

Um plano destinado a um atleta pertence ao atleta, mesmo se criado pelo coach.

Campos conceituais:

```text
athleteId
createdByUserId
```

## Matriz

| Ação | Atleta | Coach vinculado | Outro Coach | Admin |
|---|---:|---:|---:|---:|
| Ver próprio perfil | ✅ | — | — | política interna |
| Criar plano próprio | ✅ | — | — | — |
| Criar plano para atleta | — | ✅ | ❌ | — |
| Registrar série | ✅ | normalmente ❌ | ❌ | — |
| Ver histórico | ✅ próprio | ✅ vinculado | ❌ | política interna |
| Ver feedback | ✅ próprio | ✅ vinculado | ❌ | política interna |
| Biblioteca pessoal | conforme plano | — | — | — |
| Biblioteca coach | — | conforme plano | ❌ | — |
| Usar IA | conforme plano | conforme plano | conforme plano | interno |

## Regra para queries

Nunca assumir que ID + rota autenticada é autorização suficiente.

Preferir filtros com `userId`/`athleteId` ou validação explícita do vínculo.

## Testes obrigatórios

```text
A não lê plano de B
A não edita sessão de B
Coach A não lê atleta de Coach B
Coach revogado perde acesso
Documento privado não entra no retrieval alheio
IA não recebe chunks sem permissão
```
