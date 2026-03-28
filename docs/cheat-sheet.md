# CRM Telegram — Cheat Sheet

## Iniciar

```sh
claude --channels plugin:telegram@claude-plugins-official
```

---

## Pipeline

| O que dizer | O que acontece |
|---|---|
| "pipeline" / "o que está acontecendo" | Mostra todos os deals ativos por estágio |
| "me fala do deal Acme" | Detalhes + histórico de atividades |

**Formato de resposta:**
```
*PROPOSAL* (1)
  • Acme Deal / João Silva ($25,000) — due Apr 1
```

---

## Criar Deal

```
"Adiciona um deal para a Acme com o João Silva"
"Novo lead: TechCorp, contato Ana Lima, ana@tech.com"
```

Claude vai perguntar campos faltantes um por vez. Campos obrigatórios: **título** e **nome do contato**.

---

## Registrar Atividade (texto livre)

```
"Tive uma call ótima com a Acme, querem proposta até sexta"
"Reunião com João hoje, ele pediu desconto de 10%"
"Mandei e-mail de follow-up para a TechCorp"
```

Claude identifica o deal, extrai tipo/resumo/próxima ação e registra automaticamente.

---

## Mover Estágio

```
"Avança o deal da Acme"
"Move a TechCorp para o próximo estágio"
```

Ordem obrigatória: `lead → discovery → validation → scoping → proposal → negotiation → closed_won/lost`

---

## Fechar Deal

```
"Fechamos a Acme! 🎉"           → outcome: won
"Perdemos a TechCorp"           → outcome: lost (Claude vai pedir motivo)
```

---

## Atualizar Deal

```
"Atualiza o valor da Acme para 30k"
"Próxima ação da TechCorp: enviar contrato na segunda"
"Adiciona nota na Acme: cliente pediu referências"
```

---

## Atualizar Contato

```
"O João mudou de empresa, agora é joao@newco.com"
"Atualiza o telefone da Ana: +351 912 345 678"
"LinkedIn do Pedro: linkedin.com/in/pedro"
```

---

## Snooze

```
"Snooze na Acme"                → +3 dias
"Lembra de mim da TechCorp em 7 dias"
```

---

## E-mail

### Rascunho
```
"Faz um rascunho de follow-up para o João da Acme"
"Draft de proposta para a TechCorp"
```

Claude busca o contexto do deal e escreve o e-mail. Sempre pergunta antes de enviar:
> "Envia, edita ou descarta?"

### Enviar
```
"Envia"  /  "Ok, manda"
```

### Editar antes de enviar
```
"Muda o tom para mais formal"
"Adiciona um parágrafo sobre o prazo"
```

---

## Relatório Semanal

```
"Relatório semanal"
"Como foi a semana?"
"Relatório"
```

Claude mostra:
- Deals em risco (sem contato além do threshold por estágio) → cria lembrete automático para cada um
- Resumo da semana: deals ganhos/perdidos, novos deals, atividades, pipeline ativo

**Thresholds de risco por estágio:**

| Stage | Em risco após |
|---|---|
| `lead` / `discovery` / `validation` | 14 dias |
| `scoping` | 10 dias |
| `proposal` | 7 dias |
| `negotiation` | 5 dias |

```
"Como foi o mês?"
"Evoluiu o pipeline?"
"Compara as semanas"
```

Claude busca as últimas 4 semanas e narra tendências: crescimento do pipeline, variação de deals em risco, ritmo de atividades.

---

## Agenda do Dia (Briefing)

```
"Agenda de hoje"
"Briefing"
"Quais são minhas reuniões hoje?"
```

Claude puxa os eventos do Google Calendar, identifica quais têm match com deals do CRM (por e-mail ou nome), e gera para cada um:

- Resumo do deal (estágio, valor, última atividade)
- Pauta sugerida
- Próximos passos pós-reunião

---

## Estágios de Referência

| Stage | Significado |
|---|---|
| `lead` | Primeiro contato / qualificação |
| `discovery` | Entender necessidade |
| `validation` | Confirmar fit |
| `scoping` | Definir escopo |
| `proposal` | Proposta enviada |
| `negotiation` | Negociação em curso |
| `closed_won` | Fechado ✅ |
| `closed_lost` | Perdido ❌ |

---

## Tipos de Atividade

`call` · `meeting` · `email` · `note` · `proposal_sent`

---

## Dicas

- **Sem comandos específicos** — fale naturalmente. Claude interpreta intenção.
- **Deal ambíguo** — Claude vai perguntar qual deal você quis dizer.
- **Múltiplos campos** — diga tudo de uma vez: "Acma, João Silva, joao@acme.com, $20k, proposta enviada".
- **Confirmar antes de enviar e-mail** — Claude nunca envia sem confirmação explícita.
- **OAuth Google** — na primeira vez que enviar e-mail ou pedir briefing, cole o código de autorização no terminal onde o Claude está rodando.
