# 03 — Planos e Funcionalidades

## Catálogo implementado — Task 4.1

Bootstrap insert-only: ATHLETE_FREE (0 BRL), COACH (3990 centavos), COACH_AI (7990 centavos)
e INTERNAL (privado, 0). Preço, publicação e limites são dados editáveis, nunca constantes de autorização.
COACH prepara 5 alunos e COACH_AI 15 via MANAGE_ATHLETES; ainda não há vínculo/contagem de alunos.
Escolher um plano Coach cria assinatura PENDING/NONE, sem liberar entitlements pagos.
Usuários existentes recebem ATHLETE_FREE/ACTIVE/NONE e mantêm recursos individuais atuais, inclusive IA.
Assinaturas guardam snapshot de preço/moeda. Bootstrap recorrente não sobrescreve edições administrativas.
As demais ofertas/recursos descritos abaixo são visão ALVO; AI INDIVIDUAL, biblioteca e RAG não foram implementados.
Veja [09 — Commercial Foundation](09-COMMERCIAL-FOUNDATION.md).

## Visão comercial de longo prazo

O plano gratuito deve ser útil de verdade. A receita vem principalmente de automação, IA e gestão de alunos.

Evitar anúncios tradicionais durante o treino no lançamento.

Os preços abaixo são **hipóteses de validação**, não regras definitivas.

## FREE — R$ 0

- criar treino manual;
- registrar séries;
- carga/reps/RIR;
- exercícios personalizados;
- templates básicos;
- histórico e estatísticas básicas;
- PWA;
- edição manual.

IA: trial pequeno, por exemplo um planejamento inicial ou poucos créditos.

## AI INDIVIDUAL — hipótese R$ 24,90/mês

Tudo do Free mais:

- Coach AI completo;
- biblioteca pessoal;
- upload de PDFs;
- RAG;
- fontes selecionáveis;
- planejamento e adaptação por IA;
- referências de fonte;
- cota mensal de créditos.

Não prometer IA ilimitada inicialmente.

## COACH — hipótese R$ 39,90/mês

- dashboard de treinador;
- até N alunos (hipótese inicial: 5);
- templates profissionais;
- atribuição de treino;
- acompanhamento de execução;
- feedback e histórico por aluno;
- recursos manuais completos.

IA não incluída ou apenas trial.

## COACH + AI — hipótese R$ 79,90/mês

Tudo do Coach mais:

- IA para criação/adaptação;
- biblioteca profissional;
- PDFs/metodologia do treinador;
- RAG aplicado aos atletas;
- cota compartilhada de IA;
- análises assistidas.

Hipótese inicial: até 15 alunos.

## INTERNAL

Plano não comercial para fundador/dev/QA. Todos os recursos, limites configuráveis ou ignorados.

## Matriz

| Funcionalidade | Free | AI Individual | Coach | Coach + AI | Internal |
|---|---:|---:|---:|---:|---:|
| Treino manual | ✅ | ✅ | ✅ | ✅ | ✅ |
| Registro por série | ✅ | ✅ | ✅ | ✅ | ✅ |
| Carga/reps/RIR | ✅ | ✅ | ✅ | ✅ | ✅ |
| Histórico básico | ✅ | ✅ | ✅ | ✅ | ✅ |
| Estatísticas avançadas | opcional | ✅ | ✅ | ✅ | ✅ |
| PWA | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chat IA | trial | ✅ | trial | ✅ | ✅ |
| Planejamento IA | trial | ✅ | ❌/trial | ✅ | ✅ |
| Biblioteca PDF pessoal | ❌/limitada | ✅ | ❌ | ✅ | ✅ |
| RAG | ❌ | ✅ | ❌ | ✅ | ✅ |
| Referências de fonte | ❌ | ✅ | ❌ | ✅ | ✅ |
| Gerenciar alunos | ❌ | ❌ | ✅ | ✅ | ✅ |
| Atribuir treino | ❌ | ❌ | ✅ | ✅ | ✅ |
| Biblioteca profissional | ❌ | ❌ | manual | ✅ | ✅ |
| IA com metodologia do coach | ❌ | ❌ | ❌ | ✅ | ✅ |

## Entitlements

Evitar `if (plan === ...)` espalhado.

Conceito recomendado:

```text
AI_CHAT
AI_PLAN_GENERATION
SOURCE_LIBRARY
COACH_DASHBOARD
MANAGE_ATHLETES
ADVANCED_STATS
```

Plano resolve para um conjunto de entitlements.

## Créditos de IA

Registrar consumo no backend. Créditos comerciais não precisam equivaler diretamente a tokens.

Exemplos apenas conceituais:

```text
ajustar sessão        1
criar sessão          1
gerar semana          3
gerar bloco            8
análise avançada      2
```

O atleta vinculado a um Coach não deve precisar comprar plano individual para executar o treino recebido.
