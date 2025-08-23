package com.example.backendspring.caixa;

import com.example.backendspring.user.UserRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
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

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        return caixaStatusRepository.findTopByOrderByIdDesc()
                .map(cs -> {
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("id", cs.getId());
                    body.put("aberto", Boolean.TRUE.equals(cs.getAberto()));
                    body.put("horario_abertura_obrigatorio", cs.getHorarioAberturaObrigatorio());
                    body.put("horario_fechamento_obrigatorio", cs.getHorarioFechamentoObrigatorio());
                    body.put("aberto_por", cs.getAbertoPor() != null ? cs.getAbertoPor().getId() : null);
                    body.put("fechado_por", cs.getFechadoPor() != null ? cs.getFechadoPor().getId() : null);
                    body.put("data_abertura", cs.getDataAbertura());
                    body.put("data_fechamento", cs.getDataFechamento());
                    body.put("criado_em", cs.getCriadoEm());
                    body.put("atualizado_em", cs.getAtualizadoEm());
                    body.put("aberto_por_username", cs.getAbertoPor() != null ? cs.getAbertoPor().getUsername() : null);
                    body.put("fechado_por_username",
                            cs.getFechadoPor() != null ? cs.getFechadoPor().getUsername() : null);
                    return ResponseEntity.ok(body);
                })
                .orElse(ResponseEntity.ok(Map.of("id", 1, "aberto", false)));
    }

    private static String labelMetodoPagamento(String metodo) {
        if (metodo == null)
            return "";
        return switch (metodo) {
            case "dinheiro" -> "Dinheiro";
            case "cartao_credito" -> "Crédito";
            case "cartao_debito" -> "Débito";
            case "pix" -> "PIX";
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
            var lista = new java.util.ArrayList<java.util.Map<String, Object>>();

            var tIni = safeParseLocalTime(horaInicio);
            var tFim = safeParseLocalTime(horaFim);

            // Movimentações manuais (entrada/retirada)
            lista.addAll(buildManualMovRows(dia, inicio, fim));

            // Vendas (unificadas) — usar somente venda_cabecalho / venda_pagamentos
            lista.addAll(buildSaleOrderRows(dia, inicio, fim));

            // Ordenar por data_movimento desc
            sortByDataMovimentoDesc(lista);

            // Filtros opcionais por tipo, método e faixa horária
            var filtrada = applyFilters(lista, tipo, metodoPagamento, tIni, tFim);

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

            // precompute day aggregates: day -> {variacaoTotal, saldoInicialTotal}
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
                m.put("aberto", Boolean.TRUE.equals(cs.getAberto()));
                m.put("aberto_por", cs.getAbertoPor() != null ? cs.getAbertoPor().getUsername() : null);
                m.put("fechado_por", cs.getFechadoPor() != null ? cs.getFechadoPor().getUsername() : null);
                m.put("data_abertura", cs.getDataAbertura());
                m.put("data_fechamento", cs.getDataFechamento());
                m.put("saldo_inicial", cs.getSaldoInicial());
                m.put("saldo_esperado", cs.getSaldoEsperado());
                m.put("saldo_contado", cs.getSaldoContado());
                m.put("variacao", cs.getVariacao());
                m.put("terminal_id", cs.getTerminalId());
                m.put("observacoes", cs.getObservacoesFechamento());

                // cumulative metrics
                if (cs.getId() != null) {
                    m.put("cumulative_variacao_before", cumulativeBeforeMap.getOrDefault(cs.getId(), 0.0));
                    m.put("cumulative_variacao_all", cumulativeAll);
                } else {
                    m.put("cumulative_variacao_before", 0.0);
                    m.put("cumulative_variacao_all", cumulativeAll);
                }

                // day aggregates
                java.time.LocalDate d = null;
                if (cs.getDataAbertura() != null)
                    d = cs.getDataAbertura().toLocalDate();
                else if (cs.getDataFechamento() != null)
                    d = cs.getDataFechamento().toLocalDate();
                if (d != null) {
                    m.put("day_variacao_total", dayVariacaoMap.getOrDefault(d, 0.0));
                    m.put("day_saldo_inicial_total", daySaldoInicialMap.getOrDefault(d, 0.0));
                } else {
                    m.put("day_variacao_total", 0.0);
                    m.put("day_saldo_inicial_total", 0.0);
                }

                return m;
            }).toList();
            java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put("items", items);
            body.put("total", pg.getTotalElements());
            body.put("hasNext", pg.hasNext());
            body.put("page", pageNum);
            body.put("size", pageSize);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(java.util.Map.of("items", java.util.List.of(), "total", 0,
                    "hasNext", false, "page", 1, "size", 20));
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
        if (u == null || u.getRole() == null || !u.getRole().equals("admin")) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada"));
        }
        try {
            // Use pessimistic lock to avoid concurrent modifications
            var opt = caixaStatusRepository.findByIdForUpdate(id);
            if (opt.isEmpty())
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Sessão não encontrada"));
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
            row.put("caixa_status_id", m.getCaixaStatus() != null ? m.getCaixaStatus().getId() : null);
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
            }
            if (usuarioNome == null && m.getUsuario() != null) {
                usuarioNome = m.getUsuario().getUsername();
            }
            row.put(KEY_USUARIO, usuarioNome);
            row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
            return row;
        }).toList();
    }

    private java.util.List<java.util.Map<String, Object>> buildSimpleSaleRows(java.time.LocalDate dia,
            java.time.LocalDate inicio, java.time.LocalDate fim) {
        // Legacy simple sales removed: return empty list to keep API stable
        return java.util.List.of();
    }

    private CaixaStatus findSessionForTimestamp(java.time.OffsetDateTime dt) {
        if (dt == null)
            return null;
        return caixaStatusRepository.findAll().stream().filter(s -> {
            if (s.getDataAbertura() == null)
                return false;
            boolean afterOpen = !s.getDataAbertura().isAfter(dt); // s.dataAbertura <= dt
            boolean beforeClose = s.getDataFechamento() == null || !s.getDataFechamento().isBefore(dt); // dt <=
                                                                                                        // dataFechamento
                                                                                                        // or open
            return afterOpen && beforeClose;
        }).findFirst().orElse(null);
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
            row.put("pagamento_valor", pg.getValor());
            row.put("total_venda", vo.getTotalFinal());
            var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag("pt-BR"));
            String totalFmt = nf.format(vo.getTotalFinal());
            boolean multi = vo.getPagamentos().size() > 1;
            if (multi) {
                String breakdown = vo.getPagamentos().stream()
                        .map(p -> labelMetodoPagamento(p.getMetodo()) + " " + nf.format(p.getValor()))
                        .collect(java.util.stream.Collectors.joining(" | "));
                row.put(KEY_DESCRICAO, "Venda (multi) - total " + totalFmt + " - " + breakdown);
            } else {
                // descrição simplificada para venda de único método
                row.put(KEY_DESCRICAO, "Venda - total " + totalFmt + " (" + labelMetodoPagamento(pg.getMetodo()) + " "
                        + nf.format(pg.getValor()) + ")");
            }
            row.put("produto_nome",
                    vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
            row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
            // operador da venda (se disponível)
            row.put(KEY_USUARIO, vo.getOperador() != null ? vo.getOperador().getUsername() : null);
            row.put(KEY_DATA_MOVIMENTO, vo.getDataVenda());
            row.put("caixa_status_id", vo.getCaixaStatus() != null ? vo.getCaixaStatus().getId() : null);
            return row;
        })).toList();
    }

    private static void sortByDataMovimentoDesc(java.util.List<java.util.Map<String, Object>> lista) {
        lista.sort((a, b) -> java.time.OffsetDateTime.parse(b.get(KEY_DATA_MOVIMENTO).toString())
                .compareTo(java.time.OffsetDateTime.parse(a.get(KEY_DATA_MOVIMENTO).toString())));
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
                var odt = (java.time.OffsetDateTime) m.get(KEY_DATA_MOVIMENTO);
                var time = odt.toLocalTime();
                boolean okIni = ftIni == null || !time.isBefore(ftIni);
                boolean okFim = ftFim == null || !time.isAfter(ftFim);
                return okIni && okFim;
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
                if (u == null || u.getRole() == null || !u.getRole().equals("admin")) {
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
                && (opener.getRole() == null || !opener.getRole().equals("admin")))) {
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
        if (payload == null || !payload.containsKey("saldo_inicial") || payload.get("saldo_inicial") == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_inicial é obrigatório ao abrir o caixa"));
        }
        try {
            Object v = payload.get("saldo_inicial");
            if (v instanceof Number)
                status.setSaldoInicial(((Number) v).doubleValue());
            else
                status.setSaldoInicial(Double.parseDouble(v.toString()));
            if (payload.containsKey("terminal_id") && payload.get("terminal_id") != null) {
                status.setTerminalId(payload.get("terminal_id").toString());
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
        resp.put("aberto", Boolean.TRUE.equals(status.getAberto()));
        resp.put("data_abertura", status.getDataAbertura());
        resp.put("aberto_por", status.getAbertoPor() != null ? status.getAbertoPor().getId() : null);
        resp.put("aberto_por_username", status.getAbertoPor() != null ? status.getAbertoPor().getUsername() : null);
        resp.put("saldo_inicial", status.getSaldoInicial());
        resp.put("terminal_id", status.getTerminalId());
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
                && (closer.getRole() == null || !closer.getRole().equals("admin")))) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada para fechar o caixa"));
        }

        // localizar sessão a ser fechada: preferir sessionId fornecido, caso contrário
        // buscar a sessão aberta mais recente. Usar métodos com lock pessimista.
        CaixaStatus status = null;
        if (body != null && body.getSessionId() != null) {
            status = caixaStatusRepository.findByIdForUpdate(body.getSessionId()).orElse(null);
            if (status == null) {
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Sessão não encontrada"));
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
                    .sorted(java.util.Comparator.comparing(CaixaStatus::getId)).toList();
            double running = 0.0;
            double totalPos = 0.0;
            double totalNeg = 0.0;
            for (var s : all) {
                if (s.getId() == null)
                    continue;
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
        }

        caixaStatusRepository.save(sessionFinal);
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", sessionFinal.getId());
        resp.put("aberto", Boolean.TRUE.equals(sessionFinal.getAberto()));
        resp.put("data_fechamento", sessionFinal.getDataFechamento());
        resp.put("fechado_por", sessionFinal.getFechadoPor() != null ? sessionFinal.getFechadoPor().getId() : null);
        resp.put("fechado_por_username",
                sessionFinal.getFechadoPor() != null ? sessionFinal.getFechadoPor().getUsername() : null);
        resp.put("saldo_esperado", sessionFinal.getSaldoEsperado());
        resp.put("saldo_contado", sessionFinal.getSaldoContado());
        resp.put("variacao", sessionFinal.getVariacao());
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
        if (u == null || u.getRole() == null || !u.getRole().equals("admin")) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada"));
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
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Sessão não encontrada"));
            }
            var status = statusOpt.get();
            java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
            resp.put("id", status.getId());
            resp.put("aberto", Boolean.TRUE.equals(status.getAberto()));
            resp.put("data_abertura", status.getDataAbertura());
            resp.put("data_fechamento", status.getDataFechamento());
            resp.put("saldo_inicial", status.getSaldoInicial());

            // Movimentações vinculadas à sessão
            java.util.List<java.util.Map<String, Object>> movs = movimentacaoRepository.findAllOrderByData().stream()
                    .filter(m -> m.getCaixaStatus() != null && status.getId().equals(m.getCaixaStatus().getId()))
                    .map(m -> {
                        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                        row.put("id", m.getId());
                        row.put("tipo", m.getTipo());
                        row.put("valor", m.getValor());
                        row.put("descricao", m.getDescricao());
                        row.put("usuario", m.getUsuario() != null ? m.getUsuario().getUsername() : null);
                        row.put("data_movimento", m.getDataMovimento());
                        return row;
                    }).toList();
            resp.put("movimentacoes", movs);

            // Vendas vinculadas à sessão (novo modelo)
            var orders = saleOrderRepository.findAllOrderByData().stream()
                    .filter(o -> o.getCaixaStatus() != null && status.getId().equals(o.getCaixaStatus().getId()))
                    .toList();
            java.util.List<java.util.Map<String, Object>> vendas = orders.stream().map(o -> {
                java.util.Map<String, Object> r = new java.util.LinkedHashMap<>();
                r.put("id", o.getId());
                r.put("data_venda", o.getDataVenda());
                r.put("total_final", o.getTotalFinal());
                r.put("operador", o.getOperador() != null ? o.getOperador().getUsername() : null);
                r.put("itens", o.getItens().stream().map(it -> {
                    var im = new java.util.LinkedHashMap<String, Object>();
                    im.put("produto_id", it.getProduto() != null ? it.getProduto().getId() : null);
                    im.put("produto_nome", it.getProduto() != null ? it.getProduto().getNome() : null);
                    im.put("quantidade", it.getQuantidade());
                    im.put("preco_unitario", it.getPrecoUnitario());
                    im.put("preco_total", it.getPrecoTotal());
                    return im;
                }).toList());
                r.put("pagamentos", o.getPagamentos().stream().map(p -> {
                    var pm = new java.util.LinkedHashMap<String, Object>();
                    pm.put("metodo", p.getMetodo());
                    pm.put("valor", p.getValor());
                    return pm;
                }).toList());
                return r;
            }).toList();
            resp.put("vendas", vendas);

            // Totais por método de pagamento
            java.util.Map<String, Double> totalsByMetodo = new java.util.LinkedHashMap<>();
            orders.stream().flatMap(o -> o.getPagamentos().stream()).forEach(p -> {
                totalsByMetodo.putIfAbsent(p.getMetodo(), 0.0);
                totalsByMetodo.put(p.getMetodo(),
                        totalsByMetodo.get(p.getMetodo()) + (p.getValor() == null ? 0.0 : p.getValor()));
            });
            double totalEntradas = movs.stream().filter(m -> "entrada".equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) m.get("valor")).doubleValue()).sum();
            double totalRetiradas = movs.stream().filter(m -> "retirada".equals(m.get("tipo")))
                    .mapToDouble(m -> ((Number) m.get("valor")).doubleValue()).sum();
            resp.put("totals_by_metodo", totalsByMetodo);
            resp.put("sum_entradas", totalEntradas);
            resp.put("sum_retiradas", totalRetiradas);

            // --- métricas históricas ---
            try {
                java.util.Map<String, Double> historicalMetrics = computeHistoricalMetrics(status);
                resp.put("cumulative_variacao_before", historicalMetrics.get("cumulative_before"));
                resp.put("total_variacoes_positivas_before", 0.0); // Not directly available from historical metrics
                resp.put("total_variacoes_negativas_before", 0.0); // Not directly available from historical metrics
                resp.put("deficit_nao_reposto_before", 0.0); // Not directly available from historical metrics

                resp.put("cumulative_variacao_all", historicalMetrics.get("cumulative_all"));
                resp.put("total_variacoes_positivas_all", 0.0); // Not directly available from historical metrics
                resp.put("total_variacoes_negativas_all", 0.0); // Not directly available from historical metrics
                resp.put("deficit_nao_reposto_all", 0.0); // Not directly available from historical metrics

                // métricas do dia da sessão (somar todas as sessões do mesmo dia)
                final java.time.LocalDate sessionDay = status.getDataAbertura() != null
                        ? status.getDataAbertura().toLocalDate()
                        : (status.getDataFechamento() != null ? status.getDataFechamento().toLocalDate() : null);
                if (sessionDay != null) {
                    double dayVariacao = caixaStatusRepository.findAll().stream()
                            .filter(s -> (s.getDataAbertura() != null
                                    && s.getDataAbertura().toLocalDate().equals(sessionDay))
                                    || (s.getDataFechamento() != null
                                            && s.getDataFechamento().toLocalDate().equals(sessionDay)))
                            .mapToDouble(s -> s.getVariacao() == null ? 0.0 : s.getVariacao())
                            .sum();
                    double daySaldoInicial = caixaStatusRepository.findAll().stream()
                            .filter(s -> (s.getDataAbertura() != null
                                    && s.getDataAbertura().toLocalDate().equals(sessionDay))
                                    || (s.getDataFechamento() != null
                                            && s.getDataFechamento().toLocalDate().equals(sessionDay)))
                            .mapToDouble(s -> s.getSaldoInicial() == null ? 0.0 : s.getSaldoInicial())
                            .sum();
                    resp.put("day_variacao_total", dayVariacao);
                    resp.put("day_saldo_inicial_total", daySaldoInicial);
                }
            } catch (Exception ignored) {
            }

            resp.put("saldo_esperado", status.getSaldoEsperado());
            resp.put("saldo_contado", status.getSaldoContado());
            resp.put("variacao", status.getVariacao());

            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR, "Falha ao gerar relatório de reconciliação"));
        }
    }

    /**
     * Calcula o saldo esperado para uma sessão: saldo_inicial + (entradas -
     * retiradas vinculadas)
     * + pagamentos em dinheiro das vendas vinculadas.
     */
    private double calculateExpectedForSession(CaixaStatus sess) {
        var agora = java.time.OffsetDateTime.now();
        final Long sessionId = sess.getId();
        double movimentacoesSessao = 0.0;
        try {
            movimentacoesSessao = movimentacaoRepository.findAllOrderByData().stream()
                    .filter(m -> m.getCaixaStatus() != null && sessionId != null
                            && sessionId.equals(m.getCaixaStatus().getId()))
                    .mapToDouble(m -> TIPO_ENTRADA.equals(m.getTipo()) ? (m.getValor() == null ? 0.0 : m.getValor())
                            : -(m.getValor() == null ? 0.0 : m.getValor()))
                    .sum();
        } catch (Exception ignored) {
        }

        double vendasSessao = 0.0;
        try {
            var inicio = sess.getDataAbertura() != null ? sess.getDataAbertura().toLocalDate() : null;
            var fim = sess.getDataFechamento() != null ? sess.getDataFechamento().toLocalDate() : agora.toLocalDate();
            if (inicio != null && fim != null) {
                // legacy sales no longer used; ignore legacy cash contribution
            }
        } catch (Exception ignored) {
        }

        try {
            double ordersCash = saleOrderRepository.findAllOrderByData().stream()
                    .filter(o -> o.getCaixaStatus() != null && sessionId != null
                            && sessionId.equals(o.getCaixaStatus().getId()))
                    .flatMap(o -> o.getPagamentos().stream())
                    .filter(p -> p.getMetodo() != null && p.getMetodo().equals("dinheiro"))
                    .mapToDouble(p -> p.getValor() == null ? 0.0 : p.getValor()).sum();
            vendasSessao += ordersCash;
        } catch (Exception ignored) {
        }

        return (sess.getSaldoInicial() == null ? 0.0 : sess.getSaldoInicial()) + movimentacoesSessao + vendasSessao;
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
        if (u == null || u.getRole() == null || !u.getRole().equals("admin")) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada"));
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
        if (u == null || u.getRole() == null || !u.getRole().equals("admin")) {
            return ResponseEntity.status(403).body(Map.of(KEY_ERROR, "Permissão negada"));
        }
        try {
            var opt = caixaStatusRepository.findById(id);
            if (opt.isEmpty())
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Sessão não encontrada"));
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

    // NOTE: dbg-delete removed from production. Keep force-delete for admin use.
}
