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
            java.time.LocalDate dia = null;
            java.time.LocalDate inicio = null;
            java.time.LocalDate fim = null;
            if (data != null && !data.isBlank()) {
                dia = java.time.LocalDate.parse(data);
            } else if (periodoInicio != null && periodoFim != null) {
                inicio = java.time.LocalDate.parse(periodoInicio);
                fim = java.time.LocalDate.parse(periodoFim);
            }
            // Debug: when client requests all, log repository counts for the requested
            // range
            logRepositoryCountsForDebug(all, dia, inicio, fim, from, to);
            log.debug(
                    "listarMovimentacoes: request params data={} periodo_inicio={} periodo_fim={} from={} to={} all={} tipo={} metodo_pagamento={} hora_inicio={} hora_fim={} page={} size={}",
                    data, periodoInicio, periodoFim, from, to, all, tipo, metodoPagamento, horaInicio, horaFim, page,
                    size);
            java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

            var tIni = safeParseLocalTime(horaInicio);
            var tFim = safeParseLocalTime(horaFim);

            // Calculate timestamp bounds using extracted helper method
            TimestampBounds bounds = calculateTimestampBounds(dia, inicio, fim, tIni, tFim, from, to);
            java.time.OffsetDateTime fromTs = bounds.fromTs;
            java.time.OffsetDateTime toTs = bounds.toTs;

            // If a timestamp range was provided, prefer database queries (timestamp-aware)
            // to avoid fetching all records and filtering in memory. This improves
            // performance and ensures consistent timezone handling.
            if (fromTs != null || toTs != null) {
                final java.time.OffsetDateTime fFrom = fromTs;
                final java.time.OffsetDateTime fTo = toTs;

                // Movimentações no período via DB
                try {
                    var movs = movimentacaoRepository.findByPeriodoTimestamps(fFrom, fTo);
                    for (var m : movs) {
                        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                        row.put("id", m.getId());
                        row.put(KEY_CAIXA_STATUS_ID, m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
                        row.put("tipo", m.getTipo());
                        row.put(KEY_VALOR, m.getValor());
                        row.put(KEY_DESCRICAO, m.getDescricao());
                        String usuarioNome = extractUsuarioNome(m);
                        row.put(KEY_USUARIO, usuarioNome);
                        row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
                        lista.add(row);
                    }
                } catch (Exception e) {
                    log.warn("listarMovimentacoes: DB movs query failed, falling back to in-memory", e);
                    lista.addAll(buildManualMovRows(dia, inicio, fim));
                }

                // Vendas no período via DB
                try {
                    var orders = saleOrderRepository.findByPeriodoTimestampsRaw(fFrom, fTo);
                    for (var vo : orders) {
                        for (var pg : vo.getPagamentos()) {
                            // Skip sale payment rows for cash payments that already generated
                            // caixa_movimentacao to avoid double-counting. We detect this by
                            // checking if payment is cash and linked to a caixa_status.
                            // Previously we skipped cash payments already linked to a caixa_status
                            // to avoid double-counting. Per business decision, include all sale
                            // payment rows here so 'tudo' and period views count all sales and
                            // the caixa session records remain an audit artifact.
                            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                            row.put("id", vo.getId());
                            row.put("tipo", TIPO_VENDA);
                            row.put(KEY_VALOR, pg.getValor());
                            row.put(KEY_PAGAMENTO_VALOR, pg.getValor());
                            row.put(KEY_TOTAL_VENDA, vo.getTotalFinal());
                            var nf = java.text.NumberFormat
                                    .getCurrencyInstance(java.util.Locale.forLanguageTag(LOCALE_PT_BR));
                            String totalFmt = nf.format(vo.getTotalFinal());
                            boolean multi = vo.getPagamentos().size() > 1;
                            if (multi) {
                                String breakdown = vo.getPagamentos().stream()
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
                                row.put(KEY_DESCRICAO, LABEL_VENDA_MULTI_PREFIX + totalFmt + " - " + breakdown);
                            } else {
                                String single = LABEL_VENDA_TOTAL + totalFmt + " ("
                                        + labelMetodoPagamento(pg.getMetodo()) + " " + nf.format(pg.getValor()) + ")";
                                if (pg.getValor() != null && pg.getValor() < 0)
                                    single += LABEL_DEVOLVIDO_SUFFIX;
                                row.put(KEY_DESCRICAO, single);
                            }
                            row.put(KEY_PRODUTO_NOME,
                                    vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
                            row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
                            row.put(KEY_USUARIO, vo.getOperador() != null ? vo.getOperador().getUsername() : null);
                            row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
                            row.put(KEY_CAIXA_STATUS_ID,
                                    vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
                            lista.add(row);
                        }
                    }
                } catch (Exception e) {
                    log.warn("listarMovimentacoes: DB orders query failed, falling back to in-memory", e);
                    lista.addAll(buildSaleOrderRows(dia, inicio, fim));
                }

                // Deduplicate by id while preserving order
                java.util.Map<Object, java.util.Map<String, Object>> byId = new java.util.LinkedHashMap<>();
                for (var m : lista) {
                    Object idObj = m.get("id");
                    if (idObj == null) {
                        idObj = (m.get(KEY_DATA_MOVIMENTO) == null ? java.util.UUID.randomUUID().toString()
                                : m.get(KEY_DATA_MOVIMENTO).toString() + "|" + m.get(KEY_DESCRICAO));
                    } else {
                        // Preserve separate rows for multi-payment sales by including
                        // payment method/value in the dedupe key so they are not
                        // collapsed into a single entry.
                        try {
                            if (TIPO_VENDA.equals(m.get("tipo"))) {
                                Object metodo = m.get(KEY_METODO_PAGAMENTO);
                                Object pgVal = m.get(KEY_PAGAMENTO_VALOR);
                                idObj = idObj.toString() + "|" + (metodo == null ? "" : metodo.toString()) + "|"
                                        + (pgVal == null ? "" : pgVal.toString());
                            }
                        } catch (Exception ignored) {
                            // Silently ignore errors constructing composite ID for deduplication
                        }
                    }
                    if (!byId.containsKey(idObj))
                        byId.put(idObj, m);
                }
                lista = new java.util.ArrayList<>(byId.values());

                // debug instants
                try {
                    var sampleInst = lista.stream().limit(6).map(m -> {
                        try {
                            var odt = (java.time.OffsetDateTime) m.get(KEY_DATA_MOVIMENTO);
                            return odt == null ? "null" : odt.toInstant().toString();
                        } catch (Exception ex) {
                            return "err";
                        }
                    }).toList();
                    log.debug("listarMovimentacoes: after-db-instant-fetch count={} sampleInst={}", lista.size(),
                            sampleInst);
                } catch (Exception ignored) {
                    // Silently ignore debug logging errors
                }
            } else {
                // No timestamp range provided — fallback to original behavior: fetch by
                // date/period or all
                lista.addAll(buildManualMovRows(dia, inicio, fim));
                lista.addAll(buildSaleOrderRows(dia, inicio, fim));
            }

            // Ordenar por data_movimento desc
            lista = sortByDataMovimentoDesc(lista);

            // Debug: when hora filters are used, log samples to diagnose timezone issues
            if (tIni != null || tFim != null) {
                try {
                    var sample = lista.stream().limit(6).map(m -> {
                        try {
                            var odt = (java.time.OffsetDateTime) m.get(KEY_DATA_MOVIMENTO);
                            if (odt == null)
                                return "null";
                            try {
                                return odt.atZoneSameInstant(java.time.ZoneId.of(TIMEZONE_SAO_PAULO)).toLocalTime()
                                        .toString();
                            } catch (Exception ex) {
                                return odt.toLocalTime().toString();
                            }
                        } catch (Exception e) {
                            return "err";
                        }
                    }).toList();
                    log.debug("listarMovimentacoes: pre-local-time-filter count={} sampleTimes={}", lista.size(),
                            sample);
                } catch (Exception ignored) {
                    // Silently ignore debug logging errors for time filtering
                }
            }

            // Filtros opcionais por tipo, método e faixa horária (local-time)
            var filtrada = applyFilters(lista, tipo, metodoPagamento, tIni, tFim);
            log.debug("listarMovimentacoes: after-local-time-filter count={}", filtrada.size());

            // If client requested aggregations only, return sums without fetching pages
            if (Boolean.TRUE.equals(aggs)) {
                double sumEntradasAgg = filtrada.stream()
                        .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                        .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                        .sum();
                double sumRetiradasAgg = filtrada.stream()
                        .filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                        .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                        .sum();
                // Avoid double-counting: when a cash sale generated an explicit
                // caixa_movimentacao
                // (entrada) we should not count the sale payment row again as a separate venda
                // in the aggregates. Build a set of (caixa_status_id|valor) keys for entrada
                // rows
                // and skip venda rows that match.
                java.util.Set<String> entradaCashKeys = filtrada.stream()
                        .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                        .filter(m -> m.get(KEY_CAIXA_STATUS_ID) != null && m.get(KEY_VALOR) != null)
                        .map(m -> m.get(KEY_CAIXA_STATUS_ID).toString() + "|"
                                + Double.toString(((Number) m.get(KEY_VALOR)).doubleValue()))
                        .collect(java.util.stream.Collectors.toSet());

                double sumVendasAgg = filtrada.stream().filter(m -> TIPO_VENDA.equals(m.get("tipo"))).mapToDouble(m -> {
                    try {
                        Object metodo = m.get(KEY_METODO_PAGAMENTO);
                        Object caixaId = m.get(KEY_CAIXA_STATUS_ID);
                        double val = ((Number) m.get(KEY_VALOR)).doubleValue();
                        if (VALOR_DINHEIRO.equals(metodo) && caixaId != null) {
                            String key = caixaId.toString() + "|" + Double.toString(val);
                            if (entradaCashKeys.contains(key)) {
                                return 0.0; // skip duplicate
                            }
                        }
                        return val;
                    } catch (Exception e) {
                        return 0.0;
                    }
                }).sum();
                // Diagnostic log to help compare server-side aggregates vs frontend
                log.debug(
                        "DIAG_CAIXA_AGGS: periodoInicio={} periodoFim={} tipo={} metodo_pagamento={} -> sums: entradas={} retiradas={} vendas={} totalItems={}",
                        periodoInicio, periodoFim, tipo, metodoPagamento, sumEntradasAgg, sumRetiradasAgg, sumVendasAgg,
                        filtrada.size());
                // Also calculate net vendas using adjusted_total when available
                double sumVendasNet = 0.0;
                try {
                    sumVendasNet = filtrada.stream()
                            .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                            .mapToDouble(m -> {
                                try {
                                    Object adj = m.get("adjusted_total");
                                    if (adj instanceof Number)
                                        return ((Number) adj).doubleValue();
                                } catch (Exception ignored) {
                                    // Silently ignore errors accessing adjusted_total field
                                }
                                try {
                                    return ((Number) m.get(KEY_VALOR)).doubleValue();
                                } catch (Exception e) {
                                    return 0.0;
                                }
                            }).sum();
                } catch (Exception ignored) {
                    // Silently ignore aggregation calculation errors
                }
                // Detalhar entradas automáticas (geradas por vendas) vs manuais
                double sumEntradasAuto = 0.0;
                try {
                    sumEntradasAuto = filtrada.stream()
                            .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                            .filter(m -> {
                                try {
                                    Object d = m.get(KEY_DESCRICAO);
                                    if (d == null)
                                        return false;
                                    String s = d.toString().toLowerCase();
                                    return s.contains(TIPO_VENDA);
                                } catch (Exception e) {
                                    return false;
                                }
                            })
                            .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                            .sum();
                } catch (Exception ignored) {
                }
                double sumEntradasManuais = Math.max(0.0, sumEntradasAgg - sumEntradasAuto);

                java.util.Map<String, Object> aggsMap = new java.util.LinkedHashMap<>();
                aggsMap.put(KEY_SUM_ENTRADAS, sumEntradasAgg);
                aggsMap.put(KEY_SUM_RETIRADAS, sumRetiradasAgg);
                aggsMap.put(KEY_SUM_VENDAS, sumVendasAgg);
                aggsMap.put("sum_vendas_net", sumVendasNet);
                aggsMap.put(KEY_SUM_ENTRADAS_AUTOMATICAS, sumEntradasAuto);
                aggsMap.put(KEY_SUM_ENTRADAS_MANUAIS, sumEntradasManuais);
                aggsMap.put(KEY_TOTAL, filtrada.size());
                return ResponseEntity.ok(aggsMap);
            }

            // If client requested all matching items (no pagination), return them
            // in a single response. Useful for UIs that need client-side
            // filtering/aggregation without fetching pages.
            if (Boolean.TRUE.equals(all)) {
                java.util.Map<String, Object> bodyAll = new java.util.LinkedHashMap<>();
                bodyAll.put(KEY_ITEMS, filtrada);
                bodyAll.put(KEY_TOTAL, filtrada.size());
                bodyAll.put(KEY_HAS_NEXT, false);
                bodyAll.put(KEY_PAGE, 1);
                bodyAll.put(KEY_SIZE, filtrada.size());
                double sumEntradasAll = filtrada.stream()
                        .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                        .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                        .sum();
                double sumRetiradasAll = filtrada.stream()
                        .filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                        .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                        .sum();
                double sumVendasAll = filtrada.stream()
                        .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                        .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                        .sum();
                double sumEntradasAutoAll = 0.0;
                try {
                    sumEntradasAutoAll = filtrada.stream()
                            .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                            .filter(m -> {
                                try {
                                    Object d = m.get(KEY_DESCRICAO);
                                    if (d == null)
                                        return false;
                                    String s = d.toString().toLowerCase();
                                    return s.contains(TIPO_VENDA);
                                } catch (Exception e) {
                                    return false;
                                }
                            })
                            .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                            .sum();
                } catch (Exception ignored) {
                }
                double sumEntradasManuaisAll = Math.max(0.0, sumEntradasAll - sumEntradasAutoAll);
                bodyAll.put(KEY_SUM_ENTRADAS, sumEntradasAll);
                bodyAll.put(KEY_SUM_RETIRADAS, sumRetiradasAll);
                bodyAll.put(KEY_SUM_VENDAS, sumVendasAll);
                bodyAll.put(KEY_SUM_ENTRADAS_AUTOMATICAS, sumEntradasAutoAll);
                bodyAll.put(KEY_SUM_ENTRADAS_MANUAIS, sumEntradasManuaisAll);
                return ResponseEntity.ok(bodyAll);
            }

            // Somatórios no período filtrado
            double sumEntradas = filtrada.stream()
                    .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                    .sum();
            double sumRetiradas = filtrada.stream()
                    .filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                    .sum();
            double sumVendas = filtrada.stream()
                    .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                    .sum();

            // Paginação simples em memória
            int pageNum = (page == null || page < 1) ? 1 : page;
            int pageSize = (size == null || size < 1) ? 20 : size;
            int fromIndex = (pageNum - 1) * pageSize;
            if (fromIndex >= filtrada.size()) {
                return ResponseEntity.ok(java.util.Map.of(
                        KEY_ITEMS, java.util.List.of(),
                        KEY_TOTAL, filtrada.size(),
                        KEY_HAS_NEXT, false,
                        KEY_PAGE, pageNum,
                        KEY_SIZE, pageSize,
                        KEY_SUM_ENTRADAS, sumEntradas,
                        KEY_SUM_RETIRADAS, sumRetiradas,
                        KEY_SUM_VENDAS, sumVendas));
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
            body.put(KEY_SUM_ENTRADAS, sumEntradas);
            body.put(KEY_SUM_RETIRADAS, sumRetiradas);
            body.put(KEY_SUM_VENDAS, sumVendas);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            // Em caso de erro, retornar lista vazia para não quebrar o frontend
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
            java.time.ZoneId sp = java.time.ZoneId.of(TIMEZONE_SAO_PAULO);
            var zdtFrom = java.time.ZonedDateTime.of(dia, java.time.LocalTime.MIDNIGHT, sp);
            var zdtTo = java.time.ZonedDateTime.of(dia.plusDays(1), java.time.LocalTime.MIDNIGHT, sp).minusNanos(1);
            java.time.OffsetDateTime fromTs = zdtFrom.toOffsetDateTime();
            java.time.OffsetDateTime toTs = zdtTo.toOffsetDateTime();

            java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();

            // movs via DB
            try {
                var movs = movimentacaoRepository.findByPeriodoTimestamps(fromTs, toTs);
                for (var m : movs) {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("id", m.getId());
                    row.put(KEY_CAIXA_STATUS_ID, m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
                    row.put("tipo", m.getTipo());
                    row.put(KEY_VALOR, m.getValor());
                    row.put(KEY_DESCRICAO, m.getDescricao());
                    String usuarioNome = null;
                    try {
                        if (m.getOperador() != null)
                            usuarioNome = m.getOperador().getUsername();
                    } catch (Exception ignored) {
                    }
                    if (usuarioNome == null && m.getUsuario() != null) {
                        usuarioNome = m.getUsuario().getUsername();
                    }
                    row.put(KEY_USUARIO, usuarioNome);
                    row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
                    lista.add(row);
                }
            } catch (Exception e) {
                log.warn("listarMovimentacoes/dia: movs query failed", e);
                lista.addAll(buildManualMovRows(dia, null, null));
            }

            // orders via DB — build rows the same way as the main listing so
            // 'dia' matches 'tudo' formatting (including multi-payment breakdown)
            try {
                var orders = saleOrderRepository.findByPeriodoTimestampsRaw(fromTs, toTs);
                for (var vo : orders) {
                    for (var pg : vo.getPagamentos()) {
                        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                        row.put("id", vo.getId());
                        row.put("tipo", TIPO_VENDA);
                        row.put(KEY_VALOR, pg.getValor());
                        row.put(KEY_PAGAMENTO_VALOR, pg.getValor());
                        row.put(KEY_TOTAL_VENDA, vo.getTotalFinal());
                        var nf = java.text.NumberFormat
                                .getCurrencyInstance(java.util.Locale.forLanguageTag(LOCALE_PT_BR));
                        String totalFmt = nf.format(vo.getTotalFinal());
                        boolean multi = vo.getPagamentos().size() > 1;
                        if (multi) {
                            String breakdown = vo.getPagamentos().stream()
                                    .map(p -> labelMetodoPagamento(p.getMetodo()) + " " + nf.format(p.getValor()))
                                    .collect(java.util.stream.Collectors.joining(" | "));
                            row.put(KEY_DESCRICAO, LABEL_VENDA_MULTI_PREFIX + totalFmt + " - " + breakdown);
                        } else {
                            row.put(KEY_DESCRICAO,
                                    LABEL_VENDA_TOTAL + totalFmt + " (" + labelMetodoPagamento(pg.getMetodo()) + " "
                                            + nf.format(pg.getValor()) + ")");
                        }
                        row.put(KEY_PRODUTO_NOME,
                                vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
                        row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
                        row.put(KEY_USUARIO, vo.getOperador() != null ? vo.getOperador().getUsername() : null);
                        row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
                        row.put(KEY_CAIXA_STATUS_ID, vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
                        lista.add(row);
                    }
                }
            } catch (Exception e) {
                log.warn("listarMovimentacoes/dia: orders query failed", e);
                lista.addAll(buildSaleOrderRows(dia, null, null));
            }

            // dedupe and sort
            java.util.Map<Object, java.util.Map<String, Object>> byId = new java.util.LinkedHashMap<>();
            for (var m : lista) {
                Object idObj = m.get("id");
                if (idObj == null) {
                    idObj = (m.get(KEY_DATA_MOVIMENTO) == null ? java.util.UUID.randomUUID().toString()
                            : m.get(KEY_DATA_MOVIMENTO).toString() + "|" + m.get(KEY_DESCRICAO));
                }
                if (!byId.containsKey(idObj))
                    byId.put(idObj, m);
            }
            lista = new java.util.ArrayList<>(byId.values());
            lista = sortByDataMovimentoDesc(lista);

            java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put(KEY_ITEMS, lista);
            body.put(KEY_TOTAL, lista.size());
            body.put(KEY_HAS_NEXT, false);
            body.put(KEY_PAGE, 1);
            body.put(KEY_SIZE, lista.size());
            double sumEntradasAll = lista.stream()
                    .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) (m.get(KEY_VALOR) == null ? 0 : m.get(KEY_VALOR))).doubleValue())
                    .sum();
            double sumRetiradasAll = lista.stream()
                    .filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) (m.get(KEY_VALOR) == null ? 0 : m.get(KEY_VALOR))).doubleValue())
                    .sum();

            // Avoid double-counting cash: build keys of entrada rows
            // (caixa_status_id|valor)
            java.util.Set<String> entradaCashKeysAll = lista.stream()
                    .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                    .filter(m -> m.get(KEY_CAIXA_STATUS_ID) != null && m.get(KEY_VALOR) != null)
                    .map(m -> m.get(KEY_CAIXA_STATUS_ID).toString() + "|"
                            + Double.toString(((Number) m.get(KEY_VALOR)).doubleValue()))
                    .collect(java.util.stream.Collectors.toSet());

            double sumVendasAll = lista.stream().filter(m -> TIPO_VENDA.equals(m.get("tipo"))).mapToDouble(m -> {
                try {
                    Object metodo = m.get(KEY_METODO_PAGAMENTO);
                    Object caixaId = m.get(KEY_CAIXA_STATUS_ID);
                    double val = ((Number) (m.get(KEY_VALOR) == null ? 0 : m.get(KEY_VALOR))).doubleValue();
                    if (VALOR_DINHEIRO.equals(metodo) && caixaId != null) {
                        String key = caixaId.toString() + "|" + Double.toString(val);
                        if (entradaCashKeysAll.contains(key)) {
                            return 0.0; // skip duplicate
                        }
                    }
                    return val;
                } catch (Exception e) {
                    return 0.0;
                }
            }).sum();
            body.put(KEY_SUM_ENTRADAS, sumEntradasAll);
            body.put(KEY_SUM_RETIRADAS, sumRetiradasAll);
            body.put(KEY_SUM_VENDAS, sumVendasAll);
            try {
                double sumEntradasAutoDia = lista.stream()
                        .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                        .filter(m -> {
                            try {
                                Object d = m.get(KEY_DESCRICAO);
                                if (d == null)
                                    return false;
                                String s = d.toString().toLowerCase();
                                return s.contains(TIPO_VENDA);
                            } catch (Exception e) {
                                return false;
                            }
                        })
                        .mapToDouble(m -> ((Number) (m.get(KEY_VALOR) == null ? 0 : m.get(KEY_VALOR))).doubleValue())
                        .sum();
                double sumEntradasManuaisDia = Math.max(0.0, sumEntradasAll - sumEntradasAutoDia);
                body.put(KEY_SUM_ENTRADAS_AUTOMATICAS, sumEntradasAutoDia);
                body.put(KEY_SUM_ENTRADAS_MANUAIS, sumEntradasManuaisDia);
            } catch (Exception ignored) {
            }
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            log.error("listarMovimentacoes/dia: exception", e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, MSG_FALHA_LISTAR_DIA));
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
            try {
                // Use helper method to avoid self-invocation of @Transactional method
                MovimentacoesQueryParams params = MovimentacoesQueryParams.builder()
                        .periodoInicio(inicio.toString())
                        .periodoFim(fim.toString())
                        .page(page == null ? 1 : page)
                        .size(size == null ? 20 : size)
                        .build();
                return getMovimentacoesDirectly(params);
            } catch (Exception ex) {
                // Fallback to LocalDate path if timezone conversion fails
                MovimentacoesQueryParams fallbackParams = MovimentacoesQueryParams.builder()
                        .periodoInicio(inicio.toString())
                        .periodoFim(fim.toString())
                        .page(page == null ? 1 : page)
                        .size(size == null ? 20 : size)
                        .build();
                return getMovimentacoesDirectly(fallbackParams);
            }
        } catch (Exception e) {
            log.error("listarMovimentacoes/mes: exception", e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, MSG_FALHA_LISTAR_MES));
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
            // Call LocalDate path (all=true) => uses buildSaleOrderRows/buildManualMovRows
            ResponseEntity<java.util.Map<String, Object>> localResp = listarMovimentacoes(null, periodoInicio,
                    periodoFim, null, null, Boolean.TRUE, null, null, null, null, null, 1, Integer.MAX_VALUE);

            // Compute timestamp bounds in America/Sao_Paulo and call timestamp path
            // (all=true)
            java.time.LocalDate inicio = java.time.LocalDate.parse(periodoInicio);
            java.time.LocalDate fim = java.time.LocalDate.parse(periodoFim);
            java.time.ZoneId sp = java.time.ZoneId.of(TIMEZONE_SAO_PAULO);
            var zdtFrom = java.time.ZonedDateTime.of(inicio, java.time.LocalTime.MIDNIGHT, sp);
            var zdtTo = java.time.ZonedDateTime.of(fim.plusDays(1), java.time.LocalTime.MIDNIGHT, sp).minusNanos(1);
            java.time.OffsetDateTime fromTs = zdtFrom.toOffsetDateTime();
            java.time.OffsetDateTime toTs = zdtTo.toOffsetDateTime();

            ResponseEntity<java.util.Map<String, Object>> tsResp = listarMovimentacoes(null, null, null,
                    fromTs.toString(), toTs.toString(), Boolean.TRUE, null, null, null, null, null, 1,
                    Integer.MAX_VALUE);

            // Safe extraction with null checks
            java.util.Map<String, Object> localBody = localResp.getBody();
            java.util.Map<String, Object> tsBody = tsResp.getBody();

            @SuppressWarnings("unchecked")
            java.util.List<java.util.Map<String, Object>> localItems = localBody != null
                    ? (java.util.List<java.util.Map<String, Object>>) localBody.getOrDefault(KEY_ITEMS,
                            java.util.List.of())
                    : java.util.List.of();
            @SuppressWarnings("unchecked")
            java.util.List<java.util.Map<String, Object>> tsItems = tsBody != null
                    ? (java.util.List<java.util.Map<String, Object>>) tsBody.getOrDefault(KEY_ITEMS,
                            java.util.List.of())
                    : java.util.List.of();

            // Build dedupe key function consistent with listing code
            java.util.function.Function<java.util.Map<String, Object>, String> keyFn = m -> {
                try {
                    Object idObj = m.get("id");
                    if (idObj == null) {
                        Object dm = m.get(KEY_DATA_MOVIMENTO);
                        Object desc = m.get(KEY_DESCRICAO);
                        return (dm == null ? java.util.UUID.randomUUID().toString() : dm.toString()) + "|"
                                + (desc == null ? "" : desc.toString());
                    } else {
                        if (TIPO_VENDA.equals(m.get("tipo"))) {
                            Object metodo = m.get(KEY_METODO_PAGAMENTO);
                            Object pgVal = m.get(KEY_PAGAMENTO_VALOR);
                            return idObj.toString() + "|" + (metodo == null ? "" : metodo.toString()) + "|"
                                    + (pgVal == null ? "" : pgVal.toString());
                        }
                        return idObj.toString();
                    }
                } catch (Exception e) {
                    return java.util.UUID.randomUUID().toString();
                }
            };

            java.util.Map<String, java.util.Map<String, Object>> mapLocal = new java.util.LinkedHashMap<>();
            for (var m : localItems)
                mapLocal.put(keyFn.apply(m), m);
            java.util.Map<String, java.util.Map<String, Object>> mapTs = new java.util.LinkedHashMap<>();
            for (var m : tsItems)
                mapTs.put(keyFn.apply(m), m);

            java.util.List<java.util.Map<String, Object>> inLocalNotInTs = new java.util.ArrayList<>();
            for (var entry : mapLocal.entrySet())
                if (!mapTs.containsKey(entry.getKey()))
                    inLocalNotInTs.add(entry.getValue());

            java.util.List<java.util.Map<String, Object>> inTsNotInLocal = new java.util.ArrayList<>();
            for (var entry : mapTs.entrySet())
                if (!mapLocal.containsKey(entry.getKey()))
                    inTsNotInLocal.add(entry.getValue());

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
            // carregar todas as sessões para calcular cumulativos/histórico
            var allSessoes = caixaStatusRepository.findAll().stream()
                    .sorted(java.util.Comparator.comparing(CaixaStatus::getId))
                    .toList();

            // map id -> cumulative variation before this session
            java.util.Map<Long, Double> cumulativeBeforeMap = new java.util.HashMap<>();
            double running = 0.0;
            for (var s : allSessoes) {
                if (s.getId() != null) {
                    cumulativeBeforeMap.put(s.getId(), running);
                    running += (s.getVariacao() == null ? 0.0 : s.getVariacao());
                }
            }
            double cumulativeAll = running;

            java.util.Map<java.time.LocalDate, Double> dayVariacaoMap = new java.util.HashMap<>();
            java.util.Map<java.time.LocalDate, Double> daySaldoInicialMap = new java.util.HashMap<>();
            for (var s : allSessoes) {
                java.time.LocalDate d = null;
                if (s.getDataAbertura() != null)
                    d = s.getDataAbertura().toLocalDate();
                else if (s.getDataFechamento() != null)
                    d = s.getDataFechamento().toLocalDate();
                if (d != null) {
                    dayVariacaoMap.put(d,
                            dayVariacaoMap.getOrDefault(d, 0.0) + (s.getVariacao() == null ? 0.0 : s.getVariacao()));
                    daySaldoInicialMap.put(d, daySaldoInicialMap.getOrDefault(d, 0.0)
                            + (s.getSaldoInicial() == null ? 0.0 : s.getSaldoInicial()));
                }
            }

            var items = pg.getContent().stream().map(cs -> {
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

                // cumulative metrics
                if (cs.getId() != null) {
                    m.put(KEY_CUMULATIVE_VARIACAO_BEFORE, cumulativeBeforeMap.getOrDefault(cs.getId(), 0.0));
                    m.put(KEY_CUMULATIVE_VARIACAO_ALL, cumulativeAll);
                } else {
                    m.put(KEY_CUMULATIVE_VARIACAO_BEFORE, 0.0);
                    m.put(KEY_CUMULATIVE_VARIACAO_ALL, cumulativeAll);
                }

                // day aggregates
                java.time.LocalDate d = null;
                if (cs.getDataAbertura() != null)
                    d = cs.getDataAbertura().toLocalDate();
                else if (cs.getDataFechamento() != null)
                    d = cs.getDataFechamento().toLocalDate();
                if (d != null) {
                    m.put(KEY_DAY_VARIACAO_TOTAL, dayVariacaoMap.getOrDefault(d, 0.0));
                    m.put(KEY_DAY_SALDO_INICIAL_TOTAL, daySaldoInicialMap.getOrDefault(d, 0.0));
                } else {
                    m.put(KEY_DAY_VARIACAO_TOTAL, 0.0);
                    m.put(KEY_DAY_SALDO_INICIAL_TOTAL, 0.0);
                }

                return m;
            }).toList();
            java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put(KEY_ITEMS, items);
            body.put(KEY_TOTAL, pg.getTotalElements());
            body.put(KEY_HAS_NEXT, pg.hasNext());
            body.put(KEY_PAGE, pageNum);
            body.put(KEY_SIZE, pageSize);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(java.util.Map.of(KEY_ITEMS, java.util.List.of(), KEY_TOTAL, 0,
                    KEY_HAS_NEXT, false, KEY_PAGE, 1, KEY_SIZE, 20));
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
        java.time.LocalDate dia = null;
        java.time.LocalDate inicio = null;
        java.time.LocalDate fim = null;
        if (params.data != null && !params.data.isBlank()) {
            dia = java.time.LocalDate.parse(params.data);
        } else if (params.periodoInicio != null && params.periodoFim != null) {
            inicio = java.time.LocalDate.parse(params.periodoInicio);
            fim = java.time.LocalDate.parse(params.periodoFim);
        }

        java.util.List<java.util.Map<String, Object>> lista = new java.util.ArrayList<>();
        var tIni = safeParseLocalTime(params.horaInicio);
        var tFim = safeParseLocalTime(params.horaFim);

        TimestampBounds bounds = calculateTimestampBounds(dia, inicio, fim, tIni, tFim, params.from, params.to);
        java.time.OffsetDateTime fromTs = bounds.fromTs;
        java.time.OffsetDateTime toTs = bounds.toTs;

        if (fromTs != null || toTs != null) {
            // Use existing timestamp-based queries with deduplication
            java.util.Map<Object, java.util.Map<String, Object>> byId = new java.util.LinkedHashMap<>();

            // Add movimentacoes
            try {
                var movs = movimentacaoRepository.findByPeriodoTimestamps(fromTs, toTs);
                for (var m : movs) {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("id", m.getId());
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

            // Add sale orders
            try {
                var orders = saleOrderRepository.findByPeriodoTimestampsRaw(fromTs, toTs);
                for (var vo : orders) {
                    for (var pg : vo.getPagamentos()) {
                        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                        String compositeId = vo.getId() + "|" + pg.getMetodo() + "|" + pg.getValor();
                        row.put("id", vo.getId());
                        row.put("tipo", TIPO_VENDA);
                        row.put(KEY_VALOR, pg.getValor());
                        row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
                        row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
                        byId.put(compositeId, row);
                    }
                }
            } catch (Exception e) {
                log.warn("getMovimentacoesSummaryData: orders query failed", e);
            }

            lista = new java.util.ArrayList<>(byId.values());
        } else {
            lista.addAll(buildManualMovRows(dia, inicio, fim));
            lista.addAll(buildSaleOrderRows(dia, inicio, fim));
        }

        var filtrada = applyFilters(lista, params.tipo, params.metodoPagamento, tIni, tFim);

        double sumEntradasAgg = filtrada.stream()
                .filter(m -> TIPO_ENTRADA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum();
        double sumRetiradasAgg = filtrada.stream()
                .filter(m -> TIPO_RETIRADA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum();
        double sumVendasAgg = filtrada.stream()
                .filter(m -> TIPO_VENDA.equals(m.get("tipo")))
                .mapToDouble(m -> ((Number) m.get(KEY_VALOR)).doubleValue())
                .sum();

        java.util.Map<String, Object> aggsMap = new java.util.LinkedHashMap<>();
        aggsMap.put(KEY_SUM_ENTRADAS, sumEntradasAgg);
        aggsMap.put(KEY_SUM_RETIRADAS, sumRetiradasAgg);
        aggsMap.put(KEY_SUM_VENDAS, sumVendasAgg);
        aggsMap.put(KEY_TOTAL, filtrada.size());
        return ResponseEntity.ok(aggsMap);
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
        } catch (Exception e) {
            log.error("deleteSessao: exception deleting {}", id, e);
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao excluir sessão"));
        }
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
            } catch (Exception ignored) {
                // Silently ignore errors accessing operator username
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
        java.util.List<com.example.backendspring.sale.SaleOrder> base;
        if (dia != null) {
            base = saleOrderRepository.findByDia(dia);
        } else if (inicio != null && fim != null) {
            base = saleOrderRepository.findByPeriodo(inicio, fim);
        } else {
            // modo "tudo": trazer todas as vendas multi-pagamento
            base = saleOrderRepository.findAllOrderByData();
        }
        return base.stream().flatMap(vo ->
        // criar uma linha por método de pagamento para permitir filtro por método
        vo.getPagamentos().stream().map(pg -> {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", vo.getId());
            row.put("tipo", TIPO_VENDA);
            // Valor da linha: valor do pagamento (para refletir entrada por método)
            row.put(KEY_VALOR, pg.getValor());
            // Guardar o valor parcial do método e total da venda
            row.put(KEY_PAGAMENTO_VALOR, pg.getValor());
            row.put(KEY_TOTAL_VENDA, vo.getTotalFinal());
            var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag(LOCALE_PT_BR));
            String totalFmt = nf.format(vo.getTotalFinal());
            boolean multi = vo.getPagamentos().size() > 1;
            if (multi) {
                String breakdown = vo.getPagamentos().stream()
                        .map(p -> {
                            String labelPart = labelMetodoPagamento(p.getMetodo()) + " " + nf.format(p.getValor());
                            if (p.getValor() != null && p.getValor() < 0)
                                labelPart += LABEL_DEVOLVIDO_SUFFIX;
                            return labelPart;
                        })
                        .collect(java.util.stream.Collectors.joining(" | "));
                row.put(KEY_DESCRICAO, LABEL_VENDA_MULTI_PREFIX + totalFmt + " - " + breakdown);
            } else {
                String single = LABEL_VENDA_TOTAL + totalFmt + " (" + labelMetodoPagamento(pg.getMetodo()) + " "
                        + nf.format(pg.getValor()) + ")";
                if (pg.getValor() != null && pg.getValor() < 0)
                    single += LABEL_DEVOLVIDO_SUFFIX;
                row.put(KEY_DESCRICAO, single);
            }
            row.put(KEY_PRODUTO_NOME,
                    vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
            row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
            // operador da venda (se disponível)
            row.put(KEY_USUARIO, vo.getOperador() != null ? vo.getOperador().getUsername() : null);
            row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
            row.put(KEY_CAIXA_STATUS_ID, vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
            return row;
        })).toList();
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
        java.util.stream.Stream<java.util.Map<String, Object>> stream = lista.stream();
        if (tipo != null && !tipo.isBlank()) {
            stream = stream.filter(m -> tipo.equals(m.get("tipo")));
        }
        if (metodoPagamento != null && !metodoPagamento.isBlank()) {
            stream = stream.filter(m -> metodoPagamento.equals(m.get(KEY_METODO_PAGAMENTO)));
        }
        if (tIni != null || tFim != null) {
            final java.time.LocalTime ftIni = tIni;
            final java.time.LocalTime ftFim = tFim;
            stream = stream.filter(m -> {
                try {
                    var odt = (java.time.OffsetDateTime) m.get(KEY_DATA_MOVIMENTO);
                    if (odt == null)
                        return false;
                    // convert stored timestamp to America/Sao_Paulo local time to match UI input
                    java.time.LocalTime time;
                    try {
                        time = odt.atZoneSameInstant(java.time.ZoneId.of(TIMEZONE_SAO_PAULO)).toLocalTime();
                    } catch (Exception ex) {
                        time = odt.toLocalTime();
                    }
                    boolean okIni = ftIni == null || !time.isBefore(ftIni);
                    boolean okFim = ftFim == null || !time.isAfter(ftFim);
                    return okIni && okFim;
                } catch (Exception e) {
                    return false;
                }
            });
        }
        return stream.toList();
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

        // apenas usuários que podem controlar caixa (operador) ou admin podem abrir
        var opener = userRepository.findById(userId).orElse(null);
        if (opener == null || (!Boolean.TRUE.equals(opener.getPodeControlarCaixa())
                && (opener.getRole() == null || !opener.getRole().equals(VALOR_ADMIN)))) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada para abrir o caixa"));
        }

        // Verificar se já existe sessão aberta no banco (fonte da verdade)
        var abertoOpt = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc();
        if (abertoOpt.isPresent()) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está aberto"));
        }
        var agora = OffsetDateTime.now();
        // Sempre criar um novo registro de sessão ao abrir o caixa para não
        // sobrescrever
        // sessões anteriores. Copiar apenas configurações relevantes (horários) se
        // existirem.
        CaixaStatus status = new CaixaStatus();
        var lastOpt = caixaStatusRepository.findTopByOrderByIdDesc();
        if (lastOpt.isPresent()) {
            var prev = lastOpt.get();
            status.setHorarioAberturaObrigatorio(prev.getHorarioAberturaObrigatorio());
            status.setHorarioFechamentoObrigatorio(prev.getHorarioFechamentoObrigatorio());
        }
        status.setAberto(true);
        status.setAbertoPor(opener);
        status.setDataAbertura(agora);
        status.setFechadoPor(null);
        status.setDataFechamento(null);
        status.setAtualizadoEm(agora);
        status.setCriadoEm(agora);

        // Ler payload JSON e exigir saldo_inicial
        if (payload == null || !payload.containsKey(KEY_SALDO_INICIAL) || payload.get(KEY_SALDO_INICIAL) == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_inicial é obrigatório ao abrir o caixa"));
        }
        try {
            Object v = payload.get(KEY_SALDO_INICIAL);
            if (v instanceof Number number)
                status.setSaldoInicial(number.doubleValue());
            else
                status.setSaldoInicial(Double.parseDouble(v.toString()));
            if (payload.containsKey(KEY_TERMINAL_ID) && payload.get(KEY_TERMINAL_ID) != null) {
                status.setTerminalId(payload.get(KEY_TERMINAL_ID).toString());
            }
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_inicial inválido"));
        }

        try {
            caixaStatusRepository.save(status);
        } catch (org.springframework.orm.ObjectOptimisticLockingFailureException e) {
            return ResponseEntity.status(409)
                    .body(Map.of(KEY_ERROR, "Conflito ao atualizar sessão do caixa. Tente novamente."));
        }
        // retornar status completo para o frontend atualizar de forma consistente
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", status.getId());
        resp.put(KEY_ABERTO, Boolean.TRUE.equals(status.getAberto()));
        resp.put(KEY_DATA_ABERTURA, status.getDataAbertura());
        resp.put(KEY_ABERTO_POR, status.getAbertoPor() != null ? status.getAbertoPor().getId() : null);
        resp.put("aberto_por_username", status.getAbertoPor() != null ? status.getAbertoPor().getUsername() : null);
        resp.put(KEY_SALDO_INICIAL, status.getSaldoInicial());
        resp.put(KEY_TERMINAL_ID, status.getTerminalId());
        return ResponseEntity.ok(resp);
    }

    @PostMapping("/fechar")
    @Transactional
    public ResponseEntity<Map<String, Object>> fechar(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody(required = false) FecharRequest body) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        // verificar permissões: apenas operador autorizado (podeControlarCaixa) ou
        // admin podem fechar
        var closer = userRepository.findById(userId).orElse(null);
        if (closer == null || (!Boolean.TRUE.equals(closer.getPodeControlarCaixa())
                && (closer.getRole() == null || !closer.getRole().equals(VALOR_ADMIN)))) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada para fechar o caixa"));
        }

        // localizar sessão a ser fechada: preferir sessionId fornecido, caso contrário
        // buscar a sessão aberta mais recente. Usar métodos com lock pessimista.
        CaixaStatus status = null;
        if (body != null && body.getSessionId() != null) {
            status = caixaStatusRepository.findByIdForUpdate(body.getSessionId()).orElse(null);
            if (status == null) {
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, MSG_SESSAO_NAO_ENCONTRADA));
            }
            if (!Boolean.TRUE.equals(status.getAberto())) {
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Sessão já está fechada"));
            }
        } else {
            status = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc().orElse(null);
            if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
                return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está fechado"));
            }
        }
        var agora = OffsetDateTime.now();

        // tornar referência final ao objeto de sessão para uso em lambdas
        final CaixaStatus sessionFinal = status;

        // calcular saldo esperado e preencher sessão (delegado a helper)
        try {
            double esperado = calculateExpectedForSession(sessionFinal);
            sessionFinal.setSaldoEsperado(esperado);
        } catch (Exception ignored) {
            // Expected: Calculation errors should not interrupt session closure
        }

        // validar body com saldoContado
        if (body == null || body.getSaldoContado() == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_contado é obrigatório ao fechar o caixa"));
        }
        sessionFinal.setSaldoContado(body.getSaldoContado());
        if (sessionFinal.getSaldoEsperado() != null) {
            sessionFinal.setVariacao(sessionFinal.getSaldoContado() - sessionFinal.getSaldoEsperado());
        }
        if (body.getObservacoes() != null)
            sessionFinal.setObservacoesFechamento(body.getObservacoes());

        sessionFinal.setAberto(false);
        sessionFinal.setFechadoPor(userRepository.findById(userId).orElse(null));
        sessionFinal.setDataFechamento(agora);
        sessionFinal.setAtualizadoEm(agora);

        // calcular e persistir cumulativos: variação acumulada e déficit não reposto
        try {
            var all = caixaStatusRepository.findAll().stream()
                    .filter(s -> s.getId() != null)
                    .sorted(java.util.Comparator.comparing(CaixaStatus::getId)).toList();
            double running = 0.0;
            double totalPos = 0.0;
            double totalNeg = 0.0;
            for (var s : all) {
                if (s.getId().equals(sessionFinal.getId())) {
                    // include current session's variacao
                    running += (sessionFinal.getVariacao() == null ? 0.0 : sessionFinal.getVariacao());
                    if (sessionFinal.getVariacao() != null) {
                        if (sessionFinal.getVariacao() > 0)
                            totalPos += sessionFinal.getVariacao();
                        else
                            totalNeg += -sessionFinal.getVariacao();
                    }
                    break;
                } else {
                    running += (s.getVariacao() == null ? 0.0 : s.getVariacao());
                    if (s.getVariacao() != null) {
                        if (s.getVariacao() > 0)
                            totalPos += s.getVariacao();
                        else
                            totalNeg += -s.getVariacao();
                    }
                }
            }
            sessionFinal.setVariacaoAcumulada(running);
            double deficit = Math.max(0.0, totalNeg - totalPos);
            sessionFinal.setDeficitNaoRepostoAcumulada(deficit);
        } catch (Exception ignored) {
            // Expected: Cumulative calculation errors should not interrupt session closure
        }

        caixaStatusRepository.save(sessionFinal);
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", sessionFinal.getId());
        resp.put(KEY_ABERTO, Boolean.TRUE.equals(sessionFinal.getAberto()));
        resp.put(KEY_DATA_FECHAMENTO, sessionFinal.getDataFechamento());
        resp.put(KEY_FECHADO_POR, sessionFinal.getFechadoPor() != null ? sessionFinal.getFechadoPor().getId() : null);
        resp.put("fechado_por_username",
                sessionFinal.getFechadoPor() != null ? sessionFinal.getFechadoPor().getUsername() : null);
        resp.put(KEY_SALDO_ESPERADO, sessionFinal.getSaldoEsperado());
        resp.put(KEY_SALDO_CONTADO, sessionFinal.getSaldoContado());
        resp.put(KEY_VARIACAO, sessionFinal.getVariacao());
        resp.put("observacoes", sessionFinal.getObservacoesFechamento());
        return ResponseEntity.ok(resp);
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

    private void logRepositoryCountsForDebug(Boolean all, java.time.LocalDate dia, 
                                           java.time.LocalDate inicio, java.time.LocalDate fim, 
                                           String from, String to) {
        try {
            if (Boolean.TRUE.equals(all)) {
                if (dia != null) {
                    var movsDia = movimentacaoRepository.findByDia(dia);
                    var ordersDia = saleOrderRepository.findByDia(dia);
                    log.info("listarMovimentacoes[ALL]: dia={} movs={} orders={}", dia,
                            (movsDia instanceof java.util.Collection ? ((java.util.Collection<?>) movsDia).size()
                                    : -1),
                            (ordersDia instanceof java.util.Collection
                                    ? ((java.util.Collection<?>) ordersDia).size()
                                    : -1));
                } else if (inicio != null && fim != null) {
                    var movsPer = movimentacaoRepository.findByPeriodo(inicio, fim);
                    var ordersPer = saleOrderRepository.findByPeriodo(inicio, fim);
                    log.info("listarMovimentacoes[ALL]: periodo {}..{} movs={} orders={}", inicio, fim,
                            (movsPer instanceof java.util.Collection ? ((java.util.Collection<?>) movsPer).size()
                                    : -1),
                            (ordersPer instanceof java.util.Collection
                                    ? ((java.util.Collection<?>) ordersPer).size()
                                    : -1));
                } else if (from != null || to != null) {
                    log.info("listarMovimentacoes[ALL]: raw from/to params provided from={} to={}", from, to);
                }
            }
        } catch (Exception ex) {
            log.warn("listarMovimentacoes[ALL]: debug counts failed", ex);
        }
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

    /**
     * Parameter object for movimentacoes queries to reduce method parameter count
     */
    private static class MovimentacoesQueryParams {
        final String periodoInicio;
        final String periodoFim;
        final Integer page;
        final Integer size;

        private MovimentacoesQueryParams(Builder builder) {
            this.periodoInicio = builder.periodoInicio;
            this.periodoFim = builder.periodoFim;
            this.page = builder.page;
            this.size = builder.size;
        }

        static Builder builder() {
            return new Builder();
        }

        static class Builder {
            String periodoInicio;
            String periodoFim;
            Integer page;
            Integer size;

            Builder periodoInicio(String periodoInicio) {
                this.periodoInicio = periodoInicio;
                return this;
            }

            Builder periodoFim(String periodoFim) {
                this.periodoFim = periodoFim;
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

            MovimentacoesQueryParams build() {
                return new MovimentacoesQueryParams(this);
            }
        }
    }

    // NOTE: dbg-delete removed from production. Keep force-delete for admin use.
}
