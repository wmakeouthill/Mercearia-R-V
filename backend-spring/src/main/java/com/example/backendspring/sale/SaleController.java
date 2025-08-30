package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.example.backendspring.caixa.CaixaStatusRepository;
import com.example.backendspring.client.Client;
import com.example.backendspring.client.ClientRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
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

    private final ProductRepository productRepository;
    private final ClientRepository clientRepository;
    private final SaleOrderRepository saleOrderRepository;
    private final SaleReportService saleReportService;
    private final CaixaStatusRepository caixaStatusRepository;
    private final com.example.backendspring.caixa.CaixaMovimentacaoRepository caixaMovimentacaoRepository;
    private final SaleAdjustmentRepository saleAdjustmentRepository;

    private static final String KEY_ERROR = "error";
    private static final String KEY_QTD_VENDIDA = "quantidade_vendida";
    private static final String DEFAULT_PAGAMENTO = "dinheiro";
    private static final Logger log = LoggerFactory.getLogger(SaleController.class);

    @GetMapping
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getAll() {
        return saleOrderRepository.findAllOrderByData().stream()
                // Exclude checkout-created orders from this legacy endpoint
                .filter(o -> o.getPagamentos() == null || o.getPagamentos().isEmpty())
                .map(o -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("id", o.getId());

                    // Original (bruto)
                    int qtdBruta = o.getItens() == null ? 0
                            : o.getItens().stream()
                                    .mapToInt(it -> it.getQuantidade() == null ? 0 : it.getQuantidade()).sum();
                    row.put(KEY_QTD_VENDIDA, qtdBruta);
                    row.put("preco_total", o.getTotalFinal());
                    row.put("adjusted_total", o.getAdjustedTotal());
                    row.put("data_venda", o.getDataVenda());

                    // Devoluções: somar retornos por sale_item
                    java.util.Map<Long, Integer> returnedByItem = new java.util.HashMap<>();
                    try {
                        var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
                        for (var a : adjs) {
                            if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                                returnedByItem.merge(a.getSaleItem().getId(),
                                        a.getQuantity() == null ? 0 : a.getQuantity(), Integer::sum);
                            }
                        }
                    } catch (Exception ignored) {
                    }

                    double netTotal = 0.0;
                    int netQty = 0;
                    double returnedTotal = 0.0;
                    double exchangeDiffTotal = 0.0;
                    if (o.getItens() != null) {
                        for (var it : o.getItens()) {
                            int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
                            int ret = returnedByItem.getOrDefault(it.getId(), 0);
                            int effective = Math.max(0, orig - ret);
                            netQty += effective;
                            // usar preço unitário * effective para líquido
                            double unit = it.getPrecoUnitario() == null ? 0.0 : it.getPrecoUnitario();
                            netTotal += unit * effective;
                            if (ret > 0)
                                returnedTotal += unit * ret;
                        }
                    }
                    // Somar difs de troca (abs) para rastreio
                    try {
                        var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
                        for (var a : adjs) {
                            if ("exchange".equalsIgnoreCase(a.getType()) && a.getPriceDifference() != null) {
                                exchangeDiffTotal += Math.abs(a.getPriceDifference());
                            }
                        }
                    } catch (Exception ignored) {
                    }
                    row.put("net_quantidade_vendida", netQty);
                    row.put("net_total", netTotal);
                    row.put("returned_total", returnedTotal);
                    row.put("exchange_difference_total", exchangeDiffTotal);

                    // Resumo textual de devoluções para UI (ex: "2x Prod A, 1x Prod B")
                    try {
                        if (!returnedByItem.isEmpty() && o.getItens() != null) {
                            java.util.List<String> parts = new java.util.ArrayList<>();
                            for (var it : o.getItens()) {
                                int ret = returnedByItem.getOrDefault(it.getId(), 0);
                                if (ret > 0) {
                                    String nome = it.getProduto() != null ? it.getProduto().getNome()
                                            : ("Item " + it.getId());
                                    parts.add(ret + "x " + nome);
                                }
                            }
                            row.put("returned_resumo", String.join(", ", parts));
                        }
                    } catch (Exception ignored) {
                    }

                    // método pagamento (bruto / original)
                    String metodo = (o.getPagamentos() == null || o.getPagamentos().isEmpty()) ? ""
                            : (o.getPagamentos().size() == 1 ? o.getPagamentos().get(0).getMetodo() : "multiplo");
                    row.put("metodo_pagamento", metodo);

                    // Nome produto / status
                    String labelPedido = "Pedido #" + o.getId();
                    if ("DEVOLVIDA".equalsIgnoreCase(o.getStatus())) {
                        row.put("produto_nome", labelPedido + " (Devolvido)");
                    } else if (o.getItens() == null || o.getItens().isEmpty()) {
                        row.put("produto_nome", labelPedido);
                    } else {
                        // Detect se algum item teve devolução parcial ou total
                        boolean anyReturn = !returnedByItem.isEmpty();
                        boolean fullReturnAll = true;
                        if (o.getItens() != null) {
                            for (var it : o.getItens()) {
                                int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
                                int ret = returnedByItem.getOrDefault(it.getId(), 0);
                                if (ret < orig) {
                                    fullReturnAll = false;
                                    break;
                                }
                            }
                        }
                        String baseNome = o.getItens().get(0).getProduto().getNome();
                        if (anyReturn) {
                            int totalRet = returnedByItem.values().stream().mapToInt(Integer::intValue).sum();
                            row.put("produto_nome", baseNome + " (Devolvido qtd: " + totalRet + ")");
                        } else {
                            row.put("produto_nome", baseNome);
                        }
                    }

                    row.put("codigo_barras", o.getItens() == null || o.getItens().isEmpty() ? null
                            : o.getItens().get(0).getProduto().getCodigoBarras());
                    row.put("produto_imagem", o.getItens() == null || o.getItens().isEmpty() ? null
                            : o.getItens().get(0).getProduto().getImagem());
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
            java.time.OffsetDateTime inicioTs = null;
            java.time.OffsetDateTime fimTs = null;

            // Detect if parameters include time (ISO) and parse accordingly
            try {
                if (from != null && !from.isBlank()) {
                    if (from.contains("T") || from.contains("Z") || from.contains(":")) {
                        inicioTs = java.time.OffsetDateTime.parse(from);
                    } else {
                        inicio = java.time.LocalDate.parse(from);
                    }
                }
                if (to != null && !to.isBlank()) {
                    if (to.contains("T") || to.contains("Z") || to.contains(":")) {
                        fimTs = java.time.OffsetDateTime.parse(to);
                    } else {
                        fim = java.time.LocalDate.parse(to);
                    }
                }
            } catch (Exception ignored) {
            }

            // fetch only orders (unpaged). Prefer timestamp search when provided
            java.util.List<com.example.backendspring.sale.SaleOrder> orders;
            if (inicioTs != null && fimTs != null) {
                log.info("Searching vendas by timestamp range (controller fallback): from={} to={}", inicioTs, fimTs);
                // Fallback: fetch all and filter in-memory to avoid native query binding issues
                var all = saleOrderRepository.findAllOrderByData();
                final java.time.OffsetDateTime fromVal = inicioTs;
                final java.time.OffsetDateTime toVal = fimTs;
                orders = all.stream().filter(o -> {
                    var dv = o.getDataVenda();
                    return (dv != null && !dv.isBefore(fromVal) && !dv.isAfter(toVal));
                }).toList();
                log.info("Orders after timestamp in-memory filter: {}", orders.size());
            } else if (inicio != null && fim != null) {
                log.info("Searching vendas by date range: {} to {}", inicio, fim);
                orders = saleOrderRepository.findByPeriodo(inicio, fim);
            } else {
                orders = saleOrderRepository.findAllOrderByData();
            }

            // Exclude checkout orders (CheckoutController is authoritative for these)
            // But when the client requested a timestamp or date range, include checkout
            // orders as well so time-based searches return expected results.
            if (inicioTs == null && fimTs == null && inicio == null && fim == null) {
                orders = orders.stream().filter(o -> o.getPagamentos() == null || o.getPagamentos().isEmpty()).toList();
            }

            java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();

            for (var o : orders) {
                var m = new java.util.LinkedHashMap<String, Object>();
                m.put("id", o.getId());
                m.put("produto_id", o.getId());
                // Nome / status
                if ("DEVOLVIDA".equalsIgnoreCase(o.getStatus())) {
                    m.put("produto_nome", "Pedido #" + o.getId() + " (Devolvido)");
                } else if (o.getItens() != null && !o.getItens().isEmpty()
                        && o.getItens().get(0).getProduto() != null) {
                    // Calcular devoluções
                    java.util.Map<Long, Integer> returnedByItem = new java.util.HashMap<>();
                    try {
                        var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
                        for (var a : adjs) {
                            if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                                returnedByItem.merge(a.getSaleItem().getId(),
                                        a.getQuantity() == null ? 0 : a.getQuantity(), Integer::sum);
                            }
                        }
                    } catch (Exception ignored) {
                    }
                    boolean anyReturn = !returnedByItem.isEmpty();
                    boolean fullReturnAll = true;
                    if (o.getItens() != null) {
                        for (var it : o.getItens()) {
                            int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
                            int ret = returnedByItem.getOrDefault(it.getId(), 0);
                            if (ret < orig) {
                                fullReturnAll = false;
                                break;
                            }
                        }
                    }
                    String baseNome = o.getItens().get(0).getProduto().getNome();
                    if (anyReturn) {
                        int totalRet = returnedByItem.values().stream().mapToInt(Integer::intValue).sum();
                        m.put("produto_nome", baseNome + " (Devolvido qtd: " + totalRet + ")");
                    } else {
                        m.put("produto_nome", baseNome);
                    }
                } else {
                    m.put("produto_nome", "Pedido #" + o.getId());
                }
                m.put("produto_imagem",
                        o.getItens() != null && !o.getItens().isEmpty() && o.getItens().get(0).getProduto() != null
                                ? o.getItens().get(0).getProduto().getImagem()
                                : null);
                int qtdBruta = 0;
                if (o.getItens() != null) {
                    for (var it : o.getItens())
                        qtdBruta += (it.getQuantidade() == null ? 0 : it.getQuantidade());
                }
                m.put("quantidade_vendida", qtdBruta);
                m.put("preco_total", o.getTotalFinal());
                // If adjusted_total present and >0 propagate for clarity
                if (o.getAdjustedTotal() != null) {
                    m.put("adjusted_total", o.getAdjustedTotal());
                }

                // Devoluções (liquido)
                java.util.Map<Long, Integer> returnedByItem = new java.util.HashMap<>();
                try {
                    var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
                    for (var a : adjs) {
                        if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                            returnedByItem.merge(a.getSaleItem().getId(), a.getQuantity() == null ? 0 : a.getQuantity(),
                                    Integer::sum);
                        }
                    }
                } catch (Exception ignored) {
                }
                int netQty = 0;
                double netTotal = 0.0;
                double returnedTotal = 0.0;
                double exchangeDiffTotal = 0.0;
                if (o.getItens() != null) {
                    for (var it : o.getItens()) {
                        int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
                        int ret = returnedByItem.getOrDefault(it.getId(), 0);
                        int effective = Math.max(0, orig - ret);
                        netQty += effective;
                        double unit = it.getPrecoUnitario() == null ? 0.0 : it.getPrecoUnitario();
                        netTotal += unit * effective;
                        if (ret > 0)
                            returnedTotal += unit * ret;
                    }
                }
                // exchange diffs
                try {
                    var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
                    for (var a : adjs) {
                        if ("exchange".equalsIgnoreCase(a.getType()) && a.getPriceDifference() != null) {
                            exchangeDiffTotal += Math.abs(a.getPriceDifference());
                        }
                    }
                } catch (Exception ignored) {
                }
                m.put("net_quantidade_vendida", netQty);
                m.put("net_total", netTotal);
                m.put("returned_total", returnedByItem.isEmpty() ? 0.0 : (o.getTotalFinal() - netTotal));
                m.put("returned_total", returnedTotal);
                m.put("exchange_difference_total", exchangeDiffTotal);
                if (!returnedByItem.isEmpty()) {
                    java.util.List<String> parts = new java.util.ArrayList<>();
                    if (o.getItens() != null) {
                        for (var it : o.getItens()) {
                            int ret = returnedByItem.getOrDefault(it.getId(), 0);
                            if (ret > 0) {
                                String nome = it.getProduto() != null ? it.getProduto().getNome()
                                        : ("Item " + it.getId());
                                parts.add(ret + "x " + nome);
                            }
                        }
                    }
                    m.put("returned_resumo", String.join(", ", parts));
                }
                m.put("data_venda", o.getDataVenda());
                // operador (username) and cliente info
                if (o.getOperador() != null) {
                    var u = o.getOperador();
                    m.put("operator", u.getUsername());
                    m.put("operator_username", u.getUsername());
                    m.put("operador_username", u.getUsername());
                    m.put("operator_id", u.getId());
                } else {
                    m.put("operator", null);
                    m.put("operator_username", null);
                    m.put("operador_username", null);
                    m.put("operator_id", null);
                }
                if (o.getCliente() != null) {
                    var c = o.getCliente();
                    m.put("customer_name", c.getNome());
                    m.put("cliente_nome", c.getNome());
                    m.put("customer_id", c.getId());
                    m.put("cliente_id", c.getId());
                } else {
                    m.put("customer_name", null);
                }
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
                // Incluir pagamentos (quando presentes) para que o frontend possa montar o
                // resumo
                var pagamentos = (o.getPagamentos() == null) ? java.util.List.of()
                        : o.getPagamentos().stream().map(p -> {
                            var pm = new java.util.LinkedHashMap<String, Object>();
                            pm.put("metodo", p.getMetodo());
                            pm.put("valor", p.getValor());
                            pm.put("troco", p.getTroco());
                            return pm;
                        }).toList();
                m.put("pagamentos", pagamentos);
                m.put("itens", itens);
                // include adjustments when available
                try {
                    var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
                    var adjsMapped = adjs == null ? java.util.List.of()
                            : adjs.stream().map(a -> {
                                var mm = new java.util.LinkedHashMap<String, Object>();
                                mm.put("id", a.getId());
                                mm.put("type", a.getType());
                                mm.put("sale_item_id", a.getSaleItem() != null ? a.getSaleItem().getId() : null);
                                mm.put("quantity", a.getQuantity());
                                mm.put("replacement_product_id", a.getReplacementProductId());
                                mm.put("price_difference", a.getPriceDifference());
                                mm.put("payment_method", a.getPaymentMethod());
                                mm.put("notes", a.getNotes());
                                mm.put("operator_username", a.getOperatorUsername());
                                mm.put("created_at", a.getCreatedAt());
                                return mm;
                            }).toList();
                    m.put("adjustments", adjsMapped);
                } catch (Exception ignored) {
                }
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

        // bloquear venda caso caixa fechado (removida exceção para admin)
        try {
            var status = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
                return ResponseEntity.status(403)
                        .body(Map.of(KEY_ERROR,
                                "Caixa fechado. Operação não é permitida quando o caixa está fechado."));
            }
        } catch (Exception ignored) {
        }

        produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - req.getQuantidadeVendida());
        productRepository.save(produto);

        // Create a SaleOrder (unified model) with a single item and a single payment
        var now = OffsetDateTime.now();
        SaleOrder order = SaleOrder.builder()
                .dataVenda(now)
                .subtotal(req.getPrecoTotal())
                .desconto(0.0)
                .acrescimo(0.0)
                .totalFinal(req.getPrecoTotal())
                .operador(null)
                .build();

        SaleItem it = SaleItem.builder()
                .venda(order)
                .produto(produto)
                .quantidade(req.getQuantidadeVendida())
                .precoUnitario(req.getPrecoTotal() / req.getQuantidadeVendida())
                .precoTotal(req.getPrecoTotal())
                .build();
        order.getItens().add(it);

        SalePayment sp = SalePayment.builder()
                .venda(order)
                .metodo(metodo)
                .valor(req.getPrecoTotal())
                .troco(0.0)
                .build();
        order.getPagamentos().add(sp);

        // create caixa movimentacao for cash payment when session is active
        try {
            var statusAtual = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (statusAtual != null && "dinheiro".equals(metodo)) {
                com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                        .builder()
                        .tipo("entrada")
                        .valor(req.getPrecoTotal())
                        .descricao("Venda " + order.getId())
                        .dataMovimento(OffsetDateTime.now())
                        .criadoEm(OffsetDateTime.now())
                        .operador(null)
                        .caixaStatus(statusAtual)
                        .build();
                try {
                    caixaMovimentacaoRepository.save(mv);
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }

        if (req.getClienteId() != null) {
            Client cliente = clientRepository.findById(req.getClienteId()).orElse(null);
            if (cliente != null)
                order.setCliente(cliente);
        }

        saleOrderRepository.save(order);

        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", order.getId());
        resp.put("produto_id", produto.getId());
        resp.put(KEY_QTD_VENDIDA, req.getQuantidadeVendida());
        resp.put("preco_total", req.getPrecoTotal());
        resp.put("data_venda", order.getDataVenda());
        resp.put("metodo_pagamento", metodo);
        resp.put("produto_nome", produto.getNome());
        if (order.getCliente() != null) {
            resp.put("cliente_id", order.getCliente().getId());
            resp.put("cliente_nome", order.getCliente().getNome());
            resp.put("cliente_email", order.getCliente().getEmail());
            resp.put("cliente_telefone", order.getCliente().getTelefone());
        }

        return ResponseEntity.status(201).body(resp);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<Object> delete(@PathVariable Long id, HttpServletRequest request) {
        // legacy delete: convert to deleting an order if mapping exists; otherwise
        // return 404
        return ResponseEntity.status(410)
                .body(Map.of(KEY_ERROR, "Legacy venda removida. Use endpoints de orders para operações."));
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

    @GetMapping("/relatorios/total")
    public Map<String, Object> relatorioTotal() {
        return saleReportService.getResumoTotal();
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
