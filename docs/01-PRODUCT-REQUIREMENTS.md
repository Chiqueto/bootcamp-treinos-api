# 01 — Requisitos do Produto

## Objetivo

Permitir que atletas e treinadores criem, executem, registrem e acompanhem treinos, com IA opcional e baseada em fontes selecionadas.

# Requisitos funcionais

## RF-AUTH — Autenticação e isolamento

- Login com Google. **ATUAL**
- Toda rota privada valida sessão. **ATUAL**
- Nenhum usuário acessa dados de outro sem vínculo explícito. **ALVO obrigatório**

## RF-PROFILE — Perfil esportivo

Campos alvo:

```text
objetivos
nível de experiência
esporte
dias disponíveis
equipamentos
preferências
restrições declaradas
peso opcional
altura opcional
idade
gordura corporal opcional
```

Percentual de gordura não deve ser obrigatório.

## RF-EXERCISE — Exercícios

- catálogo reutilizável;
- exercícios personalizados;
- metadados opcionais de equipamento, categoria e grupo muscular;
- suporte a exercícios unilaterais e modalidades além de musculação.

## RF-PLAN — Planos e templates

- criar plano manual;
- criar templates;
- gerar plano com IA;
- editar qualquer plano gerado;
- manter histórico de planos;
- ativação de plano deve afetar somente o atleta dono.

## RF-PRESCRIPTION — Prescrição

Suportar, conforme o exercício:

```text
séries
reps fixas/faixa
RIR alvo
RPE alvo opcional
carga alvo opcional
%1RM opcional
descanso
tempo/cadência
duração de isometria
notas
ordem
superset/bloco opcional
```

## RF-SESSION — Execução

- iniciar sessão baseada em treino prescrito;
- repetir o mesmo treino em datas diferentes;
- registrar séries individualmente;
- adicionar/remover séries;
- registro rápido mobile;
- notas por série e por sessão.

`WorkoutSet` deve suportar:

```text
ordem
carga
reps
RIR
RPE opcional
duração opcional
concluída
notas
```

Objetivo UX:

```text
carga -> reps -> RIR -> salvar
```

## RF-RECOVERY — Feedback

Campos opcionais:

```text
dor
fadiga
sono
sensação pós-treino
resposta 24h
notas
```

Usar como contexto, não como diagnóstico.

## RF-HISTORY — Histórico e evolução

Mostrar:

- últimas execuções;
- carga/reps/RIR;
- volume;
- PRs;
- frequência;
- duração;
- conclusão;
- evolução por exercício.

## RF-LIBRARY — Fontes

- upload de PDF inicialmente;
- ownership por usuário/coach;
- seleção das fontes usadas em cada geração;
- processamento e indexação.

## RF-AI — Inteligência artificial

- manter chat;
- consultar perfil, planos, histórico, séries, feedback e fontes;
- gerar estruturas tipadas;
- validar toda persistência por Zod;
- gerar sessão, semana e plano;
- exibir referência de fonte quando houver;
- manter resultado editável;
- não se apresentar como diagnóstico médico.

## RF-COACH — Treinador

- vínculo explícito Coach ↔ Atleta;
- criar/atribuir treinos;
- acompanhar execução e feedback;
- templates profissionais;
- biblioteca própria;
- IA aplicada aos alunos conforme assinatura.

## RF-BILLING — Assinatura

- backend é fonte de verdade para disponibilidade;
- medir uso de IA;
- suportar créditos/cotas;
- perfil INTERNAL pode ignorar limites comerciais.

# Requisitos não funcionais

- **Mobile-first**.
- **PWA instalável**.
- **Multi-tenant seguro**.
- Tela de treino não depende de IA para funcionar.
- Produto continua útil sem IA.
- Gerações importantes devem ser auditáveis.
- Evolução incremental, sem reescrita desnecessária.
