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
    private static final String KEY_PRECO_TOTAL = "preco_total";
    private static final String KEY_DATA_VENDA = "data_venda";
    private static final String KEY_RETURN = "return";
    private static final String KEY_RETURNED_TOTAL = "returned_total";
    private static final String KEY_PRODUTO_NOME = "produto_nome";
    private static final String KEY_PRODUTO_ID = "produto_id";
    private static final String KEY_PRODUTO_IMAGEM = "produto_imagem";
    private static final String KEY_PEDIDO_PREFIX = "Pedido #";
    private static final String KEY_OPERATOR_USERNAME = "operator_username";
    private static final Logger log = LoggerFactory.getLogger(SaleController.class);

    @GetMapping
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getAll() {
        return saleOrderRepository.findAllOrderByData().stream()
                // Exclude checkout-created orders from this legacy endpoint
                .filter(o -> o.getPagamentos() == null || o.getPagamentos().isEmpty())
                .map(this::mapSaleOrderToBasicRow)
                .toList();
    }

    private Map<String, Object> mapSaleOrderToBasicRow(SaleOrder o) {
        java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
        row.put("id", o.getId());

        // Original (bruto)
        int qtdBruta = calculateTotalQuantity(o);
        row.put(KEY_QTD_VENDIDA, qtdBruta);
        row.put(KEY_PRECO_TOTAL, o.getTotalFinal());
        row.put("adjusted_total", o.getAdjustedTotal());
        row.put(KEY_DATA_VENDA, o.getDataVenda());

        // Devoluções: somar retornos por sale_item
        java.util.Map<Long, Integer> returnedByItem = calculateReturnedItems(o);

        addNetTotalsToRow(row, o, returnedByItem);
        addReturnedSummaryToRow(row, o, returnedByItem);
        addPaymentMethodToRow(row, o);
        addProductInfoToRow(row, o, returnedByItem);

        return row;
    }

    private int calculateTotalQuantity(SaleOrder o) {
        if (o.getItens() == null) {
            return 0;
        }
        return o.getItens().stream()
                .mapToInt(it -> it.getQuantidade() != null ? it.getQuantidade() : 0)
                .sum();
    }

    private java.util.Map<Long, Integer> calculateReturnedItems(SaleOrder o) {
        java.util.Map<Long, Integer> returnedByItem = new java.util.HashMap<>();
        try {
            var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
            for (var a : adjs) {
                if (KEY_RETURN.equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                    returnedByItem.merge(a.getSaleItem().getId(),
                            a.getQuantity() == null ? 0 : a.getQuantity(), Integer::sum);
                }
            }
        } catch (Exception e) {
            // Log but continue processing
            log.debug("Failed to calculate returned items for order {}: {}", o.getId(), e.getMessage());
        }
        return returnedByItem;
    }

    private void addNetTotalsToRow(java.util.Map<String, Object> row, SaleOrder o,
            java.util.Map<Long, Integer> returnedByItem) {
        double netTotal = 0.0;
        int netQty = 0;
        double returnedTotal = 0.0;

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
        double exchangeDiffTotal = calculateExchangeDifferences(o);

        row.put("net_quantidade_vendida", netQty);
        row.put("net_total", netTotal);
        row.put(KEY_RETURNED_TOTAL, returnedTotal);
        row.put("exchange_difference_total", exchangeDiffTotal);
    }

    private double calculateExchangeDifferences(SaleOrder o) {
        double exchangeDiffTotal = 0.0;
        try {
            var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
            for (var a : adjs) {
                if ("exchange".equalsIgnoreCase(a.getType()) && a.getPriceDifference() != null) {
                    exchangeDiffTotal += Math.abs(a.getPriceDifference());
                }
            }
        } catch (Exception e) {
            // Log but continue processing
            log.debug("Failed to calculate exchange differences for order {}: {}", o.getId(), e.getMessage());
        }
        return exchangeDiffTotal;
    }

    private void addReturnedSummaryToRow(java.util.Map<String, Object> row, SaleOrder o,
            java.util.Map<Long, Integer> returnedByItem) {
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
        } catch (Exception e) {
            // Log but continue processing
            log.debug("Failed to build returned summary for order {}: {}", o.getId(), e.getMessage());
        }
    }

    private void addPaymentMethodToRow(java.util.Map<String, Object> row, SaleOrder o) {
        String metodo;
        if (o.getPagamentos() == null || o.getPagamentos().isEmpty()) {
            metodo = "";
        } else if (o.getPagamentos().size() == 1) {
            metodo = o.getPagamentos().get(0).getMetodo();
        } else {
            metodo = "multiplo";
        }
        row.put("metodo_pagamento", metodo);
    }

    private void addProductInfoToRow(java.util.Map<String, Object> row, SaleOrder o,
            java.util.Map<Long, Integer> returnedByItem) {
        // Nome produto / status
        String labelPedido = KEY_PEDIDO_PREFIX + o.getId();
        if ("DEVOLVIDA".equalsIgnoreCase(o.getStatus())) {
            row.put(KEY_PRODUTO_NOME, labelPedido + " (Devolvido)");
        } else if (o.getItens() == null || o.getItens().isEmpty()) {
            row.put(KEY_PRODUTO_NOME, labelPedido);
        } else {
            // Detect se algum item teve devolução parcial ou total
            boolean anyReturn = !returnedByItem.isEmpty();
            String baseNome = o.getItens().get(0).getProduto().getNome();
            if (anyReturn) {
                int totalRet = returnedByItem.values().stream().mapToInt(Integer::intValue).sum();
                row.put(KEY_PRODUTO_NOME, baseNome + " (Devolvido qtd: " + totalRet + ")");
            } else {
                row.put(KEY_PRODUTO_NOME, baseNome);
            }
        }

        row.put("codigo_barras", o.getItens() == null || o.getItens().isEmpty() ? null
                : o.getItens().get(0).getProduto().getCodigoBarras());
        row.put(KEY_PRODUTO_IMAGEM, o.getItens() == null || o.getItens().isEmpty() ? null
                : o.getItens().get(0).getProduto().getImagem());
    }

    @GetMapping("/detalhadas")
    @Transactional(readOnly = true)
    public ResponseEntity<java.util.Map<String, Object>> getDetalhadas(
            @RequestParam(value = "page", required = false, defaultValue = "0") int page,
            @RequestParam(value = "size", required = false, defaultValue = "20") int size,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to) {
        try {
            DateRangeParams dateParams = parseDateRangeParams(from, to);
            java.util.List<com.example.backendspring.sale.SaleOrder> orders = fetchOrdersByDateRange(dateParams);
            orders = filterOrdersIfNeeded(orders, dateParams);

            java.util.List<java.util.Map<String, Object>> rows = buildDetailedRows(orders);
            sortRowsByDateDesc(rows);

            return buildPaginatedResponse(rows, page, size);
        } catch (Exception e) {
            return handleDetailedVendasError(e);
        }
    }

    private static class DateRangeParams {
        java.time.LocalDate inicio;
        java.time.LocalDate fim;
        java.time.OffsetDateTime inicioTs;
        java.time.OffsetDateTime fimTs;
    }

    private DateRangeParams parseDateRangeParams(String from, String to) {
        DateRangeParams params = new DateRangeParams();

        // Detect if parameters include time (ISO) and parse accordingly
        try {
            if (from != null && !from.isBlank()) {
                if (from.contains("T") || from.contains("Z") || from.contains(":")) {
                    params.inicioTs = java.time.OffsetDateTime.parse(from);
                } else {
                    params.inicio = java.time.LocalDate.parse(from);
                }
            }
            if (to != null && !to.isBlank()) {
                if (to.contains("T") || to.contains("Z") || to.contains(":")) {
                    params.fimTs = java.time.OffsetDateTime.parse(to);
                } else {
                    params.fim = java.time.LocalDate.parse(to);
                }
            }
        } catch (Exception e) {
            // Log parse errors but continue with null values
            log.debug("Failed to parse date parameters from={} to={}: {}", from, to, e.getMessage());
        }

        return params;
    }

    private java.util.List<com.example.backendspring.sale.SaleOrder> fetchOrdersByDateRange(DateRangeParams params) {
        // fetch only orders (unpaged). Prefer timestamp search when provided
        if (params.inicioTs != null && params.fimTs != null) {
            log.info("Searching vendas by timestamp range (controller fallback): from={} to={}", params.inicioTs,
                    params.fimTs);
            // Fallback: fetch all and filter in-memory to avoid native query binding issues
            var all = saleOrderRepository.findAllOrderByData();
            final java.time.OffsetDateTime fromVal = params.inicioTs;
            final java.time.OffsetDateTime toVal = params.fimTs;
            var filtered = all.stream().filter(o -> {
                var dv = o.getDataVenda();
                return (dv != null && !dv.isBefore(fromVal) && !dv.isAfter(toVal));
            }).toList();
            log.info("Orders after timestamp in-memory filter: {}", filtered.size());
            return filtered;
        } else if (params.inicio != null && params.fim != null) {
            log.info("Searching vendas by date range: {} to {}", params.inicio, params.fim);
            return saleOrderRepository.findByPeriodo(params.inicio, params.fim);
        } else {
            return saleOrderRepository.findAllOrderByData();
        }
    }

    private java.util.List<com.example.backendspring.sale.SaleOrder> filterOrdersIfNeeded(
            java.util.List<com.example.backendspring.sale.SaleOrder> orders, DateRangeParams params) {
        // Exclude checkout orders (CheckoutController is authoritative for these)
        // But when the client requested a timestamp or date range, include checkout
        // orders as well so time-based searches return expected results.
        if (params.inicioTs == null && params.fimTs == null && params.inicio == null && params.fim == null) {
            return orders.stream().filter(o -> o.getPagamentos() == null || o.getPagamentos().isEmpty()).toList();
        }
        return orders;
    }

    private java.util.List<java.util.Map<String, Object>> buildDetailedRows(
            java.util.List<com.example.backendspring.sale.SaleOrder> orders) {
        java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();

        for (var o : orders) {
            var m = buildDetailedOrderRow(o);
            rows.add(m);
        }

        return rows;
    }

    private java.util.Map<String, Object> buildDetailedOrderRow(com.example.backendspring.sale.SaleOrder o) {
        var m = new java.util.LinkedHashMap<String, Object>();
        m.put("id", o.getId());
        m.put(KEY_PRODUTO_ID, o.getId());

        addOrderNameAndStatus(m, o);
        addOrderImage(m, o);
        addOrderQuantityAndPrice(m, o);
        addOrderNetTotalsDetailed(m, o);
        addOrderOperatorAndCustomer(m, o);
        addOrderItems(m, o);
        addOrderPayments(m, o);
        addOrderAdjustments(m, o);

        m.put("_isCheckout", true);
        m.put("row_id", "checkout-" + o.getId());

        return m;
    }

    private void addOrderNameAndStatus(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o) {
        // Nome / status
        if ("DEVOLVIDA".equalsIgnoreCase(o.getStatus())) {
            m.put(KEY_PRODUTO_NOME, KEY_PEDIDO_PREFIX + o.getId() + " (Devolvido)");
        } else if (o.getItens() != null && !o.getItens().isEmpty()
                && o.getItens().get(0).getProduto() != null) {
            // Calcular devoluções
            java.util.Map<Long, Integer> returnedByItem = calculateReturnedItems(o);
            boolean anyReturn = !returnedByItem.isEmpty();
            String baseNome = o.getItens().get(0).getProduto().getNome();
            if (anyReturn) {
                int totalRet = returnedByItem.values().stream().mapToInt(Integer::intValue).sum();
                m.put(KEY_PRODUTO_NOME, baseNome + " (Devolvido qtd: " + totalRet + ")");
            } else {
                m.put(KEY_PRODUTO_NOME, baseNome);
            }
        } else {
            m.put(KEY_PRODUTO_NOME, KEY_PEDIDO_PREFIX + o.getId());
        }
    }

    private void addOrderImage(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o) {
        m.put(KEY_PRODUTO_IMAGEM,
                o.getItens() != null && !o.getItens().isEmpty() && o.getItens().get(0).getProduto() != null
                        ? o.getItens().get(0).getProduto().getImagem()
                        : null);
    }

    private void addOrderQuantityAndPrice(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o) {
        int qtdBruta = calculateTotalQuantity(o);
        m.put(KEY_QTD_VENDIDA, qtdBruta);
        m.put(KEY_PRECO_TOTAL, o.getTotalFinal());
        // If adjusted_total present and >0 propagate for clarity
        if (o.getAdjustedTotal() != null) {
            m.put("adjusted_total", o.getAdjustedTotal());
        }
    }

    private void addOrderNetTotalsDetailed(java.util.Map<String, Object> m,
            com.example.backendspring.sale.SaleOrder o) {
        // Devoluções (liquido)
        java.util.Map<Long, Integer> returnedByItem = calculateReturnedItems(o);
        int netQty = 0;
        double netTotal = 0.0;
        double returnedTotal = 0.0;

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
        double exchangeDiffTotal = calculateExchangeDifferences(o);

        m.put("net_quantidade_vendida", netQty);
        m.put("net_total", netTotal);
        m.put(KEY_RETURNED_TOTAL, returnedTotal);
        m.put("exchange_difference_total", exchangeDiffTotal);

        if (!returnedByItem.isEmpty()) {
            addReturnedSummary(m, o, returnedByItem);
        }
        m.put(KEY_DATA_VENDA, o.getDataVenda());
    }

    private void addReturnedSummary(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o,
            java.util.Map<Long, Integer> returnedByItem) {
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

    private void addOrderOperatorAndCustomer(java.util.Map<String, Object> m,
            com.example.backendspring.sale.SaleOrder o) {
        // operador (username) and cliente info
        if (o.getOperador() != null) {
            var u = o.getOperador();
            m.put("operator", u.getUsername());
            m.put(KEY_OPERATOR_USERNAME, u.getUsername());
            m.put("operador_username", u.getUsername());
            m.put("operator_id", u.getId());
        } else {
            m.put("operator", null);
            m.put(KEY_OPERATOR_USERNAME, null);
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
    }

    private void addOrderItems(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o) {
        var itens = o.getItens().stream().map(it -> {
            var im = new java.util.LinkedHashMap<String, Object>();
            im.put(KEY_PRODUTO_ID, it.getProduto() != null ? it.getProduto().getId() : null);
            im.put(KEY_PRODUTO_NOME, it.getProduto() != null ? it.getProduto().getNome() : null);
            im.put(KEY_PRODUTO_IMAGEM, it.getProduto() != null ? it.getProduto().getImagem() : null);
            im.put("quantidade", it.getQuantidade());
            im.put("preco_unitario", it.getPrecoUnitario());
            im.put(KEY_PRECO_TOTAL, it.getPrecoTotal());
            return im;
        }).toList();
        m.put("itens", itens);
    }

    private void addOrderPayments(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o) {
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
    }

    private void addOrderAdjustments(java.util.Map<String, Object> m, com.example.backendspring.sale.SaleOrder o) {
        // include adjustments when available
        try {
            var adjs = saleAdjustmentRepository.findBySaleOrderId(o.getId());
            var adjsMapped = adjs == null ? java.util.List.of()
                    : adjs.stream().map(a -> {
                        var mm = new java.util.LinkedHashMap<String, Object>();
                        mm.put("id", a.getId());
                        mm.put("type", a.getType());
                        mm.put("sale_item_id", getSaleItemId(a));
                        mm.put("quantity", a.getQuantity());
                        mm.put("replacement_product_id", a.getReplacementProductId());
                        mm.put("price_difference", a.getPriceDifference());
                        mm.put("payment_method", a.getPaymentMethod());
                        mm.put("notes", a.getNotes());
                        mm.put(KEY_OPERATOR_USERNAME, a.getOperatorUsername());
                        mm.put("created_at", a.getCreatedAt());
                        return mm;
                    }).toList();
            m.put("adjustments", adjsMapped);
        } catch (Exception e) {
            // Log but continue processing
            log.debug("Failed to load adjustments for order {}: {}", o.getId(), e.getMessage());
        }
    }

    private void sortRowsByDateDesc(java.util.List<java.util.Map<String, Object>> rows) {
        // sort by date desc
        rows.sort((a, b) -> {
            var da = (java.time.OffsetDateTime) a.get(KEY_DATA_VENDA);
            var db = (java.time.OffsetDateTime) b.get(KEY_DATA_VENDA);
            return db.compareTo(da);
        });
    }

    private ResponseEntity<java.util.Map<String, Object>> buildPaginatedResponse(
            java.util.List<java.util.Map<String, Object>> rows, int page, int size) {
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
    }

    private ResponseEntity<java.util.Map<String, Object>> handleDetailedVendasError(Exception e) {
        log.error("Failed to build detailed vendas page", e);
        try (java.io.StringWriter sw = new java.io.StringWriter();
                java.io.PrintWriter pw = new java.io.PrintWriter(sw)) {
            e.printStackTrace(pw);
            java.util.Map<String, Object> err = new java.util.LinkedHashMap<>();
            err.put(KEY_ERROR, "Failed to load vendas");
            err.put("message", e.getMessage());
            err.put("stack", sw.toString());
            return ResponseEntity.status(500).body(err);
        } catch (Exception ex) {
            log.error("Failed to render exception", ex);
            return ResponseEntity.status(500).body(java.util.Map.of(KEY_ERROR, "Failed to load vendas"));
        }
    }

    @PostMapping
    @Transactional
    public ResponseEntity<Object> create(@RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody CreateSaleRequest req) {

        ResponseEntity<Object> validationError = validateCreateSaleRequest(req);
        if (validationError != null)
            return validationError;

        String metodo = determinePaymentMethod(req.getMetodoPagamento());

        Object productResult = validateAndGetProduct(req);
        if (productResult instanceof ResponseEntity<?> errorResponse) {
            @SuppressWarnings("unchecked")
            ResponseEntity<Object> typedResponse = (ResponseEntity<Object>) errorResponse;
            return typedResponse;
        }
        Product produto = (Product) productResult;

        ResponseEntity<Object> caixaValidation = validateCaixaStatus();
        if (caixaValidation != null)
            return caixaValidation;

        updateProductStock(produto, req.getQuantidadeVendida());
        SaleOrder order = createSaleOrderWithItems(req, produto, metodo);
        processCaixaMovimentacaoForSale(req, order, metodo);
        setCustomerIfProvided(order, req.getClienteId());

        saleOrderRepository.save(order);

        return buildCreateSaleResponse(order, produto, req, metodo);
    }

    private ResponseEntity<Object> validateCreateSaleRequest(CreateSaleRequest req) {
        if (req.getProdutoId() == null || req.getQuantidadeVendida() == null || req.getPrecoTotal() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of(KEY_ERROR, "Produto, quantidade e preço total são obrigatórios"));
        }
        if (req.getQuantidadeVendida() <= 0) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Quantidade deve ser maior que zero"));
        }
        return null;
    }

    private String determinePaymentMethod(String metodoValue) {
        String requestedMethod = metodoValue == null ? DEFAULT_PAGAMENTO : metodoValue;
        return switch (requestedMethod) {
            case DEFAULT_PAGAMENTO, "cartao_credito", "cartao_debito", "pix" -> requestedMethod;
            default -> DEFAULT_PAGAMENTO;
        };
    }

    private Object validateAndGetProduct(CreateSaleRequest req) {
        Product produto = productRepository.findById(req.getProdutoId()).orElse(null);
        if (produto == null) {
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Produto não encontrado"));
        }
        if (produto.getQuantidadeEstoque() < req.getQuantidadeVendida()) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Estoque insuficiente"));
        }
        return produto;
    }

    private ResponseEntity<Object> validateCaixaStatus() {
        try {
            var status = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
                return ResponseEntity.status(403)
                        .body(Map.of(KEY_ERROR,
                                "Caixa fechado. Operação não é permitida quando o caixa está fechado."));
            }
        } catch (Exception e) {
            log.warn("Failed to check caixa status, continuing with sale operation: {}", e.getMessage());
        }
        return null;
    }

    private void updateProductStock(Product produto, Integer quantidadeVendida) {
        produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - quantidadeVendida);
        productRepository.save(produto);
    }

    private SaleOrder createSaleOrderWithItems(CreateSaleRequest req, Product produto, String metodo) {
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

        return order;
    }

    private void processCaixaMovimentacaoForSale(CreateSaleRequest req, SaleOrder order, String metodo) {
        try {
            var statusAtual = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (statusAtual != null && DEFAULT_PAGAMENTO.equals(metodo)) {
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
                saveCaixaMovimentacao(mv);
            }
        } catch (Exception e) {
            log.warn("Failed to process caixa movimentacao: {}", e.getMessage());
        }
    }

    private void saveCaixaMovimentacao(com.example.backendspring.caixa.CaixaMovimentacao mv) {
        try {
            caixaMovimentacaoRepository.save(mv);
        } catch (Exception e) {
            log.warn("Failed to save caixa movimentacao: {}", e.getMessage());
        }
    }

    private void setCustomerIfProvided(SaleOrder order, Long clienteId) {
        if (clienteId != null) {
            Client cliente = clientRepository.findById(clienteId).orElse(null);
            if (cliente != null) {
                order.setCliente(cliente);
            }
        }
    }

    private ResponseEntity<Object> buildCreateSaleResponse(SaleOrder order, Product produto, CreateSaleRequest req,
            String metodo) {
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("id", order.getId());
        resp.put(KEY_PRODUTO_ID, produto.getId());
        resp.put(KEY_QTD_VENDIDA, req.getQuantidadeVendida());
        resp.put(KEY_PRECO_TOTAL, req.getPrecoTotal());
        resp.put(KEY_DATA_VENDA, order.getDataVenda());
        resp.put("metodo_pagamento", metodo);
        resp.put(KEY_PRODUTO_NOME, produto.getNome());

        if (order.getCliente() != null) {
            addCustomerInfoToResponse(resp, order.getCliente());
        }

        return ResponseEntity.status(201).body(resp);
    }

    private void addCustomerInfoToResponse(java.util.Map<String, Object> resp, Client cliente) {
        resp.put("cliente_id", cliente.getId());
        resp.put("cliente_nome", cliente.getNome());
        resp.put("cliente_email", cliente.getEmail());
        resp.put("cliente_telefone", cliente.getTelefone());
    }

    private Long getSaleItemId(com.example.backendspring.sale.SaleAdjustment adjustment) {
        return adjustment.getSaleItem() != null ? adjustment.getSaleItem().getId() : null;
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
