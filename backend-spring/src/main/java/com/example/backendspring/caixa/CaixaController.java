package com.example.backendspring.caixa;

import com.example.backendspring.user.UserRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/caixa")
@RequiredArgsConstructor
public class CaixaController {

    private final CaixaStatusRepository caixaStatusRepository;
    private final CaixaMovimentacaoRepository movimentacaoRepository;
    private final UserRepository userRepository;
    private final com.example.backendspring.sale.SaleRepository saleRepository;
    private final com.example.backendspring.sale.SaleOrderRepository saleOrderRepository;

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

            // Vendas simples (tabela vendas)
            lista.addAll(buildSimpleSaleRows(dia, inicio, fim));

            // Vendas completas (multi-pagamento) da venda_cabecalho
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
        java.util.List<com.example.backendspring.sale.Sale> base;
        if (dia != null) {
            base = saleRepository.findByDia(dia);
        } else if (inicio != null && fim != null) {
            base = saleRepository.findByPeriodo(inicio, fim);
        } else {
            // modo "tudo": trazer todas as vendas simples
            base = saleRepository.findAllOrderByData();
        }
        return base.stream().map(v -> {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", v.getId());
            row.put("tipo", TIPO_VENDA);
            row.put(KEY_VALOR, v.getPrecoTotal());
            row.put(KEY_DESCRICAO, "Venda - " + (v.getProduto() != null ? v.getProduto().getNome() : "Produto") +
                    " x" + v.getQuantidadeVendida() + " (" + v.getMetodoPagamento() + ")");
            row.put("produto_nome", v.getProduto() != null ? v.getProduto().getNome() : null);
            row.put(KEY_METODO_PAGAMENTO, v.getMetodoPagamento());
            // tentar mostrar operador/usuário associado à venda
            // mostrar operador se presente
            try {
                if (v.getOperador() != null) {
                    row.put(KEY_USUARIO, v.getOperador().getUsername());
                } else {
                    row.put(KEY_USUARIO, null);
                }
            } catch (Exception e) {
                row.put(KEY_USUARIO, null);
            }
            row.put(KEY_DATA_MOVIMENTO, v.getDataVenda());
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
            // associar à sessão atual do caixa, se existir
            var statusAtualLocal = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
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

        // calcular saldo esperado: vendas do periodo + entradas - retiradas
        try {
            // para simplicidade, calcular saldo esperado como saldo do dia atual
            var hoje = agora.toLocalDate();
            Double saldoMov = movimentacaoRepository.saldoDoDia(hoje);
            double vendas = 0.0;
            try {
                // somaReceitaByDia retorna double
                vendas = saleRepository.somaReceitaByDia(hoje);
            } catch (Exception ignored) {
            }
            double esperado = (saldoMov != null ? saldoMov : 0.0) + vendas;
            status.setSaldoEsperado(esperado);
        } catch (Exception ignored) {
        }

        // validar body com saldoContado
        if (body == null || body.getSaldoContado() == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "saldo_contado é obrigatório ao fechar o caixa"));
        }
        status.setSaldoContado(body.getSaldoContado());
        if (status.getSaldoEsperado() != null) {
            status.setVariacao(status.getSaldoContado() - status.getSaldoEsperado());
        }
        if (body.getObservacoes() != null)
            status.setObservacoesFechamento(body.getObservacoes());

        status.setAberto(false);
        status.setFechadoPor(userRepository.findById(userId).orElse(null));
        status.setDataFechamento(agora);
        status.setAtualizadoEm(agora);
        caixaStatusRepository.save(status);
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", status.getId());
        resp.put("aberto", Boolean.TRUE.equals(status.getAberto()));
        resp.put("data_fechamento", status.getDataFechamento());
        resp.put("fechado_por", status.getFechadoPor() != null ? status.getFechadoPor().getId() : null);
        resp.put("fechado_por_username", status.getFechadoPor() != null ? status.getFechadoPor().getUsername() : null);
        resp.put("saldo_esperado", status.getSaldoEsperado());
        resp.put("saldo_contado", status.getSaldoContado());
        resp.put("variacao", status.getVariacao());
        resp.put("observacoes", status.getObservacoesFechamento());
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
}
