package com.example.backendspring.caixa;

import com.example.backendspring.user.UserRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
// import com.example.backendspring.utils.DateTimeUtils; // unused
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.Map;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/caixa")
@RequiredArgsConstructor
public class CaixaController {

    private static final Logger log = LoggerFactory.getLogger(CaixaController.class);

    private final CaixaStatusRepository caixaStatusRepository;
    private final CaixaMovimentacaoRepository movimentacaoRepository;
    private final UserRepository userRepository;
    // legacy saleRepository removed from active use
    private final com.example.backendspring.sale.SaleOrderRepository saleOrderRepository;
    @PersistenceContext
    private EntityManager em;

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_DATA_MOVIMENTO = "data_movimento";
    private static final String KEY_VALOR = "valor";
    private static final String KEY_DESCRICAO = "descricao";
    private static final String KEY_USUARIO = "usuario";
    private static final String KEY_METODO_PAGAMENTO = "metodo_pagamento";
    private static final String MSG_NAO_AUTENTICADO = "Usuário não autenticado";
    private static final String TIPO_ENTRADA = "entrada";
    private static final String TIPO_RETIRADA = "retirada";
    private static final String TIPO_VENDA = "venda";
    private static final String KEY_ITEMS = "items";
    private static final String KEY_TOTAL = "total";
    private static final String KEY_HAS_NEXT = "hasNext";
    private static final String KEY_PAGE = "page";
    private static final String KEY_SIZE = "size";
    private static final String KEY_SUM_ENTRADAS = "sum_entradas";
    private static final String KEY_SUM_RETIRADAS = "sum_retiradas";
    private static final String KEY_SUM_VENDAS = "sum_vendas";
    private static final String LABEL_VENDA_MULTI_PREFIX = "Venda (multi) - total ";
    private static final String LABEL_DEVOLVIDO_SUFFIX = " (devolvido)";

    // Additional constants for SonarQube compliance
    private static final String KEY_ABERTO = "aberto";
    private static final String KEY_ABERTO_POR = "aberto_por";
    private static final String KEY_FECHADO_POR = "fechado_por";
    private static final String KEY_DATA_ABERTURA = "data_abertura";
    private static final String KEY_DATA_FECHAMENTO = "data_fechamento";
    private static final String KEY_CAIXA_STATUS_ID = "caixa_status_id";
    private static final String KEY_PAGAMENTO_VALOR = "pagamento_valor";
    private static final String KEY_TOTAL_VENDA = "total_venda";
    private static final String KEY_PRODUTO_NOME = "produto_nome";
    private static final String KEY_SALDO_INICIAL = "saldo_inicial";
    private static final String KEY_SALDO_ESPERADO = "saldo_esperado";
    private static final String KEY_SALDO_CONTADO = "saldo_contado";
    private static final String KEY_VARIACAO = "variacao";
    private static final String KEY_TERMINAL_ID = "terminal_id";
    private static final String KEY_CUMULATIVE_VARIACAO_BEFORE = "cumulative_variacao_before";
    private static final String KEY_CUMULATIVE_VARIACAO_ALL = "cumulative_variacao_all";
    private static final String KEY_DAY_VARIACAO_TOTAL = "day_variacao_total";
    private static final String KEY_DAY_SALDO_INICIAL_TOTAL = "day_saldo_inicial_total";
    private static final String KEY_SUM_ENTRADAS_AUTOMATICAS = "sum_entradas_automaticas";
    private static final String KEY_SUM_ENTRADAS_MANUAIS = "sum_entradas_manuais";

    private static final String VALOR_DINHEIRO = "dinheiro";
    private static final String VALOR_ADMIN = "admin";
    private static final String LOCALE_PT_BR = "pt-BR";
    private static final String TIMEZONE_SAO_PAULO = "America/Sao_Paulo";
    private static final String VALOR_CARTAO_CREDITO = "cartao_credito";
    private static final String LABEL_CREDITO = "Crédito";
    private static final String VALOR_CARTAO_DEBITO = "cartao_debito";
    private static final String LABEL_DEBITO = "Débito";
    private static final String VALOR_PIX = "pix";
    private static final String LABEL_PIX = "PIX";
    private static final String MSG_FALHA_LISTAR_DIA = "Falha ao listar por dia";
    private static final String MSG_FALHA_LISTAR_MES = "Falha ao listar por mês";
    private static final String MSG_FALHA_DIAGNOSTICAR = "Falha ao diagnosticar divergência";
    private static final String LABEL_VENDA_TOTAL = "Venda - total ";

    private static final String MSG_PERMISSAO_NEGADA = "Permissão negada";
    private static final String MSG_SESSAO_NAO_ENCONTRADA = "Sessão não encontrada";

    @GetMapping("/status")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<Map<String, Object>> status() {
        try {
            var opt = caixaStatusRepository.findTopByOrderByIdDesc();
            if (opt.isEmpty()) {
                return ResponseEntity.ok(Map.of("id", 1, KEY_ABERTO, false));
            }
            var cs = opt.get();
            var abertoPor = cs.getAbertoPor();
            var fechadoPor = cs.getFechadoPor();
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("id", cs.getId());
            body.put(KEY_ABERTO, Boolean.TRUE.equals(cs.getAberto()));
            body.put("horario_abertura_obrigatorio", cs.getHorarioAberturaObrigatorio());
            body.put("horario_fechamento_obrigatorio", cs.getHorarioFechamentoObrigatorio());
            body.put(KEY_ABERTO_POR, abertoPor != null ? abertoPor.getId() : null);
            body.put(KEY_FECHADO_POR, fechadoPor != null ? fechadoPor.getId() : null);
            body.put(KEY_DATA_ABERTURA, cs.getDataAbertura());
            body.put(KEY_DATA_FECHAMENTO, cs.getDataFechamento());
            body.put("criado_em", cs.getCriadoEm());
            body.put("atualizado_em", cs.getAtualizadoEm());
            body.put("aberto_por_username", abertoPor != null ? abertoPor.getUsername() : null);
            body.put("fechado_por_username", fechadoPor != null ? fechadoPor.getUsername() : null);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            log.warn("/api/caixa/status: exception, returning fallback", e);
            return ResponseEntity.status(200).body(Map.of("id", 1, KEY_ABERTO, false));
        }
    }

    private static String labelMetodoPagamento(String metodo) {
        if (metodo == null)
            return "";
        return switch (metodo) {
            case VALOR_DINHEIRO -> "Dinheiro";
            case VALOR_CARTAO_CREDITO -> LABEL_CREDITO;
            case VALOR_CARTAO_DEBITO -> LABEL_DEBITO;
            case VALOR_PIX -> LABEL_PIX;
            default -> metodo;
        };
    }

    @GetMapping("/resumo-dia")
    public ResponseEntity<Map<String, Object>> resumoDia(@RequestParam(value = "data", required = false) String data) {
        try {
            var dia = data == null ? java.time.LocalDate.now() : java.time.LocalDate.parse(data);
            Double saldoMov = movimentacaoRepository.saldoDoDia(dia);
            java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put("data", dia.toString());
            body.put("saldo_movimentacoes", saldoMov != null ? saldoMov : 0.0);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR,
                    "Falha ao obter resumo do dia. Se acabou de atualizar o sistema, reinicie o backend para aplicar alterações de banco."));
        }
    }

    @GetMapping("/movimentacoes")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    @SuppressWarnings("java:S6863") // Mantemos 200 OK em caso de erro para não quebrar o frontend
    public ResponseEntity<java.util.Map<String, Object>> listarMovimentacoes(
            @RequestParam(value = "data", required = false) String data,
            @RequestParam(value = "periodo_inicio", required = false) String periodoInicio,
            @RequestParam(value = "periodo_fim", required = false) String periodoFim,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "all", required = false) Boolean all,
            @RequestParam(value = "aggs", required = false) Boolean aggs,
            @RequestParam(value = "tipo", required = false) String tipo,
            @RequestParam(value = "metodo_pagamento", required = false) String metodoPagamento,
            @RequestParam(value = "hora_inicio", required = false) String horaInicio,
            @RequestParam(value = "hora_fim", required = false) String horaFim,
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "size", required = false) Integer size) {
        try {
            MovimentacoesRequest request = MovimentacoesRequest.builder()
                    .data(data).periodoInicio(periodoInicio).periodoFim(periodoFim)
                    .from(from).to(to).all(all).aggs(aggs).tipo(tipo)
                    .metodoPagamento(metodoPagamento).horaInicio(horaInicio)
                    .horaFim(horaFim).page(page).size(size).build();
            MovimentacoesQueryParams params = buildQueryParams(request);

            java.util.List<java.util.Map<String, Object>> lista = fetchMovimentacoesList(params);
            var filtrada = applyFilters(lista, params.tipo, params.metodoPagamento, params.tIni, params.tFim);

            return buildMovimentacoesResponse(params, filtrada);
        } catch (Exception e) {
            return buildErrorResponse();
        }
    }

    private static class MovimentacoesQueryParams {
        java.time.LocalDate dia;
        java.time.LocalDate inicio;
        java.time.LocalDate fim;
        java.time.LocalTime tIni;
        java.time.LocalTime tFim;
        java.time.OffsetDateTime fromTs;
        java.time.OffsetDateTime toTs;
        Boolean all;
        Boolean aggs;
        String tipo;
        String metodoPagamento;
        String periodoInicio;
        String periodoFim;
        Integer page;
        Integer size;
    }

    private static class MovimentacoesRequest {
        final String data;
        final String periodoInicio;
        final String periodoFim;
        final String from;
        final String to;
        final Boolean all;
        final Boolean aggs;
        final String tipo;
        final String metodoPagamento;
        final String horaInicio;
        final String horaFim;
        final Integer page;
        final Integer size;

        private MovimentacoesRequest(Builder builder) {
            this.data = builder.data;
            this.periodoInicio = builder.periodoInicio;
            this.periodoFim = builder.periodoFim;
            this.from = builder.from;
            this.to = builder.to;
            this.all = builder.all;
            this.aggs = builder.aggs;
            this.tipo = builder.tipo;
            this.metodoPagamento = builder.metodoPagamento;
            this.horaInicio = builder.horaInicio;
            this.horaFim = builder.horaFim;
            this.page = builder.page;
            this.size = builder.size;
        }

        static Builder builder() {
            return new Builder();
        }

        static class Builder {
            String data;
            String periodoInicio;
            String periodoFim;
            String from;
            String to;
            Boolean all;
            Boolean aggs;
            String tipo;
            String metodoPagamento;
            String horaInicio;
            String horaFim;
            Integer page;
            Integer size;

            Builder data(String data) {
                this.data = data;
                return this;
            }

            Builder periodoInicio(String periodoInicio) {
                this.periodoInicio = periodoInicio;
                return this;
            }

            Builder periodoFim(String periodoFim) {
                this.periodoFim = periodoFim;
                return this;
            }

            Builder from(String from) {
                this.from = from;
                return this;
            }

            Builder to(String to) {
                this.to = to;
                return this;
            }

            Builder all(Boolean all) {
                this.all = all;
                return this;
            }

            Builder aggs(Boolean aggs) {
                this.aggs = aggs;
                return this;
            }

            Builder tipo(String tipo) {
                this.tipo = tipo;
                return this;
            }

            Builder metodoPagamento(String metodoPagamento) {
                this.metodoPagamento = metodoPagamento;
                return this;
            }

            Builder horaInicio(String horaInicio) {
                this.horaInicio = horaInicio;
                return this;
            }

            Builder horaFim(String horaFim) {
                this.horaFim = horaFim;
                return this;
            }

            Builder page(Integer page) {
                this.page = page;
                return this;
            }

            Builder size(Integer size) {
                this.size = size;
                return this;
            }

            MovimentacoesRequest build() {
                return new MovimentacoesRequest(this);
            }
        }
    }

    private MovimentacoesQueryParams buildQueryParams(MovimentacoesRequest request) {
        return new MovimentacoesQueryParamsBuilder()
                .withBasicParams(request.data, request.periodoInicio, request.periodoFim, request.from, request.to)
                .withFilterParams(request.all, request.aggs, request.tipo, request.metodoPagamento)
                .withTimeParams(request.horaInicio, request.horaFim)
                .withPaginationParams(request.page, request.size)
                .build();
    }

    private class MovimentacoesQueryParamsBuilder {
        private String data;
        private String periodoInicio;
        private String periodoFim;
        private String from;
        private String to;
        private String horaInicio;
        private String horaFim;
        private String tipo;
        private String metodoPagamento;
        private Boolean all;
        private Boolean aggs;
        private Integer page;
        private Integer size;

        MovimentacoesQueryParamsBuilder withBasicParams(String data, String periodoInicio, String periodoFim,
                String from, String to) {
            this.data = data;
            this.periodoInicio = periodoInicio;
            this.periodoFim = periodoFim;
            this.from = from;
            this.to = to;
            return this;
        }

        MovimentacoesQueryParamsBuilder withFilterParams(Boolean all, Boolean aggs, String tipo,
                String metodoPagamento) {
            this.all = all;
            this.aggs = aggs;
            this.tipo = tipo;
            this.metodoPagamento = metodoPagamento;
            return this;
        }

        MovimentacoesQueryParamsBuilder withTimeParams(String horaInicio, String horaFim) {
            this.horaInicio = horaInicio;
            this.horaFim = horaFim;
            return this;
        }

        MovimentacoesQueryParamsBuilder withPaginationParams(Integer page, Integer size) {
            this.page = page;
            this.size = size;
            return this;
        }

        MovimentacoesQueryParams build() {
            MovimentacoesQueryParams params = new MovimentacoesQueryParams();
            params.all = this.all;
            params.aggs = this.aggs;
            params.tipo = this.tipo;
            params.metodoPagamento = this.metodoPagamento;
            params.page = this.page;
            params.size = this.size;
            params.periodoInicio = this.periodoInicio;
            params.periodoFim = this.periodoFim;

            // Parse date parameters
            if (this.data != null && !this.data.isBlank()) {
                params.dia = java.time.LocalDate.parse(this.data);
            } else if (this.periodoInicio != null && this.periodoFim != null) {
                params.inicio = java.time.LocalDate.parse(this.periodoInicio);
                params.fim = java.time.LocalDate.parse(this.periodoFim);
            }

            // Parse time parameters
            params.tIni = safeParseLocalTime(this.horaInicio);
            params.tFim = safeParseLocalTime(this.horaFim);

            // Calculate timestamp bounds
            TimestampBounds bounds = calculateTimestampBounds(params.dia, params.inicio, params.fim,
                    params.tIni, params.tFim, this.from, this.to);
            params.fromTs = bounds.fromTs;
            params.toTs = bounds.toTs;

            logRepositoryCountsForDebug(this.all, params.dia, params.inicio, params.fim, this.from, this.to);

            return params;
        }

        private void logRepositoryCountsForDebug(Boolean all, java.time.LocalDate dia,
                java.time.LocalDate inicio, java.time.LocalDate fim,
                String from, String to) {
            if (!Boolean.TRUE.equals(all)) {
                return;
            }

            try {
                logRepositoryCounts(dia, inicio, fim, from, to);
            } catch (Exception ex) {
                log.warn("listarMovimentacoes[ALL]: debug counts failed", ex);
            }
        }

        private void logRepositoryCounts(java.time.LocalDate dia, java.time.LocalDate inicio, java.time.LocalDate fim,
                String from, String to) {
            if (dia != null) {
                logDailyCounts(dia);
            } else if (inicio != null && fim != null) {
                logPeriodCounts(inicio, fim);
            } else if (from != null || to != null) {
                log.info("listarMovimentacoes[ALL]: raw from/to params provided from={} to={}", from, to);
            }
        }

        private void logDailyCounts(java.time.LocalDate dia) {
            var movsDia = movimentacaoRepository.findByDia(dia);
            var ordersDia = saleOrderRepository.findByDia(dia);
            log.info("listarMovimentacoes[ALL]: dia={} movs={} orders={}", dia,
                    getCollectionSize(movsDia), getCollectionSize(ordersDia));
        }

        private void logPeriodCounts(java.time.LocalDate inicio, java.time.LocalDate fim) {
            var movsPer = movimentacaoRepository.findByPeriodo(inicio, fim);
            var ordersPer = saleOrderRepository.findByPeriodo(inicio, fim);
            log.info("listarMovimentacoes[ALL]: periodo {}..{} movs={} orders={}", inicio, fim,
                    getCollectionSize(movsPer), getCollectionSize(ordersPer));
        }

        private int getCollectionSize(Object collection) {
            if (collection instanceof java.util.Collection) {
                return ((java.util.Collection<?>) collection).size();
            }
            return -1;
        }
    }

    private java.util.List<java.util.Map<String, Object>> fetchMovimentacoesList(MovimentacoesQueryParams params) {
        java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

        if (params.fromTs != null || params.toTs != null) {
            lista.addAll(fetchMovimentacoesByTimestamp(params.fromTs, params.toTs));
            lista.addAll(fetchSaleOrdersByTimestamp(params.fromTs, params.toTs));
            lista = deduplicateMovimentacoes(lista);
        } else {
            lista.addAll(buildManualMovRows(params.dia, params.inicio, params.fim));
            lista.addAll(buildSaleOrderRows(params.dia, params.inicio, params.fim));
        }

        return sortByDataMovimentoDesc(lista);
    }

    private java.util.List<java.util.Map<String, Object>> fetchMovimentacoesByTimestamp(
            java.time.OffsetDateTime fromTs, java.time.OffsetDateTime toTs) {
        java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

        safeExecute(() -> {
            var movs = movimentacaoRepository.findByPeriodoTimestamps(fromTs, toTs);
            for (var m : movs) {
                java.util.Map<String, Object> row = buildMovimentacaoRow(m);
                lista.add(row);
            }
        }, () -> lista.addAll(buildManualMovRows(null, null, null)));

        return lista;
    }

    private java.util.Map<String, Object> buildMovimentacaoRow(CaixaMovimentacao m) {
        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("id", m.getId());
        row.put(KEY_CAIXA_STATUS_ID, m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
        row.put("tipo", m.getTipo());
        row.put(KEY_VALOR, m.getValor());
        row.put(KEY_DESCRICAO, m.getDescricao());
        String usuarioNome = extractUsuarioNome(m);
        row.put(KEY_USUARIO, usuarioNome);
        row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
        return row;
    }

    private java.util.List<java.util.Map<String, Object>> fetchSaleOrdersByTimestamp(
            java.time.OffsetDateTime fromTs, java.time.OffsetDateTime toTs) {
        java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

        safeExecute(() -> {
            var orders = saleOrderRepository.findByPeriodoTimestampsRaw(fromTs, toTs);
            for (var vo : orders) {
                lista.addAll(buildSaleOrderPaymentRows(vo));
            }
        }, () -> lista.addAll(buildSaleOrderRows(null, null, null)));

        return lista;
    }

    private java.util.List<java.util.Map<String, Object>> buildSaleOrderPaymentRows(
            com.example.backendspring.sale.SaleOrder vo) {
        java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();

        for (var pg : vo.getPagamentos()) {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", vo.getId());
            row.put("tipo", TIPO_VENDA);
            row.put(KEY_VALOR, pg.getValor());
            row.put(KEY_PAGAMENTO_VALOR, pg.getValor());
            row.put(KEY_TOTAL_VENDA, vo.getTotalFinal());

            addSaleDescriptionToRow(row, vo, pg);
            addSaleDetailsToRow(row, vo, pg);

            rows.add(row);
        }

        return rows;
    }

    private void addSaleDescriptionToRow(java.util.Map<String, Object> row,
            com.example.backendspring.sale.SaleOrder vo, com.example.backendspring.sale.SalePayment pg) {
        var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag(LOCALE_PT_BR));
        String totalFmt = nf.format(vo.getTotalFinal());
        boolean multi = vo.getPagamentos().size() > 1;

        if (multi) {
            String breakdown = buildPaymentBreakdown(vo, nf);
            row.put(KEY_DESCRICAO, LABEL_VENDA_MULTI_PREFIX + totalFmt + " - " + breakdown);
        } else {
            String single = buildSinglePaymentDescription(pg, totalFmt, nf);
            row.put(KEY_DESCRICAO, single);
        }
    }

    private String buildPaymentBreakdown(com.example.backendspring.sale.SaleOrder vo,
            java.text.NumberFormat nf) {
        return vo.getPagamentos().stream()
                .map(p -> {
                    StringBuilder labelBuilder = new StringBuilder();
                    labelBuilder.append(labelMetodoPagamento(p.getMetodo()))
                            .append(" ")
                            .append(nf.format(p.getValor()));
                    if (p.getValor() != null && p.getValor() < 0)
                        labelBuilder.append(LABEL_DEVOLVIDO_SUFFIX);
                    return labelBuilder.toString();
                })
                .collect(java.util.stream.Collectors.joining(" | "));
    }

    private String buildSinglePaymentDescription(com.example.backendspring.sale.SalePayment pg,
            String totalFmt, java.text.NumberFormat nf) {
        String single = LABEL_VENDA_TOTAL + totalFmt + " ("
                + labelMetodoPagamento(pg.getMetodo()) + " " + nf.format(pg.getValor()) + ")";
        if (pg.getValor() != null && pg.getValor() < 0)
            single += LABEL_DEVOLVIDO_SUFFIX;
        return single;
    }

    private void addSaleDetailsToRow(java.util.Map<String, Object> row,
            com.example.backendspring.sale.SaleOrder vo, com.example.backendspring.sale.SalePayment pg) {
        row.put(KEY_PRODUTO_NOME,
                vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
        row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
        row.put(KEY_USUARIO, vo.getOperador() != null ? vo.getOperador().getUsername() : null);
        row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
        row.put(KEY_CAIXA_STATUS_ID,
                vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
    }

    private java.util.List<java.util.Map<String, Object>> deduplicateMovimentacoes(
            java.util.List<java.util.Map<String, Object>> lista) {
        java.util.Map<Object, java.util.Map<String, Object>> byId = new java.util.LinkedHashMap<>();

        for (var m : lista) {
            Object idObj = buildDeduplicationKey(m);
            byId.computeIfAbsent(idObj, k -> m);
        }

        return new java.util.ArrayList<>(byId.values());
    }

    private Object buildDeduplicationKey(java.util.Map<String, Object> m) {
        Object idObj = m.get("id");
        if (idObj == null) {
            idObj = (m.get(KEY_DATA_MOVIMENTO) == null ? java.util.UUID.randomUUID().toString()
                    : m.get(KEY_DATA_MOVIMENTO).toString() + "|" + m.get(KEY_DESCRICAO));
        } else {
            if (TIPO_VENDA.equals(m.get("tipo"))) {
                return buildVendaDeduplicationKey(idObj, m);
            }
        }
        return idObj;
    }

    private Object buildVendaDeduplicationKey(Object baseIdObj, java.util.Map<String, Object> m) {
        try {
            Object metodo = m.get(KEY_METODO_PAGAMENTO);
            Object pgVal = m.get(KEY_PAGAMENTO_VALOR);
            return baseIdObj.toString() + "|" + (metodo == null ? "" : metodo.toString()) + "|"
                    + (pgVal == null ? "" : pgVal.toString());
        } catch (Exception e) {
            // Silently ignore errors constructing composite ID for deduplication
            return baseIdObj;
        }
    }

    // =================
    // MÉTODOS AUXILIARES PARA FECHAMENTO DE CAIXA (Brain Method Refactoring)
    // =================

    private ResponseEntity<Map<String, Object>> validateUserPermissionsForClosing(Long userId) {
        if (userId == null) {
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        }

        var closer = userRepository.findById(userId).orElse(null);
        if (closer == null || (!Boolean.TRUE.equals(closer.getPodeControlarCaixa())
                && (closer.getRole() == null || !closer.getRole().equals(VALOR_ADMIN)))) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada para fechar o caixa"));
        }

        return null; // Validation passed
    }

    private CaixaStatus findCashSessionToClose(FecharRequest body) {
        if (body != null && body.getSessionId() != null) {
            CaixaStatus status = caixaStatusRepository.findByIdForUpdate(body.getSessionId()).orElse(null);
            if (status == null) {
                throw new IllegalArgumentException(MSG_SESSAO_NAO_ENCONTRADA);
            }
            if (!Boolean.TRUE.equals(status.getAberto())) {
                throw new IllegalStateException("Sessão já está fechada");
            }
            return status;
        } else {
            CaixaStatus status = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc().orElse(null);
            if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
                throw new IllegalStateException("Caixa já está fechado");
            }
            return status;
        }
    }

    private void calculateAndSetExpectedBalance(CaixaStatus session) {
        try {
            double esperado = calculateExpectedForSession(session);
            session.setSaldoEsperado(esperado);
        } catch (Exception e) {
            log.warn("Error calculating expected balance for session {}: {}", session.getId(), e.getMessage());
        }
    }

    private ResponseEntity<Map<String, Object>> validateClosingRequest(FecharRequest body) {
        if (body == null || body.getSaldoContado() == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_contado é obrigatório ao fechar o caixa"));
        }
        return null; // Validation passed
    }

    private void setSessionClosingData(CaixaStatus session, FecharRequest body, Long userId, OffsetDateTime agora) {
        session.setSaldoContado(body.getSaldoContado());
        if (session.getSaldoEsperado() != null) {
            session.setVariacao(session.getSaldoContado() - session.getSaldoEsperado());
        }
        if (body.getObservacoes() != null) {
            session.setObservacoesFechamento(body.getObservacoes());
        }

        session.setAberto(false);
        session.setFechadoPor(userRepository.findById(userId).orElse(null));
        session.setDataFechamento(agora);
        session.setAtualizadoEm(agora);
    }

    private void calculateAndSetCumulativeValues(CaixaStatus currentSession) {
        try {
            var allSessions = caixaStatusRepository.findAll().stream()
                    .filter(s -> s.getId() != null)
                    .sorted(java.util.Comparator.comparing(CaixaStatus::getId))
                    .toList();

            CumulativeCalculationResult result = calculateCumulativeValues(allSessions, currentSession);
            currentSession.setVariacaoAcumulada(result.runningTotal);
            currentSession.setDeficitNaoRepostoAcumulada(result.deficit);
        } catch (Exception e) {
            log.warn("Error calculating cumulative values for session {}: {}", currentSession.getId(), e.getMessage());
        }
    }

    private CumulativeCalculationResult calculateCumulativeValues(java.util.List<CaixaStatus> allSessions,
            CaixaStatus currentSession) {
        CumulativeAccumulator accumulator = new CumulativeAccumulator();

        for (var session : allSessions) {
            if (session.getId().equals(currentSession.getId())) {
                processCurrentSessionValues(currentSession, accumulator);
                break;
            } else {
                processOtherSessionValues(session, accumulator);
            }
        }

        double deficit = Math.max(0.0, accumulator.totalNeg - accumulator.totalPos);
        return new CumulativeCalculationResult(accumulator.running, deficit);
    }

    private void processCurrentSessionValues(CaixaStatus currentSession, CumulativeAccumulator accumulator) {
        double variacao = currentSession.getVariacao() == null ? 0.0 : currentSession.getVariacao();
        accumulator.running += variacao;

        if (currentSession.getVariacao() != null) {
            updatePositiveNegativeTotals(currentSession.getVariacao(), accumulator);
        }
    }

    private void processOtherSessionValues(CaixaStatus session, CumulativeAccumulator accumulator) {
        double variacao = session.getVariacao() == null ? 0.0 : session.getVariacao();
        accumulator.running += variacao;

        if (session.getVariacao() != null) {
            updatePositiveNegativeTotals(session.getVariacao(), accumulator);
        }
    }

    private void updatePositiveNegativeTotals(Double variacao, CumulativeAccumulator accumulator) {
        if (variacao > 0) {
            accumulator.totalPos += variacao;
        } else {
            accumulator.totalNeg += -variacao;
        }
    }

    // Helper class for cumulative calculations
    private static class CumulativeAccumulator {
        double running = 0.0;
        double totalPos = 0.0;
        double totalNeg = 0.0;
    }

    private Map<String, Object> buildClosingResponse(CaixaStatus session) {
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", session.getId());
        resp.put(KEY_ABERTO, Boolean.TRUE.equals(session.getAberto()));
        resp.put(KEY_DATA_FECHAMENTO, session.getDataFechamento());
        resp.put(KEY_FECHADO_POR, session.getFechadoPor() != null ? session.getFechadoPor().getId() : null);
        resp.put("fechado_por_username",
                session.getFechadoPor() != null ? session.getFechadoPor().getUsername() : null);
        resp.put(KEY_SALDO_ESPERADO, session.getSaldoEsperado());
        resp.put(KEY_SALDO_CONTADO, session.getSaldoContado());
        resp.put(KEY_VARIACAO, session.getVariacao());
        resp.put("observacoes", session.getObservacoesFechamento());
        return resp;
    }

    // Helper class for cumulative calculation results
    private static class CumulativeCalculationResult {
        final double runningTotal;
        final double deficit;

        CumulativeCalculationResult(double runningTotal, double deficit) {
            this.runningTotal = runningTotal;
            this.deficit = deficit;
        }
    }

    // =================
    // FIM DOS MÉTODOS AUXILIARES PARA FECHAMENTO
    // =================

    // =================
    // MÉTODOS AUXILIARES PARA DIAGNÓSTICO DE DIVERGÊNCIA
    // =================

    private java.util.function.Function<java.util.Map<String, Object>, String> createDedupeKeyFunction() {
        return m -> {
            try {
                Object idObj = m.get("id");
                if (idObj == null) {
                    return buildKeyFromDataAndDescription(m);
                } else {
                    return buildKeyFromId(idObj, m);
                }
            } catch (Exception e) {
                return java.util.UUID.randomUUID().toString();
            }
        };
    }

    private String buildKeyFromDataAndDescription(java.util.Map<String, Object> m) {
        Object dm = m.get(KEY_DATA_MOVIMENTO);
        Object desc = m.get(KEY_DESCRICAO);
        String dataStr = dm == null ? java.util.UUID.randomUUID().toString() : dm.toString();
        String descStr = desc == null ? "" : desc.toString();
        return dataStr + "|" + descStr;
    }

    private String buildKeyFromId(Object idObj, java.util.Map<String, Object> m) {
        if (TIPO_VENDA.equals(m.get("tipo"))) {
            return buildVendaCompositeKey(idObj, m);
        }
        return idObj.toString();
    }

    private String buildVendaCompositeKey(Object idObj, java.util.Map<String, Object> m) {
        Object metodo = m.get(KEY_METODO_PAGAMENTO);
        Object pgVal = m.get(KEY_PAGAMENTO_VALOR);
        String metodoPart = metodo == null ? "" : metodo.toString();
        String valorPart = pgVal == null ? "" : pgVal.toString();
        return idObj.toString() + "|" + metodoPart + "|" + valorPart;
    }

    private java.util.Map<String, java.util.Map<String, Object>> buildItemMap(
            java.util.List<java.util.Map<String, Object>> items,
            java.util.function.Function<java.util.Map<String, Object>, String> keyFn) {
        java.util.Map<String, java.util.Map<String, Object>> map = new java.util.LinkedHashMap<>();
        for (var item : items) {
            map.put(keyFn.apply(item), item);
        }
        return map;
    }

    private java.util.List<java.util.Map<String, Object>> findItemsNotInOtherMap(
            java.util.Map<String, java.util.Map<String, Object>> sourceMap,
            java.util.Map<String, java.util.Map<String, Object>> targetMap) {
        java.util.List<java.util.Map<String, Object>> notInTarget = new java.util.ArrayList<>();
        for (var entry : sourceMap.entrySet()) {
            if (!targetMap.containsKey(entry.getKey())) {
                notInTarget.add(entry.getValue());
            }
        }
        return notInTarget;
    }

    private TimestampBounds calculateTimestampBounds(String periodoInicio, String periodoFim) {
        java.time.LocalDate inicio = java.time.LocalDate.parse(periodoInicio);
        java.time.LocalDate fim = java.time.LocalDate.parse(periodoFim);
        java.time.ZoneId sp = java.time.ZoneId.of(TIMEZONE_SAO_PAULO);
        var zdtFrom = java.time.ZonedDateTime.of(inicio, java.time.LocalTime.MIDNIGHT, sp);
        var zdtTo = java.time.ZonedDateTime.of(fim.plusDays(1), java.time.LocalTime.MIDNIGHT, sp).minusNanos(1);
        return new TimestampBounds(zdtFrom.toOffsetDateTime(), zdtTo.toOffsetDateTime());
    }

    // =================
    // FIM DOS MÉTODOS AUXILIARES PARA DIAGNÓSTICO
    // =================

    private ResponseEntity<java.util.Map<String, Object>> buildMovimentacoesResponse(
            MovimentacoesQueryParams params, java.util.List<java.util.Map<String, Object>> filtrada) {

        if (Boolean.TRUE.equals(params.aggs)) {
            return buildAggregationsResponse(params, filtrada);
        }

        if (Boolean.TRUE.equals(params.all)) {
            return buildAllItemsResponse(filtrada);
        }

        return buildPaginatedResponse(params, filtrada);
    }

    private ResponseEntity<java.util.Map<String, Object>> buildAggregationsResponse(
            MovimentacoesQueryParams params, java.util.List<java.util.Map<String, Object>> filtrada) {

        MovimentacoesSums sums = calculateMovimentacoesSums(filtrada);

        java.util.Map<String, Object> aggsMap = new java.util.LinkedHashMap<>();
        aggsMap.put(KEY_SUM_ENTRADAS, sums.sumEntradas);
        aggsMap.put(KEY_SUM_RETIRADAS, sums.sumRetiradas);
        aggsMap.put(KEY_SUM_VENDAS, sums.sumVendas);
        aggsMap.put("sum_vendas_net", sums.sumVendasNet);
        aggsMap.put(KEY_SUM_ENTRADAS_AUTOMATICAS, sums.sumEntradasAuto);
        aggsMap.put(KEY_SUM_ENTRADAS_MANUAIS, sums.sumEntradasManuais);
        aggsMap.put(KEY_TOTAL, filtrada.size());

        logDiagnosticAggs(params, sums, filtrada.size());

        return ResponseEntity.ok(aggsMap);
    }

    private static class MovimentacoesSums {
        double sumEntradas;
        double sumRetiradas;
        double sumVendas;
        double sumVendasNet;
        double sumEntradasAuto;
        double sumEntradasManuais;
    }

    private MovimentacoesSums calculateMovimentacoesSums(java.util.List<java.util.Map<String, Object>> filtrada) {
        MovimentacoesSums sums = new MovimentacoesSums();

        sums.sumEntradas = calculateSumByType(filtrada, TIPO_ENTRADA);
        sums.sumRetiradas = calculateSumByType(filtrada, TIPO_RETIRADA);

        java.util.Set<String> entradaCashKeys = buildEntradaCashKeys(filtrada);
        sums.sumVendas = calculateVendasSum(filtrada, entradaCashKeys);
        sums.sumVendasNet = calculateVendasNetSum(filtrada);
        sums.sumEntradasAuto = calculateEntradasAutoSum(filtrada);
        sums.sumEntradasManuais = Math.max(0.0, sums.sumEntradas - sums.sumEntradasAuto);

        return sums;
    }

    private double calculateSumByType(java.util.List<java.util.Map<String, Object>> filtrada, String tipo) {
        return filtrada.stream()
                .filter(m -> tipo.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum();
    }

    private java.util.Set<String> buildEntradaCashKeys(java.util.List<java.util.Map<String, Object>> filtrada) {
        return filtrada.stream()
                .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .filter(m -> m.get(KEY_CAIXA_STATUS_ID) != null && m.get(KEY_VALOR) != null)
                .map(m -> {
                    String caixaId = m.get(KEY_CAIXA_STATUS_ID).toString();
                    double valor = ((Number) m.get(KEY_VALOR)).doubleValue();
                    String key = caixaId + "|" + String.format("%.2f", valor);
                    log.debug("DEDUP: Criando chave entrada em dinheiro - caixa_id: {}, valor: {}, key: {}", caixaId,
                            valor, key);
                    return key;
                })
                .collect(java.util.stream.Collectors.toSet());
    }

    private double calculateVendasSum(java.util.List<java.util.Map<String, Object>> filtrada,
            java.util.Set<String> entradaCashKeys) {
        return filtrada.stream()
                .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                .mapToDouble(m -> calculateVendaValue(m, entradaCashKeys))
                .sum();
    }

    private double calculateVendaValue(java.util.Map<String, Object> m, java.util.Set<String> entradaCashKeys) {
        try {
            Object metodo = m.get(KEY_METODO_PAGAMENTO);
            Object caixaId = m.get(KEY_CAIXA_STATUS_ID);
            double val = ((Number) m.get(KEY_VALOR)).doubleValue();

            // Para vendas em dinheiro, verificar se já existe uma entrada correspondente no
            // caixa
            if (VALOR_DINHEIRO.equals(metodo) && caixaId != null) {
                String key = caixaId.toString() + "|" + String.format("%.2f", val);
                if (entradaCashKeys.contains(key)) {
                    log.debug("DEDUP: Excluindo venda em dinheiro duplicada - caixa_id: {}, valor: {}", caixaId, val);
                    return 0.0; // skip duplicate - dinheiro já contado como entrada
                }
            }
            return val;
        } catch (Exception e) {
            log.warn("Erro ao calcular valor da venda: {}", e.getMessage());
            return 0.0;
        }
    }

    private double calculateVendasNetSum(java.util.List<java.util.Map<String, Object>> filtrada) {
        return safeCalculate(() -> filtrada.stream()
                .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                .mapToDouble(m -> {
                    Object adj = m.get("adjusted_total");
                    if (adj instanceof Number number) {
                        return number.doubleValue();
                    }
                    return ((Number) m.get(KEY_VALOR)).doubleValue();
                })
                .sum(), 0.0);
    }

    private double calculateEntradasAutoSum(java.util.List<java.util.Map<String, Object>> filtrada) {
        return safeCalculate(() -> filtrada.stream()
                .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .filter(this::isEntradaAuto)
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum(), 0.0);
    }

    private boolean isEntradaAuto(java.util.Map<String, Object> m) {
        try {
            Object d = m.get(KEY_DESCRICAO);
            if (d == null)
                return false;
            String s = d.toString().toLowerCase();
            return s.contains(TIPO_VENDA);
        } catch (Exception e) {
            return false;
        }
    }

    private void logDiagnosticAggs(MovimentacoesQueryParams params, MovimentacoesSums sums, int totalItems) {
        log.debug(
                "DIAG_CAIXA_AGGS: periodoInicio={} periodoFim={} tipo={} metodo_pagamento={} -> sums: entradas={} retiradas={} vendas={} totalItems={}",
                params.inicio, params.fim, params.tipo, params.metodoPagamento,
                sums.sumEntradas, sums.sumRetiradas, sums.sumVendas, totalItems);

        // Log adicional para monitorar deduplicação
        log.info(
                "CAIXA_AGGREGATES_RESULT: sumEntradas={}, sumRetiradas={}, sumVendas={}, sumVendasNet={}, totalItems={}",
                sums.sumEntradas, sums.sumRetiradas, sums.sumVendas, sums.sumVendasNet, totalItems);
    }

    private ResponseEntity<java.util.Map<String, Object>> buildAllItemsResponse(
            java.util.List<java.util.Map<String, Object>> filtrada) {

        MovimentacoesSums sums = calculateMovimentacoesSums(filtrada);

        java.util.Map<String, Object> bodyAll = new java.util.LinkedHashMap<>();
        bodyAll.put(KEY_ITEMS, filtrada);
        bodyAll.put(KEY_TOTAL, filtrada.size());
        bodyAll.put(KEY_HAS_NEXT, false);
        bodyAll.put(KEY_PAGE, 1);
        bodyAll.put(KEY_SIZE, filtrada.size());
        bodyAll.put(KEY_SUM_ENTRADAS, sums.sumEntradas);
        bodyAll.put(KEY_SUM_RETIRADAS, sums.sumRetiradas);
        bodyAll.put(KEY_SUM_VENDAS, sums.sumVendas);
        bodyAll.put(KEY_SUM_ENTRADAS_AUTOMATICAS, sums.sumEntradasAuto);
        bodyAll.put(KEY_SUM_ENTRADAS_MANUAIS, sums.sumEntradasManuais);

        return ResponseEntity.ok(bodyAll);
    }

    private ResponseEntity<java.util.Map<String, Object>> buildPaginatedResponse(
            MovimentacoesQueryParams params, java.util.List<java.util.Map<String, Object>> filtrada) {

        MovimentacoesSums sums = calculateMovimentacoesSums(filtrada);

        int pageNum = (params.page == null || params.page < 1) ? 1 : params.page;
        int pageSize = (params.size == null || params.size < 1) ? 20 : params.size;
        int fromIndex = (pageNum - 1) * pageSize;

        if (fromIndex >= filtrada.size()) {
            return buildEmptyPageResponse(pageNum, pageSize, filtrada.size(), sums);
        }

        int toIndex = Math.min(fromIndex + pageSize, filtrada.size());
        var paged = filtrada.subList(fromIndex, toIndex);
        boolean hasNext = toIndex < filtrada.size();

        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put(KEY_ITEMS, paged);
        body.put(KEY_TOTAL, filtrada.size());
        body.put(KEY_HAS_NEXT, hasNext);
        body.put(KEY_PAGE, pageNum);
        body.put(KEY_SIZE, pageSize);
        body.put(KEY_SUM_ENTRADAS, sums.sumEntradas);
        body.put(KEY_SUM_RETIRADAS, sums.sumRetiradas);
        body.put(KEY_SUM_VENDAS, sums.sumVendas);

        return ResponseEntity.ok(body);
    }

    private ResponseEntity<java.util.Map<String, Object>> buildEmptyPageResponse(
            int pageNum, int pageSize, int totalSize, MovimentacoesSums sums) {
        return ResponseEntity.ok(java.util.Map.of(
                KEY_ITEMS, java.util.List.of(),
                KEY_TOTAL, totalSize,
                KEY_HAS_NEXT, false,
                KEY_PAGE, pageNum,
                KEY_SIZE, pageSize,
                KEY_SUM_ENTRADAS, sums.sumEntradas,
                KEY_SUM_RETIRADAS, sums.sumRetiradas,
                KEY_SUM_VENDAS, sums.sumVendas));
    }

    private ResponseEntity<java.util.Map<String, Object>> buildErrorResponse() {
        return ResponseEntity.ok(java.util.Map.of(
                KEY_ITEMS, java.util.List.of(),
                KEY_TOTAL, 0,
                KEY_HAS_NEXT, false,
                KEY_PAGE, 1,
                KEY_SIZE, 20,
                KEY_SUM_ENTRADAS, 0.0,
                KEY_SUM_RETIRADAS, 0.0,
                KEY_SUM_VENDAS, 0.0));
    }

    // Helper methods for safe execution
    private void safeExecute(Runnable operation, Runnable fallback) {
        try {
            operation.run();
        } catch (Exception e) {
            log.warn("Operation failed, using fallback", e);
            fallback.run();
        }
    }

    private double safeCalculate(java.util.function.DoubleSupplier calculation, double defaultValue) {
        try {
            return calculation.getAsDouble();
        } catch (Exception e) {
            log.debug("Calculation failed, using default value", e);
            return defaultValue;
        }
    }

    /**
     * Endpoint helper: retorna todas movimentações + vendas para uma data (no
     * timezone America/Sao_Paulo).
     * Query param: data=YYYY-MM-DD
     */
    @GetMapping("/movimentacoes/dia")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> listarMovimentacoesDia(
            @RequestParam(value = "data") String data) {
        try {
            java.time.LocalDate dia = java.time.LocalDate.parse(data);
            TimestampRange range = calculateDayTimestampRange(dia);

            java.util.List<java.util.Map<String, Object>> lista = fetchDayMovimentacoes(range);
            // Para o modo "dia", apenas ordenar por data sem deduplicação
            lista = sortByDataMovimentoDesc(lista);

            return buildDayMovimentacoesResponse(lista);
        } catch (Exception e) {
            log.error("listarMovimentacoes/dia: exception", e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, MSG_FALHA_LISTAR_DIA));
        }
    }

    private static class TimestampRange {
        final java.time.OffsetDateTime fromTs;
        final java.time.OffsetDateTime toTs;

        TimestampRange(java.time.OffsetDateTime fromTs, java.time.OffsetDateTime toTs) {
            this.fromTs = fromTs;
            this.toTs = toTs;
        }
    }

    private TimestampRange calculateDayTimestampRange(java.time.LocalDate dia) {
        java.time.ZoneId sp = java.time.ZoneId.of(TIMEZONE_SAO_PAULO);
        var zdtFrom = java.time.ZonedDateTime.of(dia, java.time.LocalTime.MIDNIGHT, sp);
        var zdtTo = java.time.ZonedDateTime.of(dia.plusDays(1), java.time.LocalTime.MIDNIGHT, sp).minusNanos(1);
        return new TimestampRange(zdtFrom.toOffsetDateTime(), zdtTo.toOffsetDateTime());
    }

    private java.util.List<java.util.Map<String, Object>> fetchDayMovimentacoes(TimestampRange range) {
        java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();
        log.info("fetchDayMovimentacoes: Iniciando busca para periodo {} a {}", range.fromTs, range.toTs);

        // Fetch movimentações
        fetchDayMovimentacoesFromDb(lista, range);
        log.info("fetchDayMovimentacoes: Após movimentações, lista tem {} itens", lista.size());

        // Fetch sale orders
        fetchDaySaleOrdersFromDb(lista, range);
        log.info("fetchDayMovimentacoes: Após vendas, lista tem {} itens", lista.size());

        return lista;
    }

    private void fetchDayMovimentacoesFromDb(java.util.List<java.util.Map<String, Object>> lista,
            TimestampRange range) {
        safeExecute(() -> {
            var movs = movimentacaoRepository.findByPeriodoTimestamps(range.fromTs, range.toTs);
            for (var m : movs) {
                java.util.Map<String, Object> row = buildDayMovimentacaoRow(m);
                lista.add(row);
            }
        }, () -> {
            log.warn("listarMovimentacoes/dia: movs query failed");
            lista.addAll(buildManualMovRows(range.fromTs.toLocalDate(), null, null));
        });
    }

    private java.util.Map<String, Object> buildDayMovimentacaoRow(CaixaMovimentacao m) {
        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("id", m.getId());
        row.put(KEY_CAIXA_STATUS_ID, m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
        row.put("tipo", m.getTipo());
        row.put(KEY_VALOR, m.getValor());
        row.put(KEY_DESCRICAO, m.getDescricao());

        String usuarioNome = extractDayUsuarioNome(m);
        row.put(KEY_USUARIO, usuarioNome);
        row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());

        return row;
    }

    private String extractDayUsuarioNome(CaixaMovimentacao m) {
        try {
            if (m.getOperador() != null) {
                return m.getOperador().getUsername();
            }
        } catch (Exception e) {
            log.debug("Error extracting operator username: {}", e.getMessage());
        }

        if (m.getUsuario() != null) {
            return m.getUsuario().getUsername();
        }

        return null;
    }

    private void fetchDaySaleOrdersFromDb(java.util.List<java.util.Map<String, Object>> lista, TimestampRange range) {
        log.info("fetchDaySaleOrdersFromDb: Buscando vendas para o periodo {} a {}", range.fromTs, range.toTs);
        safeExecute(() -> {
            var orders = saleOrderRepository.findByPeriodoTimestampsRaw(range.fromTs, range.toTs);
            log.info("fetchDaySaleOrdersFromDb: Encontradas {} vendas", orders.size());
            for (var vo : orders) {
                var rows = buildDaySaleOrderRows(vo);
                log.debug("fetchDaySaleOrdersFromDb: Venda ID {} gerou {} linhas", vo.getId(), rows.size());
                lista.addAll(rows);
            }
            log.info("fetchDaySaleOrdersFromDb: Total de {} itens adicionados à lista", lista.size());
        }, () -> {
            log.warn("listarMovimentacoes/dia: orders query failed, usando fallback");
            lista.addAll(buildSaleOrderRows(range.fromTs.toLocalDate(), null, null));
        });
    }

    private java.util.List<java.util.Map<String, Object>> buildDaySaleOrderRows(
            com.example.backendspring.sale.SaleOrder vo) {
        java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();

        for (var pg : vo.getPagamentos()) {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", vo.getId());
            row.put("tipo", TIPO_VENDA);
            row.put(KEY_VALOR, pg.getValor());
            row.put(KEY_PAGAMENTO_VALOR, pg.getValor());
            row.put(KEY_TOTAL_VENDA, vo.getTotalFinal());

            addDaySaleDescription(row, vo, pg);
            addDaySaleDetails(row, vo, pg);

            rows.add(row);
        }

        return rows;
    }

    private void addDaySaleDescription(java.util.Map<String, Object> row,
            com.example.backendspring.sale.SaleOrder vo, com.example.backendspring.sale.SalePayment pg) {
        var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag(LOCALE_PT_BR));
        String totalFmt = nf.format(vo.getTotalFinal());
        boolean multi = vo.getPagamentos().size() > 1;

        if (multi) {
            String breakdown = buildDayPaymentBreakdown(vo, nf);
            row.put(KEY_DESCRICAO, LABEL_VENDA_MULTI_PREFIX + totalFmt + " - " + breakdown);
        } else {
            row.put(KEY_DESCRICAO,
                    LABEL_VENDA_TOTAL + totalFmt + " (" + labelMetodoPagamento(pg.getMetodo()) + " "
                            + nf.format(pg.getValor()) + ")");
        }
    }

    private String buildDayPaymentBreakdown(com.example.backendspring.sale.SaleOrder vo,
            java.text.NumberFormat nf) {
        return vo.getPagamentos().stream()
                .map(p -> labelMetodoPagamento(p.getMetodo()) + " " + nf.format(p.getValor()))
                .collect(java.util.stream.Collectors.joining(" | "));
    }

    private void addDaySaleDetails(java.util.Map<String, Object> row,
            com.example.backendspring.sale.SaleOrder vo, com.example.backendspring.sale.SalePayment pg) {
        addSaleDetailsToRow(row, vo, pg);
    }

    private ResponseEntity<java.util.Map<String, Object>> buildDayMovimentacoesResponse(
            java.util.List<java.util.Map<String, Object>> lista) {

        DayMovimentacoesSums sums = calculateDayMovimentacoesSums(lista);

        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put(KEY_ITEMS, lista);
        body.put(KEY_TOTAL, lista.size());
        body.put(KEY_HAS_NEXT, false);
        body.put(KEY_PAGE, 1);
        body.put(KEY_SIZE, lista.size());
        body.put(KEY_SUM_ENTRADAS, sums.sumEntradas);
        body.put(KEY_SUM_RETIRADAS, sums.sumRetiradas);
        body.put(KEY_SUM_VENDAS, sums.sumVendas);

        addDayEntradasBreakdown(body, lista);

        // Log detalhado do que está sendo retornado
        log.info("buildDayMovimentacoesResponse: Retornando {} itens", lista.size());
        log.info("buildDayMovimentacoesResponse: Detalhes dos itens:");
        for (int i = 0; i < lista.size(); i++) {
            var item = lista.get(i);
            log.info("  Item {}: id={}, tipo={}, descricao={}", i + 1,
                    item.get("id"), item.get("tipo"),
                    item.get(KEY_DESCRICAO) != null ? item.get(KEY_DESCRICAO).toString().substring(0,
                            Math.min(50, item.get(KEY_DESCRICAO).toString().length())) : "null");
        }

        return ResponseEntity.ok(body);
    }

    private static class DayMovimentacoesSums {
        double sumEntradas;
        double sumRetiradas;
        double sumVendas;
    }

    private DayMovimentacoesSums calculateDayMovimentacoesSums(java.util.List<java.util.Map<String, Object>> lista) {
        DayMovimentacoesSums sums = new DayMovimentacoesSums();

        sums.sumEntradas = calculateDaySumByType(lista, TIPO_ENTRADA);
        sums.sumRetiradas = calculateDaySumByType(lista, TIPO_RETIRADA);

        // Avoid double-counting cash: build keys of entrada rows
        java.util.Set<String> entradaCashKeys = buildDayEntradaCashKeys(lista);
        sums.sumVendas = calculateDayVendasSum(lista, entradaCashKeys);

        // Log detalhado para debug de duplicação
        log.info("DIA_SUMS_DEBUG: Entradas totais: {}, Retiradas: {}, Vendas (após dedup): {}",
                sums.sumEntradas, sums.sumRetiradas, sums.sumVendas);
        log.info("DIA_SUMS_DEBUG: Chaves de entrada em dinheiro encontradas: {}", entradaCashKeys.size());

        return sums;
    }

    private double calculateDaySumByType(java.util.List<java.util.Map<String, Object>> lista, String tipo) {
        return lista.stream()
                .filter(m -> tipo.equals(m.get("tipo")))
                .mapToDouble(m -> {
                    Object valor = m.get(KEY_VALOR);
                    return valor == null ? 0.0 : ((Number) valor).doubleValue();
                })
                .sum();
    }

    private java.util.Set<String> buildDayEntradaCashKeys(java.util.List<java.util.Map<String, Object>> lista) {
        return lista.stream()
                .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .filter(m -> m.get(KEY_CAIXA_STATUS_ID) != null && m.get(KEY_VALOR) != null)
                .map(m -> {
                    String caixaId = m.get(KEY_CAIXA_STATUS_ID).toString();
                    double valor = ((Number) m.get(KEY_VALOR)).doubleValue();
                    String key = caixaId + "|" + String.format("%.2f", valor);
                    log.info(
                            "DEDUP_DAY: Criando chave entrada em dinheiro - caixa_id: {}, valor: {}, key: {}, descricao: '{}'",
                            caixaId, valor, key, m.get(KEY_DESCRICAO));
                    return key;
                })
                .collect(java.util.stream.Collectors.toSet());
    }

    private double calculateDayVendasSum(java.util.List<java.util.Map<String, Object>> lista,
            java.util.Set<String> entradaCashKeys) {
        return lista.stream()
                .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                .mapToDouble(m -> calculateDayVendaValue(m, entradaCashKeys))
                .sum();
    }

    private double calculateDayVendaValue(java.util.Map<String, Object> m, java.util.Set<String> entradaCashKeys) {
        try {
            Object metodo = m.get(KEY_METODO_PAGAMENTO);
            Object caixaId = m.get(KEY_CAIXA_STATUS_ID);
            Object valorObj = m.get(KEY_VALOR);
            double val = valorObj == null ? 0.0 : ((Number) valorObj).doubleValue();

            log.info("DEDUP_DAY: Analisando venda - id: {}, metodo: {}, caixa_id: {}, valor: {}",
                    m.get("id"), metodo, caixaId, val);

            // Para vendas em dinheiro, verificar se já existe uma entrada correspondente no
            // caixa
            if (VALOR_DINHEIRO.equals(metodo) && caixaId != null) {
                String key = caixaId.toString() + "|" + String.format("%.2f", val);
                if (entradaCashKeys.contains(key)) {
                    log.info(
                            "DEDUP_DAY: Excluindo venda em dinheiro duplicada - caixa_id: {}, valor: {}, venda_id: {}",
                            caixaId, val, m.get("id"));
                    return 0.0; // skip duplicate - dinheiro já contado como entrada
                } else {
                    log.info(
                            "DEDUP_DAY: Venda em dinheiro SEM entrada correspondente - caixa_id: {}, valor: {}, key: {}",
                            caixaId, val, key);
                }
            }
            return val;
        } catch (Exception e) {
            log.warn("Erro ao calcular valor da venda (dia): {}", e.getMessage());
            return 0.0;
        }
    }

    private void addDayEntradasBreakdown(java.util.Map<String, Object> body,
            java.util.List<java.util.Map<String, Object>> lista) {
        safeExecute(() -> {
            double sumEntradasAuto = calculateDayEntradasAutoSum(lista);
            double sumEntradasManuais = Math.max(0.0,
                    ((Number) body.get(KEY_SUM_ENTRADAS)).doubleValue() - sumEntradasAuto);

            body.put(KEY_SUM_ENTRADAS_AUTOMATICAS, sumEntradasAuto);
            body.put(KEY_SUM_ENTRADAS_MANUAIS, sumEntradasManuais);
        }, () -> {
            // Ignore errors in entradas breakdown calculation
        });
    }

    private double calculateDayEntradasAutoSum(java.util.List<java.util.Map<String, Object>> lista) {
        return lista.stream()
                .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .filter(this::isDayEntradaAuto)
                .mapToDouble(m -> {
                    Object valor = m.get(KEY_VALOR);
                    return valor == null ? 0.0 : ((Number) valor).doubleValue();
                })
                .sum();
    }

    private boolean isDayEntradaAuto(java.util.Map<String, Object> m) {
        try {
            Object d = m.get(KEY_DESCRICAO);
            if (d == null)
                return false;
            String s = d.toString().toLowerCase();
            return s.contains(TIPO_VENDA);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Endpoint helper: retorna todas movimentações + vendas para um mês.
     * Query params: ano=YYYY mes=MM
     */
    @GetMapping("/movimentacoes/mes")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> listarMovimentacoesMes(
            @RequestParam(value = "ano") int ano,
            @RequestParam(value = "mes") int mes,
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "size", required = false) Integer size) {
        try {
            java.time.LocalDate inicio = java.time.LocalDate.of(ano, mes, 1);
            java.time.LocalDate fim = inicio.plusMonths(1).minusDays(1);
            // Force timestamp-based path to ensure consistent behavior with
            // payments that are linked to caixa_status (avoids double-counting
            // differences between the LocalDate and timestamp branches).
            return handleMovimentacoesByPeriod(inicio, fim, page, size);
        } catch (Exception e) {
            log.error("listarMovimentacoes/mes: exception", e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, MSG_FALHA_LISTAR_MES));
        }
    }

    private ResponseEntity<java.util.Map<String, Object>> handleMovimentacoesByPeriod(
            java.time.LocalDate inicio, java.time.LocalDate fim, Integer page, Integer size) {
        try {
            // Use helper method to avoid self-invocation of @Transactional method
            MovimentacoesQueryParams params = new MovimentacoesQueryParams();
            params.periodoInicio = inicio.toString();
            params.periodoFim = fim.toString();
            params.page = page == null ? 1 : page;
            params.size = size == null ? 20 : size;
            return getMovimentacoesDirectly(params);
        } catch (Exception ex) {
            // Fallback to LocalDate path if timezone conversion fails
            MovimentacoesQueryParams fallbackParams = new MovimentacoesQueryParams();
            fallbackParams.periodoInicio = inicio.toString();
            fallbackParams.periodoFim = fim.toString();
            fallbackParams.page = page == null ? 1 : page;
            fallbackParams.size = size == null ? 20 : size;
            return getMovimentacoesDirectly(fallbackParams);
        }
    }

    /**
     * Diagnostic endpoint: compare items returned by LocalDate path vs Timestamp
     * path
     * for the same period. Useful to detect differences caused by payment-row
     * skipping
     * or timezone boundaries.
     */
    @GetMapping("/movimentacoes/diagnose-diff")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> diagnosticarDivergencia(
            @RequestParam(value = "periodo_inicio") String periodoInicio,
            @RequestParam(value = "periodo_fim") String periodoFim) {
        try {
            // Get local date path results
            java.util.List<java.util.Map<String, Object>> localItems = getMovimentacoesForDiagnosisLocal(periodoInicio,
                    periodoFim);

            // Get timestamp path results
            TimestampBounds bounds = calculateTimestampBounds(periodoInicio, periodoFim);
            java.util.List<java.util.Map<String, Object>> tsItems = getMovimentacoesForDiagnosisTimestamp(bounds);

            // Build maps and find differences
            java.util.function.Function<java.util.Map<String, Object>, String> keyFn = createDedupeKeyFunction();
            java.util.Map<String, java.util.Map<String, Object>> mapLocal = buildItemMap(localItems, keyFn);
            java.util.Map<String, java.util.Map<String, Object>> mapTs = buildItemMap(tsItems, keyFn);

            java.util.List<java.util.Map<String, Object>> inLocalNotInTs = findItemsNotInOtherMap(mapLocal, mapTs);
            java.util.List<java.util.Map<String, Object>> inTsNotInLocal = findItemsNotInOtherMap(mapTs, mapLocal);

            // Build response
            java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
            resp.put("local_count", mapLocal.size());
            resp.put("ts_count", mapTs.size());
            resp.put("in_local_not_in_ts", inLocalNotInTs);
            resp.put("in_ts_not_in_local", inTsNotInLocal);
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("diagnosticarDivergencia: exception", e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, MSG_FALHA_DIAGNOSTICAR));
        }
    }

    // Helper methods for diagnosticarDivergencia to avoid self-invocation
    private java.util.List<java.util.Map<String, Object>> getMovimentacoesForDiagnosisLocal(
            String periodoInicio, String periodoFim) {
        MovimentacoesRequest request = MovimentacoesRequest.builder()
                .periodoInicio(periodoInicio).periodoFim(periodoFim)
                .all(Boolean.TRUE).page(1).size(Integer.MAX_VALUE).build();
        MovimentacoesQueryParams params = buildQueryParams(request);

        java.util.List<java.util.Map<String, Object>> lista = fetchMovimentacoesList(params);
        return applyFilters(lista, params.tipo, params.metodoPagamento, params.tIni, params.tFim);
    }

    private java.util.List<java.util.Map<String, Object>> getMovimentacoesForDiagnosisTimestamp(
            TimestampBounds bounds) {
        MovimentacoesRequest request = MovimentacoesRequest.builder()
                .from(bounds.fromTs.toString()).to(bounds.toTs.toString())
                .all(Boolean.TRUE).page(1).size(Integer.MAX_VALUE).build();
        MovimentacoesQueryParams params = buildQueryParams(request);

        java.util.List<java.util.Map<String, Object>> lista = fetchMovimentacoesList(params);
        return applyFilters(lista, params.tipo, params.metodoPagamento, params.tIni, params.tFim);
    }

    @GetMapping("/sessoes")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> listarSessoes(
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "size", required = false) Integer size) {
        try {
            int pageNum = (page == null || page < 1) ? 1 : page;
            int pageSize = (size == null || size < 1) ? 20 : size;
            var pageable = org.springframework.data.domain.PageRequest.of(pageNum - 1, pageSize,
                    org.springframework.data.domain.Sort.by("id").descending());
            var pg = caixaStatusRepository.findAll(pageable);

            // Calculate metrics for all sessions
            SessionMetrics metrics = calculateSessionMetrics();

            // Build response items
            var items = buildSessionResponseItems(pg.getContent(), metrics);

            return ResponseEntity.ok(buildStatusPaginatedResponse(items, pg, pageNum, pageSize));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(java.util.Map.of(KEY_ITEMS, java.util.List.of(), KEY_TOTAL, 0,
                    KEY_HAS_NEXT, false, KEY_PAGE, 1, KEY_SIZE, 20));
        }
    }

    private SessionMetrics calculateSessionMetrics() {
        // Load all sessions for cumulative/historical calculations
        var allSessoes = caixaStatusRepository.findAll().stream()
                .sorted(java.util.Comparator.comparing(CaixaStatus::getId))
                .toList();

        return new SessionMetrics(
                calculateCumulativeMap(allSessoes),
                calculateCumulativeTotal(allSessoes),
                calculateDayVariacaoMap(allSessoes),
                calculateDaySaldoInicialMap(allSessoes));
    }

    private java.util.Map<Long, Double> calculateCumulativeMap(java.util.List<CaixaStatus> allSessoes) {
        java.util.Map<Long, Double> cumulativeBeforeMap = new java.util.HashMap<>();
        double running = 0.0;
        for (var s : allSessoes) {
            if (s.getId() != null) {
                cumulativeBeforeMap.put(s.getId(), running);
                running += (s.getVariacao() == null ? 0.0 : s.getVariacao());
            }
        }
        return cumulativeBeforeMap;
    }

    private double calculateCumulativeTotal(java.util.List<CaixaStatus> allSessoes) {
        return allSessoes.stream()
                .mapToDouble(s -> s.getVariacao() == null ? 0.0 : s.getVariacao())
                .sum();
    }

    private java.util.Map<java.time.LocalDate, Double> calculateDayVariacaoMap(java.util.List<CaixaStatus> allSessoes) {
        java.util.Map<java.time.LocalDate, Double> dayVariacaoMap = new java.util.HashMap<>();
        for (var s : allSessoes) {
            java.time.LocalDate d = extractSessionDate(s);
            if (d != null) {
                dayVariacaoMap.put(d,
                        dayVariacaoMap.getOrDefault(d, 0.0) + (s.getVariacao() == null ? 0.0 : s.getVariacao()));
            }
        }
        return dayVariacaoMap;
    }

    private java.util.Map<java.time.LocalDate, Double> calculateDaySaldoInicialMap(
            java.util.List<CaixaStatus> allSessoes) {
        java.util.Map<java.time.LocalDate, Double> daySaldoInicialMap = new java.util.HashMap<>();
        for (var s : allSessoes) {
            java.time.LocalDate d = extractSessionDate(s);
            if (d != null) {
                daySaldoInicialMap.put(d, daySaldoInicialMap.getOrDefault(d, 0.0)
                        + (s.getSaldoInicial() == null ? 0.0 : s.getSaldoInicial()));
            }
        }
        return daySaldoInicialMap;
    }

    private java.time.LocalDate extractSessionDate(CaixaStatus s) {
        if (s.getDataAbertura() != null)
            return s.getDataAbertura().toLocalDate();
        else if (s.getDataFechamento() != null)
            return s.getDataFechamento().toLocalDate();
        return null;
    }

    private java.util.List<java.util.Map<String, Object>> buildSessionResponseItems(
            java.util.List<CaixaStatus> content, SessionMetrics metrics) {
        return content.stream().map(cs -> buildSessionResponseItem(cs, metrics)).toList();
    }

    private java.util.Map<String, Object> buildSessionResponseItem(CaixaStatus cs, SessionMetrics metrics) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", cs.getId());
        m.put(KEY_ABERTO, Boolean.TRUE.equals(cs.getAberto()));
        m.put(KEY_ABERTO_POR, cs.getAbertoPor() != null ? cs.getAbertoPor().getUsername() : null);
        m.put(KEY_FECHADO_POR, cs.getFechadoPor() != null ? cs.getFechadoPor().getUsername() : null);
        m.put(KEY_DATA_ABERTURA, cs.getDataAbertura());
        m.put(KEY_DATA_FECHAMENTO, cs.getDataFechamento());
        m.put(KEY_SALDO_INICIAL, cs.getSaldoInicial());
        m.put(KEY_SALDO_ESPERADO, cs.getSaldoEsperado());
        m.put(KEY_SALDO_CONTADO, cs.getSaldoContado());
        m.put(KEY_VARIACAO, cs.getVariacao());
        m.put(KEY_TERMINAL_ID, cs.getTerminalId());
        m.put("observacoes", cs.getObservacoesFechamento());

        addCumulativeMetrics(m, cs, metrics);
        addDayAggregates(m, cs, metrics);

        return m;
    }

    private void addCumulativeMetrics(java.util.Map<String, Object> m, CaixaStatus cs, SessionMetrics metrics) {
        if (cs.getId() != null) {
            m.put(KEY_CUMULATIVE_VARIACAO_BEFORE, metrics.cumulativeBeforeMap.getOrDefault(cs.getId(), 0.0));
            m.put(KEY_CUMULATIVE_VARIACAO_ALL, metrics.cumulativeAll);
        } else {
            m.put(KEY_CUMULATIVE_VARIACAO_BEFORE, 0.0);
            m.put(KEY_CUMULATIVE_VARIACAO_ALL, metrics.cumulativeAll);
        }
    }

    private void addDayAggregates(java.util.Map<String, Object> m, CaixaStatus cs, SessionMetrics metrics) {
        java.time.LocalDate d = extractSessionDate(cs);
        if (d != null) {
            m.put(KEY_DAY_VARIACAO_TOTAL, metrics.dayVariacaoMap.getOrDefault(d, 0.0));
            m.put(KEY_DAY_SALDO_INICIAL_TOTAL, metrics.daySaldoInicialMap.getOrDefault(d, 0.0));
        } else {
            m.put(KEY_DAY_VARIACAO_TOTAL, 0.0);
            m.put(KEY_DAY_SALDO_INICIAL_TOTAL, 0.0);
        }
    }

    private java.util.Map<String, Object> buildStatusPaginatedResponse(
            java.util.List<java.util.Map<String, Object>> items,
            org.springframework.data.domain.Page<CaixaStatus> pg,
            int pageNum, int pageSize) {
        java.util.Map<String, Object> response = new java.util.LinkedHashMap<>();
        response.put(KEY_ITEMS, items);
        response.put(KEY_TOTAL, pg.getTotalElements());
        response.put(KEY_HAS_NEXT, pg.hasNext());
        response.put(KEY_PAGE, pageNum);
        response.put(KEY_SIZE, pageSize);
        return response;
    }

    private static class SessionMetrics {
        final java.util.Map<Long, Double> cumulativeBeforeMap;
        final double cumulativeAll;
        final java.util.Map<java.time.LocalDate, Double> dayVariacaoMap;
        final java.util.Map<java.time.LocalDate, Double> daySaldoInicialMap;

        SessionMetrics(java.util.Map<Long, Double> cumulativeBeforeMap, double cumulativeAll,
                java.util.Map<java.time.LocalDate, Double> dayVariacaoMap,
                java.util.Map<java.time.LocalDate, Double> daySaldoInicialMap) {
            this.cumulativeBeforeMap = cumulativeBeforeMap;
            this.cumulativeAll = cumulativeAll;
            this.dayVariacaoMap = dayVariacaoMap;
            this.daySaldoInicialMap = daySaldoInicialMap;
        }
    }

    @GetMapping("/movimentacoes/summary")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> movimentacoesSummary(
            @RequestParam(value = "data", required = false) String data,
            @RequestParam(value = "periodo_inicio", required = false) String periodoInicio,
            @RequestParam(value = "periodo_fim", required = false) String periodoFim,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "tipo", required = false) String tipo,
            @RequestParam(value = "metodo_pagamento", required = false) String metodoPagamento,
            @RequestParam(value = "hora_inicio", required = false) String horaInicio,
            @RequestParam(value = "hora_fim", required = false) String horaFim) {
        // Direct implementation with aggs=true to avoid self-invocation
        try {
            MovimentacoesFilterParams params = MovimentacoesFilterParams.builder()
                    .data(data)
                    .periodoInicio(periodoInicio)
                    .periodoFim(periodoFim)
                    .from(from)
                    .to(to)
                    .tipo(tipo)
                    .metodoPagamento(metodoPagamento)
                    .horaInicio(horaInicio)
                    .horaFim(horaFim)
                    .build();
            return getMovimentacoesSummaryData(params);
        } catch (Exception e) {
            log.error("movimentacoesSummary: exception", e);
            return ResponseEntity.status(500).body(java.util.Map.of(
                    KEY_ERROR, "Falha ao obter resumo de movimentações",
                    KEY_SUM_ENTRADAS, 0.0,
                    KEY_SUM_RETIRADAS, 0.0,
                    KEY_SUM_VENDAS, 0.0,
                    KEY_TOTAL, 0));
        }
    }

    private ResponseEntity<java.util.Map<String, Object>> getMovimentacoesSummaryData(
            MovimentacoesFilterParams params) {
        DateTimeContext dateContext = parseDateTimeContext(params);
        TimestampBounds bounds = calculateTimestampBounds(dateContext.dia, dateContext.inicio, dateContext.fim,
                dateContext.tIni, dateContext.tFim, params.from, params.to);

        java.util.List<java.util.Map<String, Object>> lista = collectMovimentacoesData(bounds, dateContext);
        var filtrada = applyFilters(lista, params.tipo, params.metodoPagamento, dateContext.tIni, dateContext.tFim);

        return ResponseEntity.ok(calculateSummaryAggregates(filtrada));
    }

    private DateTimeContext parseDateTimeContext(MovimentacoesFilterParams params) {
        java.time.LocalDate dia = null;
        java.time.LocalDate inicio = null;
        java.time.LocalDate fim = null;
        if (params.data != null && !params.data.isBlank()) {
            dia = java.time.LocalDate.parse(params.data);
        } else if (params.periodoInicio != null && params.periodoFim != null) {
            inicio = java.time.LocalDate.parse(params.periodoInicio);
            fim = java.time.LocalDate.parse(params.periodoFim);
        }

        var tIni = safeParseLocalTime(params.horaInicio);
        var tFim = safeParseLocalTime(params.horaFim);

        return new DateTimeContext(dia, inicio, fim, tIni, tFim);
    }

    private java.util.List<java.util.Map<String, Object>> collectMovimentacoesData(
            TimestampBounds bounds, DateTimeContext dateContext) {
        java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

        if (bounds.fromTs != null || bounds.toTs != null) {
            lista.addAll(collectTimestampBasedData(bounds));
        } else {
            lista.addAll(buildManualMovRows(dateContext.dia, dateContext.inicio, dateContext.fim));
            lista.addAll(buildSaleOrderRows(dateContext.dia, dateContext.inicio, dateContext.fim));
        }

        return lista;
    }

    private java.util.List<java.util.Map<String, Object>> collectTimestampBasedData(TimestampBounds bounds) {
        java.util.Map<Object, java.util.Map<String, Object>> byId = new java.util.LinkedHashMap<>();
        addMovimentacoesToCollection(byId, bounds);
        addSaleOrdersToCollection(byId, bounds);
        return new java.util.ArrayList<>(byId.values());
    }

    private void addMovimentacoesToCollection(java.util.Map<Object, java.util.Map<String, Object>> byId,
            TimestampBounds bounds) {
        try {
            var movs = movimentacaoRepository.findByPeriodoTimestamps(bounds.fromTs, bounds.toTs);
            for (var m : movs) {
                java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                row.put("id", m.getId());
                row.put(KEY_CAIXA_STATUS_ID, m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
                row.put("tipo", m.getTipo());
                row.put(KEY_VALOR, m.getValor());
                row.put(KEY_DESCRICAO, m.getDescricao());
                row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
                row.put(KEY_METODO_PAGAMENTO, null); // Manual movements don't have payment method
                byId.put(m.getId(), row);
            }
        } catch (Exception e) {
            log.warn("getMovimentacoesSummaryData: movs query failed", e);
        }
    }

    private void addSaleOrdersToCollection(java.util.Map<Object, java.util.Map<String, Object>> byId,
            TimestampBounds bounds) {
        try {
            var orders = saleOrderRepository.findByPeriodoTimestampsRaw(bounds.fromTs, bounds.toTs);
            for (var vo : orders) {
                for (var pg : vo.getPagamentos()) {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    String compositeId = vo.getId() + "|" + pg.getMetodo() + "|" + pg.getValor();
                    row.put("id", vo.getId());
                    row.put("tipo", TIPO_VENDA);
                    row.put(KEY_VALOR, pg.getValor());
                    row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
                    row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
                    row.put(KEY_CAIXA_STATUS_ID, vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
                    byId.put(compositeId, row);
                }
            }
        } catch (Exception e) {
            log.warn("getMovimentacoesSummaryData: orders query failed", e);
        }
    }

    private java.util.Map<String, Object> calculateSummaryAggregates(
            java.util.List<java.util.Map<String, Object>> filtrada) {
        double sumEntradasAgg = filtrada.stream()
                .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum();
        double sumRetiradasAgg = filtrada.stream()
                .filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum();

        // Aplicar lógica de deduplicação para vendas em dinheiro
        java.util.Set<String> entradaCashKeys = buildEntradaCashKeys(filtrada);
        double sumVendasAgg = filtrada.stream()
                .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                .mapToDouble(m -> calculateVendaValue(m, entradaCashKeys))
                .sum();

        log.debug("DEDUP_SUMMARY: Calculando agregados com deduplicação - entradas: {}, retiradas: {}, vendas: {}",
                sumEntradasAgg, sumRetiradasAgg, sumVendasAgg);

        java.util.Map<String, Object> aggsMap = new java.util.LinkedHashMap<>();
        aggsMap.put(KEY_SUM_ENTRADAS, sumEntradasAgg);
        aggsMap.put(KEY_SUM_RETIRADAS, sumRetiradasAgg);
        aggsMap.put(KEY_SUM_VENDAS, sumVendasAgg);
        aggsMap.put(KEY_TOTAL, filtrada.size());
        return aggsMap;
    }

    private static class DateTimeContext {
        final java.time.LocalDate dia;
        final java.time.LocalDate inicio;
        final java.time.LocalDate fim;
        final java.time.LocalTime tIni;
        final java.time.LocalTime tFim;

        DateTimeContext(java.time.LocalDate dia, java.time.LocalDate inicio, java.time.LocalDate fim,
                java.time.LocalTime tIni, java.time.LocalTime tFim) {
            this.dia = dia;
            this.inicio = inicio;
            this.fim = fim;
            this.tIni = tIni;
            this.tFim = tFim;
        }
    }

    private static class MovimentacoesFilterParams {
        final String data;
        final String periodoInicio;
        final String periodoFim;
        final String from;
        final String to;
        final String tipo;
        final String metodoPagamento;
        final String horaInicio;
        final String horaFim;

        private MovimentacoesFilterParams(Builder builder) {
            this.data = builder.data;
            this.periodoInicio = builder.periodoInicio;
            this.periodoFim = builder.periodoFim;
            this.from = builder.from;
            this.to = builder.to;
            this.tipo = builder.tipo;
            this.metodoPagamento = builder.metodoPagamento;
            this.horaInicio = builder.horaInicio;
            this.horaFim = builder.horaFim;
        }

        static Builder builder() {
            return new Builder();
        }

        static class Builder {
            String data;
            String periodoInicio;
            String periodoFim;
            String from;
            String to;
            String tipo;
            String metodoPagamento;
            String horaInicio;
            String horaFim;

            Builder data(String data) {
                this.data = data;
                return this;
            }

            Builder periodoInicio(String periodoInicio) {
                this.periodoInicio = periodoInicio;
                return this;
            }

            Builder periodoFim(String periodoFim) {
                this.periodoFim = periodoFim;
                return this;
            }

            Builder from(String from) {
                this.from = from;
                return this;
            }

            Builder to(String to) {
                this.to = to;
                return this;
            }

            Builder tipo(String tipo) {
                this.tipo = tipo;
                return this;
            }

            Builder metodoPagamento(String metodoPagamento) {
                this.metodoPagamento = metodoPagamento;
                return this;
            }

            Builder horaInicio(String horaInicio) {
                this.horaInicio = horaInicio;
                return this;
            }

            Builder horaFim(String horaFim) {
                this.horaFim = horaFim;
                return this;
            }

            MovimentacoesFilterParams build() {
                return new MovimentacoesFilterParams(this);
            }
        }
    }

    @DeleteMapping("/sessoes/{id}")
    @Transactional
    public ResponseEntity<Map<String, Object>> deleteSessao(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @PathVariable("id") Long id) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var u = userRepository.findById(userId).orElse(null);
        if (u == null || u.getRole() == null || !u.getRole().equals(VALOR_ADMIN)) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, MSG_PERMISSAO_NEGADA));
        }
        try {
            // Use pessimistic lock to avoid concurrent modifications
            var opt = caixaStatusRepository.findByIdForUpdate(id);
            if (opt.isEmpty())
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, MSG_SESSAO_NAO_ENCONTRADA));
            var sess = opt.get();
            // para segurança, não permitir exclusão de sessão aberta
            if (Boolean.TRUE.equals(sess.getAberto()))
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Não é possível excluir sessão aberta"));

            // verificar dependências: movimentações e ordens vinculadas
            long movCount = movimentacaoRepository.findAllOrderByData().stream()
                    .filter(m -> m.getCaixaStatus() != null && id.equals(m.getCaixaStatus().getId())).count();
            long orderCount = saleOrderRepository.findAllOrderByData().stream()
                    .filter(o -> o.getCaixaStatus() != null && id.equals(o.getCaixaStatus().getId())).count();
            if (movCount > 0 || orderCount > 0) {
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR,
                        String.format(
                                "Existem %d movimentações e %d vendas vinculadas a esta sessão. Remova ou desvincule antes de excluir.",
                                movCount, orderCount)));
            }

            // remove via entity to ensure proper JPA lifecycle handling
            caixaStatusRepository.delete(sess);
            return handleSessionDeletion(id);
        } catch (Exception e) {
            log.error("deleteSessao: exception deleting {}", id, e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao excluir sessão"));
        }
    }

    private ResponseEntity<Map<String, Object>> handleSessionDeletion(Long id) {
        try {
            caixaStatusRepository.flush();
        } catch (Exception ex) {
            log.error("deleteSessao: flush exception for {}", id, ex);
            return ResponseEntity.status(500)
                    .body(Map.of(KEY_ERROR, "Falha ao excluir sessão (flush): " + ex.getMessage()));
        }
        if (caixaStatusRepository.existsById(id)) {
            log.warn("deleteSessao: existsById still true after delete for {}", id);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao excluir sessão (persistência)"));
        }
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Sessão excluída com sucesso"));
    }

    private java.util.List<java.util.Map<String, Object>> buildManualMovRows(java.time.LocalDate dia,
            java.time.LocalDate inicio, java.time.LocalDate fim) {
        java.util.List<CaixaMovimentacao> base;
        if (dia != null) {
            base = movimentacaoRepository.findByDia(dia);
        } else if (inicio != null && fim != null) {
            base = movimentacaoRepository.findByPeriodo(inicio, fim);
        } else {
            base = movimentacaoRepository.findAllOrderByData();
        }
        return base.stream().map(m -> {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", m.getId());
            row.put(KEY_CAIXA_STATUS_ID, m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
            row.put("tipo", m.getTipo());
            row.put(KEY_VALOR, m.getValor());
            row.put(KEY_DESCRICAO, m.getDescricao());
            // Priorizar operador (quando mov gerada por venda), senão usuario da
            // movimentação
            String usuarioNome = null;
            try {
                if (m.getOperador() != null)
                    usuarioNome = m.getOperador().getUsername();
            } catch (Exception e) {
                log.debug("Error accessing operator username: {}", e.getMessage());
            }
            if (usuarioNome == null && m.getUsuario() != null) {
                usuarioNome = m.getUsuario().getUsername();
            }
            row.put(KEY_USUARIO, usuarioNome);
            row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
            return row;
        }).toList();
    }

    private java.util.List<java.util.Map<String, Object>> buildSaleOrderRows(java.time.LocalDate dia,
            java.time.LocalDate inicio, java.time.LocalDate fim) {
        java.util.List<com.example.backendspring.sale.SaleOrder> base = getSaleOrdersForPeriod(dia, inicio, fim);
        return base.stream()
                .flatMap(vo -> createPaymentRows(vo).stream())
                .toList();
    }

    private java.util.List<com.example.backendspring.sale.SaleOrder> getSaleOrdersForPeriod(
            java.time.LocalDate dia, java.time.LocalDate inicio, java.time.LocalDate fim) {
        if (dia != null) {
            return saleOrderRepository.findByDia(dia);
        } else if (inicio != null && fim != null) {
            return saleOrderRepository.findByPeriodo(inicio, fim);
        } else {
            // modo "tudo": trazer todas as vendas multi-pagamento
            return saleOrderRepository.findAllOrderByData();
        }
    }

    private java.util.List<java.util.Map<String, Object>> createPaymentRows(
            com.example.backendspring.sale.SaleOrder vo) {
        return vo.getPagamentos().stream()
                .map(pg -> createPaymentRow(vo, pg))
                .toList();
    }

    private java.util.Map<String, Object> createPaymentRow(
            com.example.backendspring.sale.SaleOrder vo, Object pg) {
        var payment = (com.example.backendspring.sale.SalePayment) pg;
        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("id", vo.getId());
        row.put("tipo", TIPO_VENDA);
        // Valor da linha: valor do pagamento (para refletir entrada por método)
        row.put(KEY_VALOR, payment.getValor());
        // Guardar o valor parcial do método e total da venda
        row.put(KEY_PAGAMENTO_VALOR, payment.getValor());
        row.put(KEY_TOTAL_VENDA, vo.getTotalFinal());

        String description = buildPaymentDescription(vo, payment);
        row.put(KEY_DESCRICAO, description);

        row.put(KEY_PRODUTO_NOME,
                vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
        row.put(KEY_METODO_PAGAMENTO, payment.getMetodo());
        // operador da venda (se disponível)
        row.put(KEY_USUARIO, vo.getOperador() != null ? vo.getOperador().getUsername() : null);
        row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
        row.put(KEY_CAIXA_STATUS_ID, vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
        return row;
    }

    private String buildPaymentDescription(com.example.backendspring.sale.SaleOrder vo, Object pg) {
        var payment = (com.example.backendspring.sale.SalePayment) pg;
        var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag(LOCALE_PT_BR));
        String totalFmt = nf.format(vo.getTotalFinal());
        boolean multi = vo.getPagamentos().size() > 1;

        if (multi) {
            return buildMultiPaymentDescription(vo, totalFmt, nf);
        } else {
            return buildSinglePaymentDescription(payment, totalFmt, nf);
        }
    }

    private String buildMultiPaymentDescription(com.example.backendspring.sale.SaleOrder vo, String totalFmt,
            java.text.NumberFormat nf) {
        String breakdown = vo.getPagamentos().stream()
                .map(p -> buildPaymentLabel(p, nf))
                .collect(java.util.stream.Collectors.joining(" | "));
        return LABEL_VENDA_MULTI_PREFIX + totalFmt + " - " + breakdown;
    }

    private String buildPaymentLabel(Object p, java.text.NumberFormat nf) {
        var payment = (com.example.backendspring.sale.SalePayment) p;
        String labelPart = labelMetodoPagamento(payment.getMetodo()) + " " + nf.format(payment.getValor());
        if (payment.getValor() != null && payment.getValor() < 0)
            labelPart += LABEL_DEVOLVIDO_SUFFIX;
        return labelPart;
    }

    private static java.util.List<java.util.Map<String, Object>> sortByDataMovimentoDesc(
            java.util.List<java.util.Map<String, Object>> lista) {
        try {
            java.util.List<java.util.Map<String, Object>> mutable = lista instanceof java.util.ArrayList
                    ? lista
                    : new java.util.ArrayList<>(lista);
            mutable.sort((a, b) -> java.time.OffsetDateTime.parse(b.get(KEY_DATA_MOVIMENTO).toString())
                    .compareTo(java.time.OffsetDateTime.parse(a.get(KEY_DATA_MOVIMENTO).toString())));
            return mutable;
        } catch (Exception e) {
            // If sorting fails, return original list to avoid propagating 500 to clients
            log.warn("sortByDataMovimentoDesc: sort failed", e);
            return lista;
        }
    }

    private static java.util.List<java.util.Map<String, Object>> applyFilters(
            java.util.List<java.util.Map<String, Object>> lista,
            String tipo,
            String metodoPagamento,
            java.time.LocalTime tIni,
            java.time.LocalTime tFim) {
        return lista.stream()
                .filter(m -> filterByTipo(m, tipo))
                .filter(m -> filterByMetodoPagamento(m, metodoPagamento))
                .filter(m -> filterByTimeRange(m, tIni, tFim))
                .toList();
    }

    private static boolean filterByTipo(java.util.Map<String, Object> m, String tipo) {
        return tipo == null || tipo.isBlank() || tipo.equals(m.get("tipo"));
    }

    private static boolean filterByMetodoPagamento(java.util.Map<String, Object> m, String metodoPagamento) {
        return metodoPagamento == null || metodoPagamento.isBlank() ||
                metodoPagamento.equals(m.get(KEY_METODO_PAGAMENTO));
    }

    private static boolean filterByTimeRange(java.util.Map<String, Object> m,
            java.time.LocalTime tIni, java.time.LocalTime tFim) {
        if (tIni == null && tFim == null) {
            return true;
        }

        return checkTimeInRange(m, tIni, tFim);
    }

    private static boolean checkTimeInRange(java.util.Map<String, Object> m,
            java.time.LocalTime tIni, java.time.LocalTime tFim) {
        try {
            var odt = (java.time.OffsetDateTime) m.get(KEY_DATA_MOVIMENTO);
            if (odt == null)
                return false;

            java.time.LocalTime time = extractLocalTime(odt);
            return isTimeInRange(time, tIni, tFim);
        } catch (Exception e) {
            return false;
        }
    }

    private static java.time.LocalTime extractLocalTime(java.time.OffsetDateTime odt) {
        try {
            return odt.atZoneSameInstant(java.time.ZoneId.of(TIMEZONE_SAO_PAULO)).toLocalTime();
        } catch (Exception ex) {
            return odt.toLocalTime();
        }
    }

    private static boolean isTimeInRange(java.time.LocalTime time,
            java.time.LocalTime tIni, java.time.LocalTime tFim) {
        boolean okIni = tIni == null || !time.isBefore(tIni);
        boolean okFim = tFim == null || !time.isAfter(tFim);
        return okIni && okFim;
    }

    private static java.time.LocalTime safeParseLocalTime(String hora) {
        try {
            if (hora != null && !hora.isBlank()) {
                return java.time.LocalTime.parse(hora);
            }
        } catch (Exception ignored) {
            // formato inválido -> ignorar
        }
        return null;
    }

    @PostMapping("/movimentacoes")
    @Transactional
    public ResponseEntity<Map<String, Object>> adicionarMovimentacao(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody MovimentacaoRequest req) {
        try {
            if (userId == null)
                return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));

            String tipo = req.getTipo();
            if (!TIPO_ENTRADA.equals(tipo) && !TIPO_RETIRADA.equals(tipo)) {
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Tipo inválido (entrada|retirada)"));
            }
            if (req.getValor() == null || req.getValor() <= 0) {
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Valor deve ser maior que zero"));
            }

            // Se o caixa estiver fechado, apenas administradores (role == 'admin') podem
            // registrar
            var statusAtual = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (statusAtual == null || !Boolean.TRUE.equals(statusAtual.getAberto())) {
                var u = userRepository.findById(userId).orElse(null);
                if (u == null || u.getRole() == null || !u.getRole().equals(VALOR_ADMIN)) {
                    return ResponseEntity.status(403)
                            .body(Map.of(KEY_ERROR, "Caixa fechado. Operação restrita ao administrador."));
                }
            }

            var agora = java.time.OffsetDateTime.now();
            // associar à sessão atual do caixa: preferir sessão aberta; senão usar última
            // sessão existente
            var statusAtualLocal = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc()
                    .orElseGet(() -> caixaStatusRepository.findTopByOrderByIdDesc().orElse(null));
            CaixaMovimentacao.CaixaMovimentacaoBuilder movBuilder = CaixaMovimentacao.builder()
                    .tipo(tipo)
                    .valor(req.getValor())
                    .descricao(req.getDescricao())
                    .usuario(userRepository.findById(userId).orElse(null))
                    .dataMovimento(agora)
                    .criadoEm(agora)
                    .atualizadoEm(agora);
            if (statusAtualLocal != null)
                movBuilder.caixaStatus(statusAtualLocal);
            if (req.getMotivo() != null)
                movBuilder.motivo(req.getMotivo());
            CaixaMovimentacao mov = movBuilder.build();
            movimentacaoRepository.save(mov);
            return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Movimentação registrada com sucesso"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR,
                    "Falha ao registrar movimentação. Se acabou de atualizar o sistema, reinicie o backend para aplicar alterações de banco."));
        }
    }

    @PostMapping("/abrir")
    @Transactional
    public ResponseEntity<Map<String, Object>> abrir(@RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody(required = false) java.util.Map<String, Object> payload) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));

        // Validate user permissions
        ResponseEntity<Map<String, Object>> permissionResult = validateOpenerPermissions(userId);
        if (permissionResult != null)
            return permissionResult;

        // Check if cash register is already open
        ResponseEntity<Map<String, Object>> openResult = checkIfAlreadyOpen();
        if (openResult != null)
            return openResult;

        // Validate and parse payload
        ResponseEntity<Map<String, Object>> payloadResult = validateAndParsePayload(payload);
        if (payloadResult != null)
            return payloadResult;

        // Create and save new cash session
        return createAndSaveCashSession(userId, payload);
    }

    private ResponseEntity<Map<String, Object>> validateOpenerPermissions(Long userId) {
        var opener = userRepository.findById(userId).orElse(null);
        if (opener == null || (!Boolean.TRUE.equals(opener.getPodeControlarCaixa())
                && (opener.getRole() == null || !opener.getRole().equals(VALOR_ADMIN)))) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada para abrir o caixa"));
        }
        return null; // Success
    }

    private ResponseEntity<Map<String, Object>> checkIfAlreadyOpen() {
        var abertoOpt = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc();
        if (abertoOpt.isPresent()) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está aberto"));
        }
        return null; // Success
    }

    private ResponseEntity<Map<String, Object>> validateAndParsePayload(java.util.Map<String, Object> payload) {
        if (payload == null || !payload.containsKey(KEY_SALDO_INICIAL) || payload.get(KEY_SALDO_INICIAL) == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_inicial é obrigatório ao abrir o caixa"));
        }

        try {
            Object v = payload.get(KEY_SALDO_INICIAL);
            if (v instanceof Number) {
                // Valid number
            } else {
                Double.parseDouble(v.toString()); // Validate string can be parsed
            }
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_inicial inválido"));
        }
        return null; // Success
    }

    private ResponseEntity<Map<String, Object>> createAndSaveCashSession(Long userId,
            java.util.Map<String, Object> payload) {
        var agora = OffsetDateTime.now();
        var opener = userRepository.findById(userId).orElse(null);

        CaixaStatus status = buildNewCashStatus(opener, agora, payload);

        try {
            caixaStatusRepository.save(status);
        } catch (org.springframework.orm.ObjectOptimisticLockingFailureException e) {
            return ResponseEntity.status(409)
                    .body(Map.of(KEY_ERROR, "Conflito ao atualizar sessão do caixa. Tente novamente."));
        }

        return ResponseEntity.ok(buildCashSessionResponse(status));
    }

    private CaixaStatus buildNewCashStatus(Object opener, OffsetDateTime agora, java.util.Map<String, Object> payload) {
        var user = (com.example.backendspring.user.User) opener;
        CaixaStatus status = new CaixaStatus();

        // Copy configuration from last session if exists
        var lastOpt = caixaStatusRepository.findTopByOrderByIdDesc();
        if (lastOpt.isPresent()) {
            var prev = lastOpt.get();
            status.setHorarioAberturaObrigatorio(prev.getHorarioAberturaObrigatorio());
            status.setHorarioFechamentoObrigatorio(prev.getHorarioFechamentoObrigatorio());
        }

        // Set new session data
        status.setAberto(true);
        status.setAbertoPor(user);
        status.setDataAbertura(agora);
        status.setFechadoPor(null);
        status.setDataFechamento(null);
        status.setAtualizadoEm(agora);
        status.setCriadoEm(agora);

        // Set saldo inicial and terminal ID
        Object v = payload.get(KEY_SALDO_INICIAL);
        if (v instanceof Number number)
            status.setSaldoInicial(number.doubleValue());
        else
            status.setSaldoInicial(Double.parseDouble(v.toString()));

        if (payload.containsKey(KEY_TERMINAL_ID) && payload.get(KEY_TERMINAL_ID) != null) {
            status.setTerminalId(payload.get(KEY_TERMINAL_ID).toString());
        }

        return status;
    }

    private java.util.Map<String, Object> buildCashSessionResponse(CaixaStatus status) {
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", status.getId());
        resp.put(KEY_ABERTO, Boolean.TRUE.equals(status.getAberto()));
        resp.put(KEY_DATA_ABERTURA, status.getDataAbertura());
        resp.put(KEY_ABERTO_POR, status.getAbertoPor() != null ? status.getAbertoPor().getId() : null);
        resp.put("aberto_por_username", status.getAbertoPor() != null ? status.getAbertoPor().getUsername() : null);
        resp.put(KEY_SALDO_INICIAL, status.getSaldoInicial());
        resp.put(KEY_TERMINAL_ID, status.getTerminalId());
        return resp;
    }

    @PostMapping("/fechar")
    @Transactional
    public ResponseEntity<Map<String, Object>> fechar(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody(required = false) FecharRequest body) {

        // Validate user permissions
        ResponseEntity<Map<String, Object>> permissionResult = validateUserPermissionsForClosing(userId);
        if (permissionResult != null)
            return permissionResult;

        // Find and validate cash session
        CaixaStatus status;
        try {
            status = findCashSessionToClose(body);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, e.getMessage()));
        }

        // Validate closing request body
        ResponseEntity<Map<String, Object>> bodyResult = validateClosingRequest(body);
        if (bodyResult != null)
            return bodyResult;

        var agora = OffsetDateTime.now();

        // Calculate expected balance
        calculateAndSetExpectedBalance(status);

        // Set session closing data
        setSessionClosingData(status, body, userId, agora);

        // Calculate cumulative values
        calculateAndSetCumulativeValues(status);

        // Save and return response
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(buildClosingResponse(status));
    }

    @PutMapping("/horarios")
    @Transactional
    public ResponseEntity<Map<String, Object>> configurar(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody HorariosRequest req) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var u = userRepository.findById(userId).orElse(null);
        if (u == null || u.getRole() == null || !u.getRole().equals(VALOR_ADMIN)) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, MSG_PERMISSAO_NEGADA));
        }
        var statusOpt = caixaStatusRepository.findTopByOrderByIdDesc();
        var agora = OffsetDateTime.now();
        CaixaStatus status = statusOpt.orElseGet(CaixaStatus::new);
        status.setHorarioAberturaObrigatorio(req.getHorarioAberturaObrigatorio());
        status.setHorarioFechamentoObrigatorio(req.getHorarioFechamentoObrigatorio());
        status.setAtualizadoEm(agora);
        if (status.getId() == null)
            status.setCriadoEm(agora);
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Horários configurados com sucesso"));
    }

    @GetMapping("/session/{id}/reconciliation")
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> reconciliation(@PathVariable("id") Long sessionId) {
        try {
            var statusOpt = caixaStatusRepository.findById(sessionId);
            if (statusOpt.isEmpty()) {
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, MSG_SESSAO_NAO_ENCONTRADA));
            }
            var status = statusOpt.get();

            java.util.Map<String, Object> resp = buildBasicSessionInfo(status);

            // Add movimentações data
            java.util.List<java.util.Map<String, Object>> movs = buildSessionMovimentacoes(status);
            resp.put("movimentacoes", movs);

            // Add vendas data
            var orders = getSessionOrders(status);
            java.util.List<java.util.Map<String, Object>> vendas = buildSessionVendas(orders);
            resp.put("vendas", vendas);

            // Add totals and metrics
            addSessionTotals(resp, movs, orders);
            addHistoricalMetricsSafely(status, resp);
            addFinalSessionData(resp, status);

            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao gerar relatório de reconciliação"));
        }
    }

    private java.util.Map<String, Object> buildBasicSessionInfo(CaixaStatus status) {
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", status.getId());
        resp.put(KEY_ABERTO, Boolean.TRUE.equals(status.getAberto()));
        resp.put(KEY_DATA_ABERTURA, status.getDataAbertura());
        resp.put(KEY_DATA_FECHAMENTO, status.getDataFechamento());
        resp.put(KEY_SALDO_INICIAL, status.getSaldoInicial());
        return resp;
    }

    private java.util.List<java.util.Map<String, Object>> buildSessionMovimentacoes(CaixaStatus status) {
        return movimentacaoRepository.findAllOrderByData().stream()
                .filter(m -> m.getCaixaStatus() != null && status.getId().equals(m.getCaixaStatus().getId()))
                .map(m -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("id", m.getId());
                    row.put("tipo", m.getTipo());
                    row.put(KEY_VALOR, m.getValor());
                    row.put(KEY_DESCRICAO, m.getDescricao());
                    row.put(KEY_USUARIO, m.getUsuario() != null ? m.getUsuario().getUsername() : null);
                    row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
                    return row;
                }).toList();
    }

    private java.util.List<com.example.backendspring.sale.SaleOrder> getSessionOrders(CaixaStatus status) {
        return saleOrderRepository.findAllOrderByData().stream()
                .filter(o -> o.getCaixaStatus() != null && status.getId().equals(o.getCaixaStatus().getId()))
                .toList();
    }

    private java.util.List<java.util.Map<String, Object>> buildSessionVendas(
            java.util.List<com.example.backendspring.sale.SaleOrder> orders) {
        return orders.stream().map(o -> {
            java.util.Map<String, Object> r = new java.util.LinkedHashMap<>();
            r.put("id", o.getId());
            r.put("data_venda", o.getDataVenda());
            r.put("total_final", o.getTotalFinal());
            r.put("operador", o.getOperador() != null ? o.getOperador().getUsername() : null);
            r.put("itens", o.getItens().stream().map(it -> {
                var im = new java.util.LinkedHashMap<String, Object>();
                im.put("produto_id", it.getProduto() != null ? it.getProduto().getId() : null);
                im.put(KEY_PRODUTO_NOME, it.getProduto() != null ? it.getProduto().getNome() : null);
                im.put("quantidade", it.getQuantidade());
                im.put("preco_unitario", it.getPrecoUnitario());
                im.put("preco_total", it.getPrecoTotal());
                return im;
            }).toList());
            r.put("pagamentos", o.getPagamentos().stream().map(p -> {
                var pm = new java.util.LinkedHashMap<String, Object>();
                pm.put("metodo", p.getMetodo());
                pm.put(KEY_VALOR, p.getValor());
                return pm;
            }).toList());
            return r;
        }).toList();
    }

    private void addSessionTotals(java.util.Map<String, Object> resp,
            java.util.List<java.util.Map<String, Object>> movs,
            java.util.List<com.example.backendspring.sale.SaleOrder> orders) {
        // Totals by payment method
        java.util.Map<String, Double> totalsByMetodo = new java.util.LinkedHashMap<>();
        orders.stream().flatMap(o -> o.getPagamentos().stream()).forEach(p -> {
            totalsByMetodo.putIfAbsent(p.getMetodo(), 0.0);
            totalsByMetodo.put(p.getMetodo(),
                    totalsByMetodo.get(p.getMetodo()) + (p.getValor() == null ? 0.0 : p.getValor()));
        });

        double totalEntradas = movs.stream().filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue()).sum();
        double totalRetiradas = movs.stream().filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue()).sum();

        resp.put("totals_by_metodo", totalsByMetodo);
        resp.put(KEY_SUM_ENTRADAS, totalEntradas);
        resp.put(KEY_SUM_RETIRADAS, totalRetiradas);
    }

    private void addFinalSessionData(java.util.Map<String, Object> resp, CaixaStatus status) {
        resp.put(KEY_SALDO_ESPERADO, status.getSaldoEsperado());
        resp.put(KEY_SALDO_CONTADO, status.getSaldoContado());
        resp.put(KEY_VARIACAO, status.getVariacao());
    }

    private String extractUsuarioNome(CaixaMovimentacao m) {
        try {
            if (m.getOperador() != null)
                return m.getOperador().getUsername();
        } catch (Exception ignored) {
            // Silently ignore errors accessing operator username
        }
        if (m.getUsuario() != null) {
            return m.getUsuario().getUsername();
        }
        return null;
    }

    /**
     * Calculates and adds historical metrics to the response map.
     */
    private void addHistoricalMetricsToResponse(CaixaStatus status, java.util.Map<String, Object> resp) {
        java.util.Map<String, Double> historicalMetrics = computeHistoricalMetrics(status);
        resp.put(KEY_CUMULATIVE_VARIACAO_BEFORE, historicalMetrics.get("cumulative_before"));
        resp.put("total_variacoes_positivas_before", 0.0); // Not directly available from historical metrics
        resp.put("total_variacoes_negativas_before", 0.0); // Not directly available from historical metrics
        resp.put("deficit_nao_reposto_before", 0.0); // Not directly available from historical metrics

        resp.put(KEY_CUMULATIVE_VARIACAO_ALL, historicalMetrics.get("cumulative_all"));
        resp.put("total_variacoes_positivas_all", 0.0); // Not directly available from historical metrics
        resp.put("total_variacoes_negativas_all", 0.0); // Not directly available from historical metrics
        resp.put("deficit_nao_reposto_all", 0.0); // Not directly available from historical metrics

        addDailySessionMetrics(status, resp);
    }

    /**
     * Safely adds historical metrics to the response, catching any computation
     * errors.
     */
    private void addHistoricalMetricsSafely(CaixaStatus status, java.util.Map<String, Object> resp) {
        try {
            addHistoricalMetricsToResponse(status, resp);
        } catch (Exception ignored) {
            // Expected: Historical metrics computation errors should not interrupt report
            // generation
        }
    }

    /**
     * Calculates and adds daily session metrics to the response.
     */
    private void addDailySessionMetrics(CaixaStatus status, java.util.Map<String, Object> resp) {
        final java.time.LocalDate sessionDay;
        if (status.getDataAbertura() != null) {
            sessionDay = status.getDataAbertura().toLocalDate();
        } else if (status.getDataFechamento() != null) {
            sessionDay = status.getDataFechamento().toLocalDate();
        } else {
            sessionDay = null;
        }

        if (sessionDay != null) {
            double dayVariacao = caixaStatusRepository.findAll().stream()
                    .filter(s -> isSessionOnDay(s, sessionDay))
                    .mapToDouble(s -> s.getVariacao() == null ? 0.0 : s.getVariacao())
                    .sum();
            double daySaldoInicial = caixaStatusRepository.findAll().stream()
                    .filter(s -> isSessionOnDay(s, sessionDay))
                    .mapToDouble(s -> s.getSaldoInicial() == null ? 0.0 : s.getSaldoInicial())
                    .sum();
            resp.put(KEY_DAY_VARIACAO_TOTAL, dayVariacao);
            resp.put(KEY_DAY_SALDO_INICIAL_TOTAL, daySaldoInicial);
        }
    }

    /**
     * Checks if a CaixaStatus session occurred on the specified day.
     */
    private boolean isSessionOnDay(CaixaStatus s, java.time.LocalDate sessionDay) {
        return (s.getDataAbertura() != null && s.getDataAbertura().toLocalDate().equals(sessionDay))
                || (s.getDataFechamento() != null && s.getDataFechamento().toLocalDate().equals(sessionDay));
    }

    /**
     * Calculates the expected balance for a session.
     */
    private double calculateExpectedForSession(CaixaStatus sess) {
        final Long sessionId = sess.getId();
        double movimentacoesSessao = 0.0;
        try {
            movimentacoesSessao = movimentacaoRepository.findAllOrderByData().stream()
                    .filter(m -> m.getCaixaStatus() != null && sessionId != null
                            && sessionId.equals(m.getCaixaStatus().getId()))
                    .mapToDouble(m -> {
                        double valor = m.getValor() == null ? 0.0 : m.getValor();
                        return TIPO_ENTRADA.equals(m.getTipo()) ? valor : -valor;
                    })
                    .sum();
        } catch (Exception ignored) {
            // Expected: Database or processing errors should not interrupt session
            // calculation
        }

        // Caixa saldo deve ser calculado a partir das movimentações registradas
        // (entradas/retiradas)
        // e do saldo inicial. Não somamos separadamente pagamentos de vendas aqui para
        // evitar
        // dupla contagem — as vendas geram movimentações quando apropriado.
        return (sess.getSaldoInicial() == null ? 0.0 : sess.getSaldoInicial()) + movimentacoesSessao;
    }

    /**
     * Calcula métricas históricas (cumulativos e agregados por dia) usando datas.
     */
    private java.util.Map<String, Double> computeHistoricalMetrics(CaixaStatus sess) {
        java.util.Map<String, Double> m = new java.util.LinkedHashMap<>();
        try {
            var all = caixaStatusRepository.findAll().stream().toList();
            final Long currentId = sess.getId();
            double beforeSum = all.stream()
                    .filter(s -> s.getId() != null && currentId != null && s.getId() < currentId)
                    .mapToDouble(s -> s.getVariacao() == null ? 0.0 : s.getVariacao())
                    .sum();
            double allSum = all.stream().mapToDouble(s -> s.getVariacao() == null ? 0.0 : s.getVariacao()).sum();
            m.put("cumulative_before", beforeSum);
            m.put("cumulative_all", allSum);
        } catch (Exception ignored) {
            // Expected: Database or computation errors should return empty metrics
        }
        return m;
    }

    @Data
    public static class HorariosRequest {
        private String horarioAberturaObrigatorio;
        private String horarioFechamentoObrigatorio;
    }

    @Data
    public static class FecharRequest {
        private Double saldoContado;
        private Long sessionId; // opcional: fechar sessão específica
        private String observacoes;
    }

    @lombok.Data
    public static class MovimentacaoRequest {
        private String tipo; // entrada | retirada
        private Double valor;
        private String descricao;
        private String motivo;
    }

    @DeleteMapping("/movimentacoes/{id}")
    @Transactional
    public ResponseEntity<Map<String, Object>> deleteMovimentacao(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @PathVariable("id") Long id) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var u = userRepository.findById(userId).orElse(null);
        if (u == null || u.getRole() == null || !u.getRole().equals(VALOR_ADMIN)) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, MSG_PERMISSAO_NEGADA));
        }
        try {
            var movOpt = movimentacaoRepository.findById(id);
            if (movOpt.isEmpty())
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Movimentação não encontrada"));
            movimentacaoRepository.deleteById(id);
            return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Movimentação excluída com sucesso"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao excluir movimentação"));
        }
    }

    /**
     * Force delete: desvincula movimentacoes e vendas da sessao e exclui a sessao.
     * Apenas admin. Use com cuidado (reescrever histórico de sessão).
     */
    @PostMapping("/sessoes/{id}/force-delete")
    @Transactional
    public ResponseEntity<Map<String, Object>> forceDeleteSessao(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @PathVariable("id") Long id) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var u = userRepository.findById(userId).orElse(null);
        if (u == null || u.getRole() == null || !u.getRole().equals(VALOR_ADMIN)) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, MSG_PERMISSAO_NEGADA));
        }
        try {
            var opt = caixaStatusRepository.findById(id);
            if (opt.isEmpty())
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, MSG_SESSAO_NAO_ENCONTRADA));
            var sess = opt.get();
            if (Boolean.TRUE.equals(sess.getAberto()))
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Não é possível excluir sessão aberta"));

            log.info("forceDeleteSessao: unlinking dependents for session {} by user {}", id, userId);
            int movUnlinked = em
                    .createNativeQuery(
                            "UPDATE caixa_movimentacoes SET caixa_status_id = NULL WHERE caixa_status_id = ?")
                    .setParameter(1, id).executeUpdate();
            int ordersUnlinked = em
                    .createNativeQuery("UPDATE venda_cabecalho SET caixa_status_id = NULL WHERE caixa_status_id = ?")
                    .setParameter(1, id).executeUpdate();
            log.info("forceDeleteSessao: unlinked movimentacoes={}, orders={}", movUnlinked, ordersUnlinked);

            // audit: record who requested the force delete and timestamp
            em.createNativeQuery(
                    "INSERT INTO admin_audit(action, target_table, target_id, performed_by, details, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
                    .setParameter(1, "force_delete_session")
                    .setParameter(2, "status_caixa")
                    .setParameter(3, id)
                    .setParameter(4, userId)
                    .setParameter(5,
                            "unlinked_mov=" + movUnlinked + ", unlinked_orders=" + ordersUnlinked)
                    .executeUpdate();

            caixaStatusRepository.deleteById(id);
            em.flush();
            if (caixaStatusRepository.existsById(id)) {
                log.warn("forceDeleteSessao: still exists after delete {}", id);
                return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao excluir sessão (persistência)"));
            }
            return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Sessão excluída com sucesso", "mov_unlinked", movUnlinked,
                    "orders_unlinked", ordersUnlinked));
        } catch (Exception e) {
            log.error("forceDeleteSessao: exception deleting {}", id, e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao excluir sessão: " + e.getMessage()));
        }
    }

    // Helper methods for reducing method complexity

    /**
     * Calculates timestamp bounds based on date parameters and time range.
     * Returns TimestampBounds with fromTs and toTs properly configured.
     */
    private TimestampBounds calculateTimestampBounds(java.time.LocalDate dia,
            java.time.LocalDate inicio,
            java.time.LocalDate fim,
            java.time.LocalTime tIni,
            java.time.LocalTime tFim,
            String from,
            String to) {
        java.time.OffsetDateTime fromTs = parseTimestampSafely(from);
        java.time.OffsetDateTime toTs = parseTimestampSafely(to);

        // If the client provided a date/period plus hora_inicio/hora_fim, build
        // precise fromTs/toTs in America/Sao_Paulo to avoid timezone mismatches
        try {
            TimestampBounds bounds = calculateDateBasedBounds(dia, inicio, fim, tIni, tFim);
            fromTs = bounds.fromTs != null ? bounds.fromTs : fromTs;
            toTs = bounds.toTs != null ? bounds.toTs : toTs;

            // Log computed OffsetDateTime bounds for debugging timezone issues
            if (fromTs != null || toTs != null) {
                log.debug("calculateTimestampBounds: computed fromTs={} toTs={}", fromTs, toTs);
            }
        } catch (Exception ignored) {
            // Ignore timezone conversion errors
        }

        return new TimestampBounds(fromTs, toTs);
    }

    /**
     * Calculates timestamp bounds based on date ranges and time constraints.
     */
    private TimestampBounds calculateDateBasedBounds(java.time.LocalDate dia,
            java.time.LocalDate inicio,
            java.time.LocalDate fim,
            java.time.LocalTime tIni,
            java.time.LocalTime tFim) {
        java.time.ZoneId sp = java.time.ZoneId.of(TIMEZONE_SAO_PAULO);
        java.time.OffsetDateTime fromTs = null;
        java.time.OffsetDateTime toTs = null;

        if (dia != null) {
            TimestampBounds dayBounds = calculateSingleDayBounds(dia, tIni, tFim, sp);
            fromTs = dayBounds.fromTs;
            toTs = dayBounds.toTs;
        } else if (inicio != null && fim != null) {
            TimestampBounds rangeBounds = calculateDateRangeBounds(inicio, fim, tIni, tFim, sp);
            fromTs = rangeBounds.fromTs;
            toTs = rangeBounds.toTs;
        }

        return new TimestampBounds(fromTs, toTs);
    }

    /**
     * Calculates bounds for a single day with optional time constraints.
     */
    private TimestampBounds calculateSingleDayBounds(java.time.LocalDate dia,
            java.time.LocalTime tIni,
            java.time.LocalTime tFim,
            java.time.ZoneId sp) {
        java.time.OffsetDateTime fromTs = null;
        java.time.OffsetDateTime toTs = null;

        if (tIni == null && tFim == null) {
            var zdtFrom = java.time.ZonedDateTime.of(dia, java.time.LocalTime.MIDNIGHT, sp);
            var zdtTo = java.time.ZonedDateTime.of(dia.plusDays(1), java.time.LocalTime.MIDNIGHT, sp).minusNanos(1);
            fromTs = zdtFrom.toOffsetDateTime();
            toTs = zdtTo.toOffsetDateTime();
        } else {
            if (tIni != null) {
                var zdt = java.time.ZonedDateTime.of(dia, tIni, sp);
                fromTs = zdt.toOffsetDateTime();
            }
            if (tFim != null) {
                var zdt2 = java.time.ZonedDateTime.of(dia, tFim, sp);
                toTs = zdt2.toOffsetDateTime();
            }
        }

        return new TimestampBounds(fromTs, toTs);
    }

    /**
     * Calculates bounds for a date range with optional time constraints.
     */
    private TimestampBounds calculateDateRangeBounds(java.time.LocalDate inicio,
            java.time.LocalDate fim,
            java.time.LocalTime tIni,
            java.time.LocalTime tFim,
            java.time.ZoneId sp) {
        java.time.OffsetDateTime fromTs = null;
        java.time.OffsetDateTime toTs = null;

        if (tIni == null && tFim == null) {
            var zdtFrom = java.time.ZonedDateTime.of(inicio, java.time.LocalTime.MIDNIGHT, sp);
            var zdtTo = java.time.ZonedDateTime.of(fim.plusDays(1), java.time.LocalTime.MIDNIGHT, sp).minusNanos(1);
            fromTs = zdtFrom.toOffsetDateTime();
            toTs = zdtTo.toOffsetDateTime();
        } else {
            if (tIni != null) {
                var zdt = java.time.ZonedDateTime.of(inicio, tIni, sp);
                fromTs = zdt.toOffsetDateTime();
            }
            if (tFim != null) {
                var zdt2 = java.time.ZonedDateTime.of(fim, tFim, sp);
                toTs = zdt2.toOffsetDateTime();
            }
        }

        return new TimestampBounds(fromTs, toTs);
    }

    /**
     * Safely parses a timestamp string, returning null if parsing fails.
     */
    private java.time.OffsetDateTime parseTimestampSafely(String timestamp) {
        if (timestamp == null || timestamp.isBlank()) {
            return null;
        }
        try {
            return java.time.OffsetDateTime.parse(timestamp);
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * Simple data class to hold timestamp bounds.
     */
    private static class TimestampBounds {
        final java.time.OffsetDateTime fromTs;
        final java.time.OffsetDateTime toTs;

        TimestampBounds(java.time.OffsetDateTime fromTs, java.time.OffsetDateTime toTs) {
            this.fromTs = fromTs;
            this.toTs = toTs;
        }
    }

    /**
     * Helper method to call listarMovimentacoes logic without @Transactional
     * annotation. This avoids self-invocation issues with Spring proxies.
     */
    private ResponseEntity<java.util.Map<String, Object>> getMovimentacoesDirectly(
            MovimentacoesQueryParams params) {
        // This implementation intentionally avoids the @Transactional annotation
        // to prevent Spring proxy self-invocation issues
        return executeMovimentacoesQuery(params);
    }

    /**
     * Non-transactional implementation of movimentacoes listing logic.
     * This method contains the core business logic without transactional
     * boundaries.
     */
    private ResponseEntity<java.util.Map<String, Object>> executeMovimentacoesQuery(
            MovimentacoesQueryParams params) {
        try {
            java.time.LocalDate dia = null;
            java.time.LocalDate inicio = null;
            java.time.LocalDate fim = null;

            // Parse date parameters from the simplified parameter object
            if (params.periodoInicio != null && params.periodoFim != null) {
                inicio = java.time.LocalDate.parse(params.periodoInicio);
                fim = java.time.LocalDate.parse(params.periodoFim);
            }

            java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

            // Build data using simplified logic for this parameter object
            lista.addAll(buildManualMovRows(dia, inicio, fim));
            lista.addAll(buildSaleOrderRows(dia, inicio, fim));

            lista = sortByDataMovimentoDesc(lista);
            // Since we removed tipo/metodoPagamento from params, pass null for these
            // filters
            var filtrada = applyFilters(lista, null, null, null, null);

            int pageNum = (params.page == null || params.page < 1) ? 1 : params.page;
            int pageSize = (params.size == null || params.size < 1) ? 20 : params.size;
            int fromIndex = (pageNum - 1) * pageSize;

            if (fromIndex >= filtrada.size()) {
                return ResponseEntity.ok(java.util.Map.of(
                        KEY_ITEMS, java.util.List.of(),
                        KEY_TOTAL, filtrada.size(),
                        KEY_HAS_NEXT, false,
                        KEY_PAGE, pageNum,
                        KEY_SIZE, pageSize));
            }

            int toIndex = Math.min(fromIndex + pageSize, filtrada.size());
            var paged = filtrada.subList(fromIndex, toIndex);
            boolean hasNext = toIndex < filtrada.size();

            java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put(KEY_ITEMS, paged);
            body.put(KEY_TOTAL, filtrada.size());
            body.put(KEY_HAS_NEXT, hasNext);
            body.put(KEY_PAGE, pageNum);
            body.put(KEY_SIZE, pageSize);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            log.error("executeMovimentacoesQuery: failed to execute query", e);
            return ResponseEntity.status(500).body(java.util.Map.of(
                    KEY_ERROR, "Falha ao executar consulta de movimentações",
                    KEY_ITEMS, java.util.List.of(),
                    KEY_TOTAL, 0,
                    KEY_HAS_NEXT, false,
                    KEY_PAGE, 1,
                    KEY_SIZE, 20));
        }
    }

    // NOTE: dbg-delete removed from production. Keep force-delete for admin use.
}
