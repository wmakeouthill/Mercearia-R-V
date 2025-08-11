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

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_DATA_MOVIMENTO = "data_movimento";
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
    public ResponseEntity<java.util.List<java.util.Map<String, Object>>> listarMovimentacoes(
            @RequestParam(value = "data", required = false) String data) {
        try {
            var dia = data == null ? java.time.LocalDate.now() : java.time.LocalDate.parse(data);
            var lista = new java.util.ArrayList<java.util.Map<String, Object>>();

            // Movimentações manuais (entrada/retirada)
            lista.addAll(movimentacaoRepository.findByDia(dia).stream().map(m -> {
                java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                row.put("id", m.getId());
                row.put("tipo", m.getTipo());
                row.put("valor", m.getValor());
                row.put("descricao", m.getDescricao());
                row.put("usuario", m.getUsuario() != null ? m.getUsuario().getUsername() : null);
                row.put(KEY_DATA_MOVIMENTO, m.getDataMovimento());
                return row;
            }).toList());

            // Vendas do dia como movimentação de tipo 'venda'
            lista.addAll(saleRepository.findByDia(dia).stream().map(v -> {
                java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                row.put("id", v.getId());
                row.put("tipo", "venda");
                row.put("valor", v.getPrecoTotal());
                row.put("descricao", "Venda - " + (v.getProduto() != null ? v.getProduto().getNome() : "Produto") +
                        " x" + v.getQuantidadeVendida() + " (" + v.getMetodoPagamento() + ")");
                row.put("produto_nome", v.getProduto() != null ? v.getProduto().getNome() : null);
                row.put("usuario", null);
                row.put(KEY_DATA_MOVIMENTO, v.getDataVenda());
                return row;
            }).toList());

            // Ordenar por data_movimento desc
            lista.sort((a, b) -> java.time.OffsetDateTime.parse(b.get(KEY_DATA_MOVIMENTO).toString())
                    .compareTo(java.time.OffsetDateTime.parse(a.get(KEY_DATA_MOVIMENTO).toString())));

            return ResponseEntity.ok(lista);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(java.util.List.of());
        }
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
