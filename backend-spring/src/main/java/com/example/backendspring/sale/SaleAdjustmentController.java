package com.example.backendspring.sale;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;
import java.util.Map;

@RestController
@RequestMapping("/api/sales")
@RequiredArgsConstructor
public class SaleAdjustmentController {

    private final SaleOrderRepository saleOrderRepository;
    private final SaleItemRepository saleItemRepository;
    private final SaleAdjustmentRepository saleAdjustmentRepository;
    private final com.example.backendspring.product.ProductRepository productRepository;
    private final com.example.backendspring.caixa.CaixaMovimentacaoRepository caixaMovimentacaoRepository;
    private final com.example.backendspring.caixa.CaixaStatusRepository caixaStatusRepository;
    private final com.example.backendspring.user.UserRepository userRepository;
    private static final Logger log = LoggerFactory.getLogger(SaleAdjustmentController.class);

    @PostMapping("/{id}/adjustments")
    @Transactional
    public ResponseEntity<Object> createAdjustment(@PathVariable Long id, @RequestBody AdjustmentRequest req) {
        var venda = saleOrderRepository.findById(id).orElse(null);
        if (venda == null)
            return ResponseEntity.status(404).body(Map.of("error", "Venda não encontrada"));

        var item = saleItemRepository.findById(req.getSaleItemId()).orElse(null);
        if (item == null)
            return ResponseEntity.status(404).body(Map.of("error", "Item da venda não encontrado"));

        // basic validations
        if (req.getQuantity() == null || req.getQuantity() <= 0)
            return ResponseEntity.badRequest().body(Map.of("error", "Quantidade inválida"));

        // determine operator (username) and operador User
        String operatorUsername = null;
        com.example.backendspring.user.User operadorUser = null;
        try {
            var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if (auth != null) {
                operatorUsername = auth.getName();
                try {
                    operadorUser = userRepository.findByUsername(operatorUsername).orElse(null);
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }

        // perform business logic depending on type
        String type = (req.getType() == null) ? "return" : req.getType();
        int qty = req.getQuantity();

        if (type.equalsIgnoreCase("return")) {
            // validate quantity
            if (qty > item.getQuantidade())
                return ResponseEntity.badRequest().body(Map.of("error", "Quantidade a devolver maior que a vendida"));

            // adjust stock
            var produto = item.getProduto();
            produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() + qty);
            productRepository.save(produto);

            // adjust sale item quantity / remove if zero
            int newQty = item.getQuantidade() - qty;
            if (newQty <= 0) {
                // remove item
                venda.getItens().removeIf(it -> it.getId().equals(item.getId()));
                saleItemRepository.delete(item);
            } else {
                item.setQuantidade(newQty);
                item.setPrecoTotal(item.getPrecoUnitario() * newQty);
                saleItemRepository.save(item);
            }

            // recompute sale totals
            double newSubtotal = venda.getItens().stream().mapToDouble(it -> it.getPrecoTotal()).sum();
            venda.setSubtotal(newSubtotal);
            venda.setTotalFinal(newSubtotal - (venda.getDesconto() == null ? 0.0 : venda.getDesconto())
                    + (venda.getAcrescimo() == null ? 0.0 : venda.getAcrescimo()));

            // register refund payment (negative value) and caixa movimentacao (retirada)
            double refundAmount = item.getPrecoUnitario() * qty;
            SalePayment refundPayment = SalePayment.builder()
                    .venda(venda)
                    .metodo(req.getPaymentMethod() == null ? "dinheiro" : req.getPaymentMethod())
                    .valor(-Math.abs(refundAmount))
                    .troco(null)
                    .build();
            // link caixa status if available
            try {
                var csOpt = caixaStatusRepository.findTopByOrderByIdDesc();
                if (csOpt.isPresent())
                    refundPayment.setCaixaStatus(csOpt.get());
            } catch (Exception ignored) {
            }
            venda.getPagamentos().add(refundPayment);

            // create caixa movimentacao
            com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                    .builder()
                    .tipo("retirada")
                    .valor(refundAmount)
                    .descricao("Reembolso venda " + venda.getId() + " item " + item.getId())
                    .dataMovimento(OffsetDateTime.now())
                    .criadoEm(OffsetDateTime.now())
                    .operador(operadorUser)
                    .build();
            caixaMovimentacaoRepository.save(mv);

            // persist sale order
            saleOrderRepository.save(venda);

            // create adjustment record
            SaleAdjustment adj = SaleAdjustment.builder()
                    .saleOrder(venda)
                    .saleItem(item)
                    .type("return")
                    .quantity(qty)
                    .replacementProductId(null)
                    .priceDifference(-refundAmount)
                    .paymentMethod(req.getPaymentMethod())
                    .notes(req.getNotes())
                    .operatorUsername(operatorUsername)
                    .createdAt(OffsetDateTime.now())
                    .build();
            saleAdjustmentRepository.save(adj);

            log.info("Return processed: saleId={} itemId={} qty={} refund={}", venda.getId(), item.getId(), qty,
                    refundAmount);
            return ResponseEntity.status(201).body(Map.of("message", "Return processed", "adjustmentId", adj.getId()));

        } else if (type.equalsIgnoreCase("exchange")) {
            // exchange flow: replacementProductId required
            if (req.getReplacementProductId() == null)
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "replacementProductId é obrigatório para troca"));
            var replacement = productRepository.findById(req.getReplacementProductId()).orElse(null);
            if (replacement == null)
                return ResponseEntity.status(404).body(Map.of("error", "Produto de troca não encontrado"));
            if (replacement.getQuantidadeEstoque() < qty)
                return ResponseEntity.badRequest().body(Map.of("error", "Estoque insuficiente para produto de troca"));

            // restore original product stock
            var original = item.getProduto();
            original.setQuantidadeEstoque(original.getQuantidadeEstoque() + qty);
            productRepository.save(original);

            // reduce replacement stock
            replacement.setQuantidadeEstoque(replacement.getQuantidadeEstoque() - qty);
            productRepository.save(replacement);

            // adjust original sale item quantity / remove if zero
            int newQty = item.getQuantidade() - qty;
            if (newQty <= 0) {
                venda.getItens().removeIf(it -> it.getId().equals(item.getId()));
                saleItemRepository.delete(item);
            } else {
                item.setQuantidade(newQty);
                item.setPrecoTotal(item.getPrecoUnitario() * newQty);
                saleItemRepository.save(item);
            }

            // create new sale item for replacement
            SaleItem newItem = SaleItem.builder()
                    .venda(venda)
                    .produto(replacement)
                    .quantidade(qty)
                    .precoUnitario(replacement.getPrecoVenda())
                    .precoTotal(replacement.getPrecoVenda() * qty)
                    .build();
            venda.getItens().add(newItem);

            // compute price difference
            double priceDiffPerUnit = replacement.getPrecoVenda() - item.getPrecoUnitario();
            double totalPriceDiff = priceDiffPerUnit * qty;

            // if positive -> customer pays extra (entrada); if negative -> refund
            // (retirada)
            if (Math.abs(totalPriceDiff) > 0.001) {
                if (totalPriceDiff > 0) {
                    // customer must pay extra
                    SalePayment extra = SalePayment.builder()
                            .venda(venda)
                            .metodo(req.getPaymentMethod() == null ? "dinheiro" : req.getPaymentMethod())
                            .valor(totalPriceDiff)
                            .troco(null)
                            .build();
                    try {
                        var csOpt = caixaStatusRepository.findTopByOrderByIdDesc();
                        if (csOpt.isPresent())
                            extra.setCaixaStatus(csOpt.get());
                    } catch (Exception ignored) {
                    }
                    venda.getPagamentos().add(extra);

                    com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                            .builder()
                            .tipo("entrada")
                            .valor(totalPriceDiff)
                            .descricao("Pagamento adicional por troca venda " + venda.getId())
                            .dataMovimento(OffsetDateTime.now())
                            .criadoEm(OffsetDateTime.now())
                            .operador(operadorUser)
                            .build();
                    caixaMovimentacaoRepository.save(mv);
                } else {
                    // refund difference to customer
                    double refund = Math.abs(totalPriceDiff);
                    SalePayment refundPayment = SalePayment.builder()
                            .venda(venda)
                            .metodo(req.getPaymentMethod() == null ? "dinheiro" : req.getPaymentMethod())
                            .valor(-refund)
                            .troco(null)
                            .build();
                    try {
                        var csOpt = caixaStatusRepository.findTopByOrderByIdDesc();
                        if (csOpt.isPresent())
                            refundPayment.setCaixaStatus(csOpt.get());
                    } catch (Exception ignored) {
                    }
                    venda.getPagamentos().add(refundPayment);

                    com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                            .builder()
                            .tipo("retirada")
                            .valor(refund)
                            .descricao("Reembolso por troca venda " + venda.getId())
                            .dataMovimento(OffsetDateTime.now())
                            .criadoEm(OffsetDateTime.now())
                            .operador(operadorUser)
                            .build();
                    caixaMovimentacaoRepository.save(mv);
                }
            }

            // recompute totals
            double newSubtotal = venda.getItens().stream().mapToDouble(it -> it.getPrecoTotal()).sum();
            venda.setSubtotal(newSubtotal);
            venda.setTotalFinal(newSubtotal - (venda.getDesconto() == null ? 0.0 : venda.getDesconto())
                    + (venda.getAcrescimo() == null ? 0.0 : venda.getAcrescimo()));

            saleOrderRepository.save(venda);

            // create adjustment record
            SaleAdjustment adj = SaleAdjustment.builder()
                    .saleOrder(venda)
                    .saleItem(item)
                    .type("exchange")
                    .quantity(qty)
                    .replacementProductId(replacement.getId())
                    .priceDifference(totalPriceDiff)
                    .paymentMethod(req.getPaymentMethod())
                    .notes(req.getNotes())
                    .operatorUsername(operatorUsername)
                    .createdAt(OffsetDateTime.now())
                    .build();
            saleAdjustmentRepository.save(adj);

            log.info("Exchange processed: saleId={} itemId={} qty={} replacementId={} diff={}", venda.getId(),
                    item.getId(), qty, replacement.getId(), totalPriceDiff);
            return ResponseEntity.status(201)
                    .body(Map.of("message", "Exchange processed", "adjustmentId", adj.getId()));
        }

        return ResponseEntity.badRequest().body(Map.of("error", "Tipo inválido"));
    }

    @GetMapping("/search")
    @Transactional(readOnly = true)
    public ResponseEntity<Object> searchSales(
            @RequestParam(value = "page", required = false, defaultValue = "0") int page,
            @RequestParam(value = "size", required = false, defaultValue = "5") int size,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "operator", required = false) String operator) {
        List<SaleOrder> all = saleOrderRepository.findAllOrderByData();

        LocalDate inicio = null;
        LocalDate fim = null;
        try {
            if (from != null && !from.isBlank())
                inicio = LocalDate.parse(from);
            if (to != null && !to.isBlank())
                fim = LocalDate.parse(to);
        } catch (Exception ignored) {
        }

        final LocalDate fInicio = inicio;
        final LocalDate fFim = fim;
        final String ql = (q == null) ? null : q.trim().toLowerCase();
        final String operatorLower = (operator == null || operator.isBlank()) ? null : operator.trim().toLowerCase();

        List<java.util.Map<String, Object>> filtered = all.stream().filter(so -> {
            try {
                if (fInicio != null) {
                    if (so.getDataVenda() == null || so.getDataVenda().toLocalDate().isBefore(fInicio))
                        return false;
                }
                if (fFim != null) {
                    if (so.getDataVenda() == null || so.getDataVenda().toLocalDate().isAfter(fFim))
                        return false;
                }
                if (ql != null && !ql.isEmpty()) {
                    if (String.valueOf(so.getId()).contains(ql))
                        return true;
                    if (so.getCustomerName() != null && so.getCustomerName().toLowerCase().contains(ql))
                        return true;
                    boolean matchItem = so.getItens().stream()
                            .anyMatch(it -> it.getProduto() != null && it.getProduto().getNome() != null
                                    && it.getProduto().getNome().toLowerCase().contains(ql));
                    if (matchItem)
                        return true;
                    return false;
                }
                // filter by operator if requested
                if (operatorLower != null && operatorLower.length() > 0) {
                    var op = so.getOperador();
                    String uname = op != null ? op.getUsername() : null;
                    if (uname == null || !uname.toLowerCase().contains(operatorLower))
                        return false;
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }).map(so -> {
            java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id", so.getId());
            m.put("data_venda", so.getDataVenda());
            m.put("subtotal", so.getSubtotal());
            m.put("total_final", so.getTotalFinal());
            m.put("customer_name", so.getCustomerName());
            m.put("operator", so.getOperador() != null ? so.getOperador().getUsername() : null);
            m.put("itens_count", so.getItens() == null ? 0 : so.getItens().size());
            m.put("preview",
                    so.getItens() == null || so.getItens().isEmpty() ? java.util.List.of()
                            : so.getItens().stream().limit(3).map(it -> it.getProduto().getNome())
                                    .collect(Collectors.toList()));
            return m;
        }).collect(Collectors.toList());

        int total = filtered.size();
        int fromIndex = Math.max(0, Math.min(total, page * size));
        int toIndex = Math.max(0, Math.min(total, fromIndex + size));
        List<java.util.Map<String, Object>> pageItems = filtered.subList(fromIndex, toIndex);

        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("page", page);
        resp.put("size", size);
        resp.put("total_elements", total);
        resp.put("total_pages", (int) Math.ceil((double) total / (double) size));
        resp.put("items", pageItems);
        return ResponseEntity.ok(resp);
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
    }
}
