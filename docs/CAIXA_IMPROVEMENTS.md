# Melhorias e roadmap para o módulo de Caixa

Este documento consolida as melhorias propostas para o módulo de `caixa` (back-end + front-end), prioridades e diretrizes de implementação. O objetivo é transformar o controle de caixa atual (single global session, reconciliação limitada) em um fluxo de sessões por turno/terminal com auditoria, validações e UX adequadas.

- **Resumo do estado atual**
  - Existe uma entidade `CaixaStatus` (status_caixa) que guarda `aberto` e timestamps; já foram adicionados campos parciais (`saldo_inicial`, `saldo_esperado`, `saldo_contado`, `variacao`, `terminal_id`, `observacoes_fechamento`).
  - `CaixaMovimentacao` existe e já possui vínculo opcional com `CaixaStatus` (FK `caixa_status_id`).
  - `SaleOrder` e `SalePayment` têm campos opcionais `caixa_status_id` para vinculação.
  - Endpoints principais: `/api/caixa/status`, `/abrir`, `/fechar`, `/movimentacoes`, `/sessoes`, `/resumo-dia`.
  - Frontend: `CaixaService` mantém um BehaviorSubject com status; `DashboardComponent` expõe botões para abrir/fechar; há lógica para abrir/fechar automática baseada em HH:MM.

- **Principais lacunas e riscos**
  - Falta de sessões/turnos fortemente acopladas às vendas e movimentações (hoje é opcional). Dificulta conciliação por turno.
  - Permissão/validação: operações de venda/movimentação podem ser executadas com caixa fechado (atualmente bloqueado no backend apenas para usuários não-admin em pontos de venda e movimentações — mas deve ser reforçado).
  - Abertura sem saldo inicial e fechamento sem contagem detalhada por método (dinheiro/cartão/pix) limita auditoria.
  - Concorrência (aberturas/fechamentos simultâneos) sem proteção explícita.
  - Regras de horários automáticos frágeis (comparação exata de string HH:MM no front).

- **Melhorias propostas (priorizadas)**
  1. Vincular vendas e movimentações à sessão (`caixa_status_id`) — Alta.
     - Garantir preenchimento automático ao criar `SaleOrder`, `SalePayment` e `CaixaMovimentacao` usando `findTopByOrderByIdDesc()` ativo.
  2. Exigir `saldo_inicial` na abertura e `saldo_contado` no fechamento; persistir `saldo_esperado` e `variacao` — Alta.
     - Backend: `POST /api/caixa/abrir` recebe `{ saldo_inicial, terminal_id? }` e retorna sessão criada; `POST /api/caixa/fechar` recebe `{ saldo_contado, observacoes, contagem_por_metodo? }`.
  3. Bloquear criação de vendas/movimentações quando caixa fechado, ou registrar como pendente e exigir aprovação — Alta.
  4. Motivos/justificativas e workflow de aprovação para retiradas acima de limite — Média.
  5. Sessões por terminal/caixa e múltiplos operadores (transferência de sessão) — Média.
  6. Proteção contra concorrência (versão/lock/constraint) — Alta técnica.
  7. Melhorar automação de horários (backend job ou janela de tolerância) — Média.
  8. Endpoints de relatório de reconciliação por sessão e export CSV/PDF — Média.
  9. Tratar estornos/devoluções vinculadas à sessão — Média.
  10. Roles & segurança: garantir que apenas perfis autorizados possam abrir/fechar/configurar horários — Alta.

- **Mudanças de esquema / migrações recomendadas**
  - Já existe um changelog (`db.changelog-master.yaml`) com alterações adicionando colunas em `status_caixa`, `caixa_movimentacoes`, `venda_cabecalho` e `venda_pagamentos`. Confirmar e aplicar migration em produção.
  - Se ainda não houver, adicionar constraints/índices para FK e considerar coluna `versao` (@Version) para `status_caixa`.

- **Back-end: endpoints e validações**
  - `POST /api/caixa/abrir` — aceitar `saldo_inicial` obrigatoriamente; definir `terminal_id` opcional; retornar JSON com o novo `status` (id, aberto, dataAbertura, saldoInicial).
  - `POST /api/caixa/fechar` — aceitar `saldo_contado` obrigatório + `contagem_por_metodo` opcional; calcular e armazenar `saldo_esperado` e `variacao`; retornar relatório simplificado.
  - Ao criar `SaleOrder`/`SalePayment`/`CaixaMovimentacao`, validar `caixa` aberto para usuários sem role `admin` (ou retornar flag `pendente_caixa_fechado`).
  - Adicionar auditoria de quem abriu/fechou e proteção transacional durante abrir/fechar.

- **Front-end: UX e integridade**
  - Ao abrir, mostrar modal solicitando `saldo_inicial` e (opcional) `terminal_id` e permitir foto/anexo opcional.
  - Ao fechar, modal com contagem por método, visualização de `saldo_esperado` e formulário de justificativa quando variação > threshold.
  - Bloquear operações do Ponto de Venda para operadores quando caixa fechado (já implementado parcialmente); mostrar aviso claro e workflow de vendas pendentes para admin.
  - Substituir checagem exata HH:MM por janela ou delegar automação ao backend.

- **Plano de implementação inicial (curto prazo)**
  1. Confirmar migrations existentes e aplicar (já há `009-add-caixa-fields-and-fks`).
  2. Ajustar endpoints para retornarem o `status` atualizado ao abrir/fechar (melhora UX). Criar testes de integração simples.
  3. Garantir que `CheckoutController` e `CheckoutController.addPaymentsToOrder` sempre associem `caixa_status` quando caixa estiver aberto (já há código que faz isso). Reforçar validação de caixa fechado → impedir venda para não-admin.
  4. Frontend: modal de abrir/fechar com validação (já adicionados no `dashboard.html`) e exibir status detalhado após ação.

- **Riscos e observações operacionais**
  - Alguns cenários como turnos atravessando meia-noite precisam de regra de negócio clara (venda atribuída ao dia ou sessão anterior?).
  - Concorrência em ambientes multi-terminal requer locks e/ou sessão por terminal.

- **Próximos passos que posso executar agora**
  - Criar documentação (feito — este arquivo).
  - Ajustar backend para que `POST /api/caixa/abrir` retorne o `CaixaStatus` completo e `POST /api/caixa/fechar` retorne relatório resumido. (Posso aplicar essa alteração no controller e testes.)
  - Reforçar validação no `CheckoutController` para bloquear checkout quando caixa fechado (já existe verificação; podemos tornar mais restritiva e adicionar testes).
  - Atualizar frontend para exibir modal (já adicionado) e recarregar status após abrir/fechar (já chamado pelo `CaixaService`).

Se você concorda, vou aplicar as mudanças iniciais no backend para: (A) retornar o objeto `status` completo em `/api/caixa/abrir`, (B) fazer `/api/caixa/fechar` retornar um resumo com `saldoEsperado`, `saldoContado`, `variacao` e (C) garantir que `CheckoutController` retorna 403 para usuários sem role `admin` quando caixa fechado (reforçar). Depois ajusto testes e o frontend se necessário.

## Melhorias sugeridas para o módulo de Caixa

Este documento descreve as melhorias propostas para tornar a funcionalidade de caixa mais completa e alinhada a práticas de gestão operacional e contábil.

1) Vincular vendas e movimentações a uma sessão (turno)
   - Adicionar `caixa_status_id` (FK) em `caixa_movimentacoes`, `venda_cabecalho` (SaleOrder) e `venda_pagamentos` (SalePayment).
   - Ao abrir caixa, o backend cria/atualiza `CaixaStatus` e as operações subsequentes associam-se automaticamente à sessão ativa.

2) Saldo inicial e fechamento com contagem física
   - Campos: `saldo_inicial`, `saldo_esperado`, `saldo_contado`, `variacao`, `observacoes_fechamento` em `CaixaStatus`.
   - Endpoint `/caixa/abrir` aceita `saldo_inicial` e `terminal_id` (opcional).
   - Endpoint `/caixa/fechar` registra `saldo_contado` e calcula `variacao`.

3) Permissões operacionais
   - Operadores podem abrir/fechar e registrar vendas; apenas administradores (`pode_controlar_caixa=true`) podem registrar movimentações quando caixa fechado.
   - As ações devem ser validadas no backend.

4) Auditoria e justificativas
   - Retiradas (`retirada`) exigem `motivo`; retiradas acima de thresholds exigem aprovação.
   - Registrar `aprovado_por` quando aplicável.

5) Conciliação por método de pagamento
   - No fechamento gerar relatório com breakdown por `dinheiro`, `cartao_credito`, `cartao_debito`, `pix`.

6) Concorrência e consistência
   - Proteger operações de `abrir`/`fechar` com transações/locks apropriados.

7) UX recomendada
   - Modal de abertura com `saldo_inicial`; modal de fechamento com contagem por método e justificativa para variação.

8) Endpoints/relatórios adicionais
   - `GET /caixa/session/{id}/reconciliation` para relatório completo por sessão.

Prioridade de implementação: vincular sessões, exigir saldo inicial e fechar com contagem (alta). Em seguida, permissões e auditoria (média), depois relatórios e melhorias (baixa).
