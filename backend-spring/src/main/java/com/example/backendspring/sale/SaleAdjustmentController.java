package com.example.backendspring.sale;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * Controller para devoluções / trocas (ajustes) de vendas.
 * Frontend envia POST /api/sales/{saleId}/adjustments com payload contendo
 * { type: 'return'|'exchange', saleItemId, quantity, replacementProductId?,
 * priceDifference?, paymentMethod?, notes?, payments? }
 */
@RestController
@RequestMapping("/api/sales")
@RequiredArgsConstructor
public class SaleAdjustmentController {

    private static final Logger log = LoggerFactory.getLogger(SaleAdjustmentController.class);

    private final SaleOrderRepository saleOrderRepository;
    private final SaleItemRepository saleItemRepository;
    private final SaleAdjustmentRepository saleAdjustmentRepository;
    private final com.example.backendspring.product.ProductRepository productRepository;
    private final com.example.backendspring.caixa.CaixaMovimentacaoRepository caixaMovimentacaoRepository;
    private final com.example.backendspring.caixa.CaixaStatusRepository caixaStatusRepository;

    @PostMapping("/{saleId}/adjustments")
    @Transactional
    public ResponseEntity<?> createAdjustment(@PathVariable Long saleId, @RequestBody AdjustmentRequest req) {
        try {
            if (req.getType() == null)
                return badRequest("Campo 'type' obrigatório");
            String type = req.getType().toLowerCase(Locale.ROOT).trim();
            if (!type.equals("return") && !type.equals("exchange"))
                return badRequest("type inválido: " + req.getType());
            if (req.getSaleItemId() == null)
                return badRequest("saleItemId obrigatório");
            if (req.getQuantity() == null || req.getQuantity() <= 0)
                return badRequest("quantity deve ser > 0");

            var saleOpt = saleOrderRepository.findById(saleId);
            if (saleOpt.isEmpty())
                return notFound("Venda não encontrada");
            var sale = saleOpt.get();

            var itemOpt = saleItemRepository.findById(req.getSaleItemId());
            if (itemOpt.isEmpty() || !Objects.equals(itemOpt.get().getVenda().getId(), sale.getId()))
                return badRequest("Item não pertence à venda");
            var saleItem = itemOpt.get();

            // Calcular já devolvido para limitar devolução/exchange
            int alreadyReturned = computeAlreadyReturnedQty(saleItem.getId());
            int originalQty = saleItem.getQuantidade() == null ? 0 : saleItem.getQuantidade();
            int availableToReturn = Math.max(0, originalQty - alreadyReturned);
            if (req.getQuantity() > availableToReturn) {
                return badRequest("Quantidade solicitada maior que restante disponível para devolver (restante: "
                        + availableToReturn + ")");
            }

            // Restaurar estoque no caso de devolução (return)
            if (type.equals("return")) {
                try {
                    var prod = saleItem.getProduto();
                    if (prod != null) {
                        prod.setQuantidadeEstoque(prod.getQuantidadeEstoque() + req.getQuantity());
                        productRepository.save(prod);
                    }
                } catch (Exception e) {
                    log.warn("FAILED_STOCK_RESTORE", e);
                }
            }

            // Futuro: lógica de troca (exchange) com replacementProductId & priceDifference
            if (type.equals("exchange")) {
                // Placeholder simples: também repõe estoque do item original
                try {
                    var prod = saleItem.getProduto();
                    if (prod != null) {
                        prod.setQuantidadeEstoque(prod.getQuantidadeEstoque() + req.getQuantity());
                        productRepository.save(prod);
                    }
                } catch (Exception e) {
                    log.warn("FAILED_STOCK_RESTORE_EXCHANGE", e);
                }
            }

            var adj = new SaleAdjustment();
            adj.setSaleOrder(sale);
            adj.setSaleItem(saleItem);
            adj.setType(type);
            adj.setQuantity(req.getQuantity());
            adj.setReplacementProductId(req.getReplacementProductId());
            adj.setPriceDifference(req.getPriceDifference());
            adj.setPaymentMethod(req.getPaymentMethod());
            adj.setNotes(truncate(req.getNotes(), 500));
            // Operator username se disponível
            String opUser = null;
            if (sale.getOperador() != null)
                opUser = sale.getOperador().getUsername();
            adj.setOperatorUsername(opUser);
            adj.setCreatedAt(OffsetDateTime.now());
            // Opcional: armazenar JSON com pagamentos encaminhados
            if (req.getPayments() != null && !req.getPayments().isEmpty()) {
                adj.setDetailJson(safePaymentsJson(req.getPayments()));
            }
            saleAdjustmentRepository.save(adj);

            Double refundAmount = null;
            try {
                if (type.equals("return")) {
                    double unit = saleItem.getPrecoUnitario() == null ? 0.0 : saleItem.getPrecoUnitario();
                    refundAmount = unit * req.getQuantity();
                    if (refundAmount > 0.0001) {
                        var mov = new com.example.backendspring.caixa.CaixaMovimentacao();
                        try {
                            caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc().ifPresent(mov::setCaixaStatus);
                        } catch (Exception ignored) {
                        }
                        mov.setTipo("retirada");
                        mov.setValor(refundAmount);
                        mov.setDescricao("Devolução venda #" + sale.getId() + " item #" + saleItem.getId());
                        mov.setMotivo("devolucao");
                        try {
                            mov.setOperador(sale.getOperador());
                        } catch (Exception ignored) {
                        }
                        mov.setDataMovimento(OffsetDateTime.now());
                        mov.setCriadoEm(OffsetDateTime.now());
                        caixaMovimentacaoRepository.save(mov);
                    }
                } else if (type.equals("exchange")) {
                    double priceDiff = req.getPriceDifference() != null ? req.getPriceDifference() : 0.0;
                    if (Math.abs(priceDiff) > 0.0001) {
                        var mov = new com.example.backendspring.caixa.CaixaMovimentacao();
                        try {
                            caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc().ifPresent(mov::setCaixaStatus);
                        } catch (Exception ignored) {
                        }
                        boolean refund = priceDiff < 0;
                        mov.setTipo(refund ? "retirada" : "entrada");
                        mov.setValor(Math.abs(priceDiff));
                        mov.setDescricao("Troca venda #" + sale.getId() + " item #" + saleItem.getId());
                        mov.setMotivo("troca");
                        try {
                            mov.setOperador(sale.getOperador());
                        } catch (Exception ignored) {
                        }
                        mov.setDataMovimento(OffsetDateTime.now());
                        mov.setCriadoEm(OffsetDateTime.now());
                        caixaMovimentacaoRepository.save(mov);
                        if (refund)
                            refundAmount = Math.abs(priceDiff);
                    }
                }
            } catch (Exception e) {
                log.warn("FAILED_CREATE_CAIXA_MOV_REFUND_OR_EXCHANGE saleId={} adjId={}", sale.getId(), adj.getId(), e);
            }

            // Recalcular adjustedTotal líquido (total original - somas retornos)
            double netTotal = computeNetTotalAfterReturns(sale);
            sale.setAdjustedTotal(netTotal);

            // Se todos itens retornados -> status DEVOLVIDA
            if (allItemsFullyReturned(sale)) {
                sale.setStatus("DEVOLVIDA");
            }
            saleOrderRepository.save(sale);

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", true);
            body.put("adjustment_id", adj.getId());
            body.put("sale_id", sale.getId());
            body.put("type", type);
            body.put("quantity", adj.getQuantity());
            body.put("net_total", netTotal);
            var netQty = computeNetQuantity(sale);
            body.put("net_quantidade_vendida", netQty);
            body.put("status", sale.getStatus());
            body.put("returned_resumo", buildReturnedResumo(sale));
            if (refundAmount != null)
                body.put("refund_amount", refundAmount);
            return ResponseEntity.ok(body);
        } catch (Exception e) {
            log.error("FAILED_CREATE_ADJUSTMENT saleId={}", saleId, e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Falha ao processar ajuste"));
        }
    }

    private String buildReturnedResumo(SaleOrder sale) {
        try {
            Map<Long, Integer> map = new HashMap<>();
            var adjs = saleAdjustmentRepository.findBySaleOrderId(sale.getId());
            for (var a : adjs) {
                if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                    map.merge(a.getSaleItem().getId(), a.getQuantity() == null ? 0 : a.getQuantity(), Integer::sum);
                }
            }
            if (map.isEmpty())
                return null;
            List<String> parts = new ArrayList<>();
            for (var it : sale.getItens()) {
                int ret = map.getOrDefault(it.getId(), 0);
                if (ret > 0)
                    parts.add(ret + "x "
                            + (it.getProduto() != null ? it.getProduto().getNome() : ("Item " + it.getId())));
            }
            return String.join(", ", parts);
        } catch (Exception ignored) {
            return null;
        }
    }

    private int computeNetQuantity(SaleOrder sale) {
        Map<Long, Integer> ret = aggregateReturns(sale.getId());
        int net = 0;
        if (sale.getItens() != null) {
            for (var it : sale.getItens()) {
                int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
                int r = ret.getOrDefault(it.getId(), 0);
                net += Math.max(0, orig - r);
            }
        }
        return net;
    }

    private double computeNetTotalAfterReturns(SaleOrder sale) {
        Map<Long, Integer> ret = aggregateReturns(sale.getId());
        double net = 0.0;
        if (sale.getItens() != null) {
            for (var it : sale.getItens()) {
                int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
                int r = ret.getOrDefault(it.getId(), 0);
                int eff = Math.max(0, orig - r);
                double unit = it.getPrecoUnitario() == null ? 0.0 : it.getPrecoUnitario();
                net += unit * eff;
            }
        }
        return net;
    }

    private boolean allItemsFullyReturned(SaleOrder sale) {
        Map<Long, Integer> ret = aggregateReturns(sale.getId());
        if (sale.getItens() == null || sale.getItens().isEmpty())
            return false;
        for (var it : sale.getItens()) {
            int orig = it.getQuantidade() == null ? 0 : it.getQuantidade();
            int r = ret.getOrDefault(it.getId(), 0);
            if (r < orig)
                return false;
        }
        return true;
    }

    private Map<Long, Integer> aggregateReturns(Long saleId) {
        Map<Long, Integer> ret = new HashMap<>();
        try {
            var adjs = saleAdjustmentRepository.findBySaleOrderId(saleId);
            for (var a : adjs) {
                if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                    ret.merge(a.getSaleItem().getId(), a.getQuantity() == null ? 0 : a.getQuantity(), Integer::sum);
                }
            }
        } catch (Exception ignored) {
        }
        return ret;
    }

    private int computeAlreadyReturnedQty(Long saleItemId) {
        int sum = 0;
        try {
            // Buscar todos ajustes da ordem via item -> order id; fallback: filtrar em
            // memória
            var adjs = saleAdjustmentRepository.findAll();
            for (var a : adjs) {
                if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null
                        && Objects.equals(a.getSaleItem().getId(), saleItemId)) {
                    sum += (a.getQuantity() == null ? 0 : a.getQuantity());
                }
            }
        } catch (Exception ignored) {
        }
        return sum;
    }

    private ResponseEntity<Map<String, Object>> badRequest(String msg) {
        return ResponseEntity.badRequest().body(Map.of("error", msg));
    }

    private ResponseEntity<Map<String, Object>> notFound(String msg) {
        return ResponseEntity.status(404).body(Map.of("error", msg));
    }

    private String truncate(String v, int max) {
        if (v == null)
            return null;
        return v.length() <= max ? v : v.substring(0, max);
    }

    private String safePaymentsJson(List<PaymentEntry> payments) {
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("[");
            for (int i = 0; i < payments.size(); i++) {
                var p = payments.get(i);
                if (i > 0)
                    sb.append(',');
                sb.append('{')
                        .append("\"metodo\":\"").append(escape(p.getMetodo())).append("\",")
                        .append("\"valor\":").append(p.getValor() == null ? 0 : p.getValor())
                        .append('}');
            }
            sb.append(']');
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private String escape(String s) {
        if (s == null)
            return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    @Data
    public static class AdjustmentRequest {
        private String type; // return | exchange
        private Long saleItemId;
        private Integer quantity;
        private Long replacementProductId;
        private Double priceDifference;
        private String paymentMethod;
        private String notes;
        private List<PaymentEntry> payments; // opcional
        private String correlationId; // ignorado por enquanto
    }

    @Data
    public static class PaymentEntry {
        private String metodo;
        private Double valor;
    }
}
