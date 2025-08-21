package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.example.backendspring.client.Client;
import com.example.backendspring.client.ClientRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import com.example.backendspring.caixa.CaixaStatusRepository;
import com.example.backendspring.user.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/vendas")
@RequiredArgsConstructor
public class SaleController {

    private final SaleRepository saleRepository;
    private final ProductRepository productRepository;
    private final ClientRepository clientRepository;
    private final SaleOrderRepository saleOrderRepository;
    private final SaleReportService saleReportService;
    private final SaleDeletionRepository saleDeletionRepository;
    private final ObjectMapper objectMapper;
    private final com.example.backendspring.caixa.CaixaStatusRepository caixaStatusRepository;
    private final com.example.backendspring.user.UserRepository userRepository;

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_QTD_VENDIDA = "quantidade_vendida";
    private static final String DEFAULT_PAGAMENTO = "dinheiro";
    private static final Logger log = LoggerFactory.getLogger(SaleController.class);

    @GetMapping
    public List<Map<String, Object>> getAll() {
        return saleRepository.findAll().stream().map(v -> {
            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", v.getId());
            row.put("produto_id", v.getProduto().getId());
            row.put(KEY_QTD_VENDIDA, v.getQuantidadeVendida());
            row.put("preco_total", v.getPrecoTotal());
            row.put("data_venda", v.getDataVenda());
            row.put("metodo_pagamento", v.getMetodoPagamento());
            row.put("produto_nome", v.getProduto().getNome());
            row.put("codigo_barras", v.getProduto().getCodigoBarras());
            row.put("produto_imagem", v.getProduto().getImagem());
            return row;
        }).toList();
    }

    @GetMapping("/detalhadas")
    @Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> getDetalhadas(
            @RequestParam(value = "page", required = false, defaultValue = "0") int page,
            @RequestParam(value = "size", required = false, defaultValue = "20") int size,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to) {
        try {
            java.time.LocalDate inicio = null;
            java.time.LocalDate fim = null;
            try {
                if (from != null && !from.isBlank())
                    inicio = java.time.LocalDate.parse(from);
                if (to != null && !to.isBlank())
                    fim = java.time.LocalDate.parse(to);
            } catch (Exception ignored) {
            }

            // fetch legacy sales and orders (unpaged), then merge and page in-memory to
            // preserve unified ordering
            java.util.List<com.example.backendspring.sale.Sale> legacy = (inicio != null && fim != null)
                    ? saleRepository.findByPeriodo(inicio, fim)
                    : saleRepository.findAllOrderByData();

            java.util.List<com.example.backendspring.sale.SaleOrder> orders = (inicio != null && fim != null)
                    ? saleOrderRepository.findByPeriodo(inicio, fim)
                    : saleOrderRepository.findAllOrderByData();

            java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();

            for (var s : legacy) {
                var m = new java.util.LinkedHashMap<String, Object>();
                m.put("id", s.getId());
                m.put("produto_id", s.getProduto() != null ? s.getProduto().getId() : null);
                m.put("produto_nome", s.getProduto() != null ? s.getProduto().getNome() : null);
                m.put("produto_imagem", s.getProduto() != null ? s.getProduto().getImagem() : null);
                m.put("quantidade_vendida", s.getQuantidadeVendida());
                m.put("preco_total", s.getPrecoTotal());
                m.put("data_venda", s.getDataVenda());
                m.put("itens", java.util.List.of());
                m.put("_isCheckout", false);
                m.put("row_id", "legacy-" + s.getId());
                rows.add(m);
            }

            for (var o : orders) {
                var m = new java.util.LinkedHashMap<String, Object>();
                m.put("id", o.getId());
                m.put("produto_id", o.getId());
                m.put("produto_nome",
                        o.getItens() != null && !o.getItens().isEmpty() && o.getItens().get(0).getProduto() != null
                                ? o.getItens().get(0).getProduto().getNome()
                                : ("Pedido #" + o.getId()));
                m.put("produto_imagem",
                        o.getItens() != null && !o.getItens().isEmpty() && o.getItens().get(0).getProduto() != null
                                ? o.getItens().get(0).getProduto().getImagem()
                                : null);
                int qtd = 0;
                if (o.getItens() != null)
                    for (var it : o.getItens())
                        qtd += (it.getQuantidade() == null ? 0 : it.getQuantidade());
                m.put("quantidade_vendida", qtd);
                m.put("preco_total", o.getTotalFinal());
                m.put("data_venda", o.getDataVenda());
                var itens = o.getItens().stream().map(it -> {
                    var im = new java.util.LinkedHashMap<String, Object>();
                    im.put("produto_id", it.getProduto() != null ? it.getProduto().getId() : null);
                    im.put("produto_nome", it.getProduto() != null ? it.getProduto().getNome() : null);
                    im.put("produto_imagem", it.getProduto() != null ? it.getProduto().getImagem() : null);
                    im.put("quantidade", it.getQuantidade());
                    im.put("preco_unitario", it.getPrecoUnitario());
                    im.put("preco_total", it.getPrecoTotal());
                    return im;
                }).toList();
                m.put("itens", itens);
                m.put("_isCheckout", true);
                m.put("row_id", "checkout-" + o.getId());
                rows.add(m);
            }

            // sort by date desc
            rows.sort((a, b) -> {
                var da = (java.time.OffsetDateTime) a.get("data_venda");
                var db = (java.time.OffsetDateTime) b.get("data_venda");
                return db.compareTo(da);
            });

            int total = rows.size();
            int fromIdx = Math.max(0, page * size);
            int toIdx = Math.min(rows.size(), fromIdx + size);
            var pageItems = rows.subList(fromIdx, toIdx);

            java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
            resp.put("items", pageItems);
            resp.put("total", total);
            resp.put("hasNext", toIdx < total);
            resp.put("page", page);
            resp.put("size", size);
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("Failed to build detailed vendas page", e);
            try (java.io.StringWriter sw = new java.io.StringWriter();
                    java.io.PrintWriter pw = new java.io.PrintWriter(sw)) {
                e.printStackTrace(pw);
                java.util.Map<String, Object> err = new java.util.LinkedHashMap<>();
                err.put("error", "Failed to load vendas");
                err.put("message", e.getMessage());
                err.put("stack", sw.toString());
                return ResponseEntity.status(500).body(err);
            } catch (Exception ex) {
                log.error("Failed to render exception", ex);
                return ResponseEntity.status(500).body(java.util.Map.of("error", "Failed to load vendas"));
            }
        }
    }

    @PostMapping
    @Transactional
    public ResponseEntity<Object> create(@RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody CreateSaleRequest req) {
        if (req.getProdutoId() == null || req.getQuantidadeVendida() == null || req.getPrecoTotal() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of(KEY_ERROR, "Produto, quantidade e preço total são obrigatórios"));
        }

        String metodoValue = req.getMetodoPagamento() == null ? DEFAULT_PAGAMENTO : req.getMetodoPagamento();
        String metodo = switch (metodoValue) {
            case DEFAULT_PAGAMENTO, "cartao_credito", "cartao_debito", "pix" -> metodoValue;
            default -> DEFAULT_PAGAMENTO;
        };

        if (req.getQuantidadeVendida() <= 0) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Quantidade deve ser maior que zero"));
        }

        Product produto = productRepository.findById(req.getProdutoId()).orElse(null);
        if (produto == null)
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Produto não encontrado"));
        if (produto.getQuantidadeEstoque() < req.getQuantidadeVendida()) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Estoque insuficiente"));
        }

        // bloquear venda caso caixa fechado e usuário não seja admin
        try {
            var status = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
                var u = userRepository.findById(userId).orElse(null);
                if (u == null || u.getRole() == null || !u.getRole().equals("admin")) {
                    return ResponseEntity.status(403)
                            .body(Map.of(KEY_ERROR, "Caixa fechado. Operação permitida somente para admin."));
                }
            }
        } catch (Exception ignored) {
        }

        produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - req.getQuantidadeVendida());
        productRepository.save(produto);

        Sale.SaleBuilder builder = Sale.builder()
                .produto(produto)
                .quantidadeVendida(req.getQuantidadeVendida())
                .precoTotal(req.getPrecoTotal())
                .dataVenda(OffsetDateTime.now())
                .metodoPagamento(metodo);

        if (req.getClienteId() != null) {
            Client cliente = clientRepository.findById(req.getClienteId()).orElse(null);
            if (cliente != null) {
                builder.cliente(cliente);
            }
        }

        Sale sale = builder.build();
        saleRepository.save(sale);

        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", sale.getId());
        resp.put("produto_id", produto.getId());
        resp.put(KEY_QTD_VENDIDA, sale.getQuantidadeVendida());
        resp.put("preco_total", sale.getPrecoTotal());
        resp.put("data_venda", sale.getDataVenda());
        resp.put("metodo_pagamento", sale.getMetodoPagamento());
        resp.put("produto_nome", produto.getNome());
        if (sale.getCliente() != null) {
            resp.put("cliente_id", sale.getCliente().getId());
            resp.put("cliente_nome", sale.getCliente().getNome());
            resp.put("cliente_email", sale.getCliente().getEmail());
            resp.put("cliente_telefone", sale.getCliente().getTelefone());
        }

        return ResponseEntity.status(201).body(resp);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<Object> delete(@PathVariable Long id, HttpServletRequest request) {
        Sale venda = saleRepository.findById(id).orElse(null);
        if (venda == null)
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Venda não encontrada"));

        // build payload to store in audit
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("id", venda.getId());
        payload.put("produto_id", venda.getProduto().getId());
        payload.put(KEY_QTD_VENDIDA, venda.getQuantidadeVendida());
        payload.put("preco_total", venda.getPrecoTotal());
        payload.put("data_venda", venda.getDataVenda());
        payload.put("metodo_pagamento", venda.getMetodoPagamento());
        payload.put("produto_nome", venda.getProduto().getNome());

        // record deletion audit BEFORE deleting to ensure audit exists; keep within
        // transaction so rollback will undo delete if audit fails
        try {
            String payloadJson = objectMapper.writeValueAsString(payload);
            String deletedBy = null;
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null)
                deletedBy = auth.getName();
            SaleDeletion sd = SaleDeletion.builder()
                    .saleId(venda.getId())
                    .saleType("legacy")
                    .payload(payloadJson)
                    .deletedBy(deletedBy)
                    .deletedAt(OffsetDateTime.now())
                    .build();
            saleDeletionRepository.saveAndFlush(sd);
            log.info("SALE_DELETION AUDIT_SAVED saleDeletionId={} saleId={}", sd.getId(), sd.getSaleId());
        } catch (Exception e) {
            // if audit fails, abort (transactional) so delete won't happen
            log.error("Audit save failed, aborting delete: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to record sale deletion audit", e);
        }

        // restore stock and delete sale
        Product produto = venda.getProduto();
        produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() + venda.getQuantidadeVendida());
        productRepository.save(produto);
        saleRepository.deleteById(id);

        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Venda deletada com sucesso"));
    }

    @GetMapping("/relatorios/dia")
    public Map<String, Object> relatorioDia(@RequestParam(value = "data", required = false) String data) {
        var dia = (data == null || data.isBlank()) ? java.time.LocalDate.now() : java.time.LocalDate.parse(data);
        return saleReportService.getResumoDia(dia);
    }

    @GetMapping("/relatorios/mes")
    public Map<String, Object> relatorioMes() {
        var hoje = java.time.OffsetDateTime.now();
        var ym = java.time.YearMonth.from(hoje);
        return saleReportService.getResumoMes(ym.getYear(), ym.getMonthValue());
    }

    @Data
    public static class CreateSaleRequest {
        @JsonProperty("produto_id")
        private Long produtoId;

        @JsonProperty("quantidade_vendida")
        private Integer quantidadeVendida;

        @JsonProperty("preco_total")
        private Double precoTotal;

        @JsonProperty("metodo_pagamento")
        private String metodoPagamento;
        @JsonProperty("cliente_id")
        private Long clienteId;
    }
}
