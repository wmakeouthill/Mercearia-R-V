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
    public ResponseEntity<java.util.List<java.util.Map<String, Object>>> listarMovimentacoes(
            @RequestParam(value = "data", required = false) String data,
            @RequestParam(value = "tipo", required = false) String tipo,
            @RequestParam(value = "metodo_pagamento", required = false) String metodoPagamento,
            @RequestParam(value = "hora_inicio", required = false) String horaInicio,
            @RequestParam(value = "hora_fim", required = false) String horaFim) {
        try {
            var dia = data == null ? java.time.LocalDate.now() : java.time.LocalDate.parse(data);
            var lista = new java.util.ArrayList<java.util.Map<String, Object>>();

            var tIni = safeParseLocalTime(horaInicio);
            var tFim = safeParseLocalTime(horaFim);

            // Movimentações manuais (entrada/retirada)
            lista.addAll(buildManualMovRows(dia));

            // Vendas simples (tabela vendas)
            lista.addAll(buildSimpleSaleRows(dia));

            // Vendas completas (multi-pagamento) da venda_cabecalho
            lista.addAll(buildSaleOrderRows(dia));

            // Ordenar por data_movimento desc
            sortByDataMovimentoDesc(lista);

            // Filtros opcionais por tipo, método e faixa horária
            var filtrada = applyFilters(lista, tipo, metodoPagamento, tIni, tFim);
            return ResponseEntity.ok(filtrada);
        } catch (Exception e) {
            // Em caso de erro, retornar lista vazia para não quebrar o frontend
            return ResponseEntity.ok(java.util.List.of());
        }
    }

    private java.util.List<java.util.Map<String, Object>> buildManualMovRows(java.time.LocalDate dia) {
        return movimentacaoRepository.findByDia(dia).stream().map(m -> {
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

    private java.util.List<java.util.Map<String, Object>> buildSimpleSaleRows(java.time.LocalDate dia) {
        return saleRepository.findByDia(dia).stream().map(v -> {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", v.getId());
            row.put("tipo", "venda");
            row.put(KEY_VALOR, v.getPrecoTotal());
            row.put(KEY_DESCRICAO, "Venda - " + (v.getProduto() != null ? v.getProduto().getNome() : "Produto") +
                    " x" + v.getQuantidadeVendida() + " (" + v.getMetodoPagamento() + ")");
            row.put("produto_nome", v.getProduto() != null ? v.getProduto().getNome() : null);
            row.put(KEY_METODO_PAGAMENTO, v.getMetodoPagamento());
            row.put(KEY_USUARIO, null);
            row.put(KEY_DATA_MOVIMENTO, v.getDataVenda());
            return row;
        }).toList();
    }

    private java.util.List<java.util.Map<String, Object>> buildSaleOrderRows(java.time.LocalDate dia) {
        return saleOrderRepository.findByDia(dia).stream().flatMap(vo ->
        // criar uma linha por método de pagamento para permitir filtro por método
        vo.getPagamentos().stream().map(pg -> {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", vo.getId());
            row.put("tipo", "venda");
            // Mostrar o total da venda na coluna de valor
            row.put(KEY_VALOR, vo.getTotalFinal());
            // Guardar o valor parcial do método (se necessário no futuro)
            row.put("pagamento_valor", pg.getValor());
            var nf = java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag("pt-BR"));
            String totalFmt = nf.format(vo.getTotalFinal());
            String breakdown = vo.getPagamentos().stream()
                    .map(p -> labelMetodoPagamento(p.getMetodo()) + " " + nf.format(p.getValor()))
                    .collect(java.util.stream.Collectors.joining(" | "));
            row.put(KEY_DESCRICAO, "Venda (multi) - total " + totalFmt + " - " + breakdown);
            row.put("produto_nome",
                    vo.getItens().isEmpty() ? null : vo.getItens().get(0).getProduto().getNome());
            row.put(KEY_METODO_PAGAMENTO, pg.getMetodo());
            row.put(KEY_USUARIO, null);
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

            var agora = java.time.OffsetDateTime.now();
            CaixaMovimentacao mov = CaixaMovimentacao.builder()
                    .tipo(tipo)
                    .valor(req.getValor())
                    .descricao(req.getDescricao())
                    .usuario(userRepository.findById(userId).orElse(null))
                    .dataMovimento(agora)
                    .criadoEm(agora)
                    .atualizadoEm(agora)
                    .build();
            movimentacaoRepository.save(mov);
            return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Movimentação registrada com sucesso"));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of(KEY_ERROR,
                    "Falha ao registrar movimentação. Se acabou de atualizar o sistema, reinicie o backend para aplicar alterações de banco."));
        }
    }

    @PostMapping("/abrir")
    @Transactional
    public ResponseEntity<Map<String, Object>> abrir(@RequestAttribute(name = "userId", required = false) Long userId) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var statusOpt = caixaStatusRepository.findTopByOrderByIdDesc();
        if (statusOpt.isPresent() && Boolean.TRUE.equals(statusOpt.get().getAberto())) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está aberto"));
        }
        var agora = OffsetDateTime.now();
        CaixaStatus status = statusOpt.orElseGet(CaixaStatus::new);
        status.setAberto(true);
        status.setAbertoPor(userRepository.findById(userId).orElse(null));
        status.setDataAbertura(agora);
        status.setFechadoPor(null);
        status.setDataFechamento(null);
        status.setAtualizadoEm(agora);
        if (status.getId() == null)
            status.setCriadoEm(agora);
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Caixa aberto com sucesso"));
    }

    @PostMapping("/fechar")
    @Transactional
    public ResponseEntity<Map<String, Object>> fechar(
            @RequestAttribute(name = "userId", required = false) Long userId) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var status = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
        if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está fechado"));
        }
        var agora = OffsetDateTime.now();
        status.setAberto(false);
        status.setFechadoPor(userRepository.findById(userId).orElse(null));
        status.setDataFechamento(agora);
        status.setAtualizadoEm(agora);
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Caixa fechado com sucesso"));
    }

    @PutMapping("/horarios")
    @Transactional
    public ResponseEntity<Map<String, Object>> configurar(@RequestBody HorariosRequest req) {
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

    @lombok.Data
    public static class MovimentacaoRequest {
        private String tipo; // entrada | retirada
        private Double valor;
        private String descricao;
    }
}
