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
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    private String objectToJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return null;
        }
    }

    @PostMapping("/{id}/adjustments")
    @Transactional
    public ResponseEntity<Object> createAdjustment(@PathVariable Long id, @RequestBody AdjustmentRequest req) {
        String corr = (req.getCorrelationId() == null || req.getCorrelationId().isBlank())
                ? ("auto-" + System.currentTimeMillis())
                : req.getCorrelationId();
        log.info(
                "[ADJ] START corr={} saleId={} payloadType={} saleItemId={} qty={} replacementProductId={} paymentsCount={}",
                corr, id, req.getType(), req.getSaleItemId(), req.getQuantity(), req.getReplacementProductId(),
                (req.getPayments() == null ? 0 : req.getPayments().size()));
        // lock sale order to avoid concurrent adjustments
        var venda = saleOrderRepository.findByIdForUpdate(id).orElse(null);
        if (venda == null)
            return ResponseEntity.status(404).body(Map.of("error", "Venda não encontrada"));

        // Não permitir ajustes quando não houver sessão de caixa aberta
        com.example.backendspring.caixa.CaixaStatus currentOpen = null;
        try {
            var caixaAtivaOpt = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc();
            if (caixaAtivaOpt == null || caixaAtivaOpt.isEmpty()) {
                return ResponseEntity.status(403).body(Map.of("error", "Caixa fechado. Ajustes não são permitidos."));
            }
            currentOpen = caixaAtivaOpt.orElse(null);
        } catch (Exception ignored) {
            // se a checagem falhar por algum motivo, tratar como caixa fechado por
            // segurança
            return ResponseEntity.status(403).body(Map.of("error", "Caixa fechado. Ajustes não são permitidos."));
        }

        var item = saleItemRepository.findById(req.getSaleItemId()).orElse(null);
        // fallback: if client sent produto_id instead of sale_item id, try to find the
        // sale item in the order
        if (item == null) {
            try {
                var possibleId = req.getSaleItemId();
                if (possibleId != null && venda.getItens() != null) {
                    var found = venda.getItens().stream()
                            .filter(it -> it.getProduto() != null
                                    && (it.getProduto().getId() != null && it.getProduto().getId().equals(possibleId)))
                            .findFirst();
                    if (found.isPresent()) {
                        item = found.get();
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (item == null) {
            log.warn("[ADJ] ITEM_NOT_FOUND corr={} saleId={} requestedItem={} type={}", corr, id, req.getSaleItemId(),
                    req.getType());
            return ResponseEntity.status(404).body(Map.of("error", "Item da venda não encontrado"));
        }
        // garante que o item pertence mesmo a esta venda (segurança extra)
        if (item.getVenda() == null || !item.getVenda().getId().equals(venda.getId())) {
            log.warn("[ADJ] ITEM_MISMATCH corr={} saleId={} itemId={} actualSaleId={} type={}", corr, id, item.getId(),
                    (item.getVenda() == null ? null : item.getVenda().getId()), req.getType());
            return ResponseEntity.status(400).body(Map.of("error", "Item não pertence à venda especificada"));
        }

        // keep a final reference for use inside lambdas
        var targetItem = item;

        // basic validations
        if (req.getQuantity() == null || req.getQuantity() <= 0) {
            log.warn("[ADJ] INVALID_QTY corr={} saleId={} itemId={} qty={} type={}", corr, id, item.getId(),
                    req.getQuantity(), req.getType());
            return ResponseEntity.badRequest().body(Map.of("error", "Quantidade inválida"));
        }
        // valida método de pagamento (quando informado)
        if (req.getPaymentMethod() != null) {
            var metodo = req.getPaymentMethod();
            if (!List.of("dinheiro", "cartao_credito", "cartao_debito", "pix", "cartao", "outro").contains(metodo)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Método de pagamento inválido"));
            }
        }

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

        String type = (req.getType() == null) ? "return" : req.getType();
        int qty = req.getQuantity();

        if (type.equalsIgnoreCase("return")) {
            // validate quantity solicitada <= original
            if (qty > targetItem.getQuantidade()) {
                log.warn("[ADJ] RETURN_QTY_EXCEEDS corr={} saleId={} itemId={} requested={} available={} type=return",
                        corr, id, targetItem.getId(), qty, targetItem.getQuantidade());
                return ResponseEntity.badRequest().body(Map.of("error", "Quantidade a devolver maior que a vendida"));
            }
            // Estoque volta
            try {
                var produto = targetItem.getProduto();
                produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() + qty);
                productRepository.save(produto);
            } catch (Exception e) {
                log.warn("[ADJ] RETURN_STOCK_FAIL corr={} saleId={} itemId={} msg={}", corr, id, targetItem.getId(),
                        e.getMessage());
            }

            double refundAmount = targetItem.getPrecoUnitario() * qty;
            // Sempre criar movimentação de caixa (retirada) em dinheiro – devolução é
            // sempre dinheiro
            java.util.List<Long> cashMovIds = new java.util.ArrayList<>();
            try {
                if (currentOpen != null) {
                    com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                            .builder()
                            .tipo("retirada")
                            .valor(refundAmount)
                            .descricao("Reembolso venda " + venda.getId() + " item " + targetItem.getId())
                            .dataMovimento(OffsetDateTime.now())
                            .criadoEm(OffsetDateTime.now())
                            .operador(operadorUser)
                            .caixaStatus(currentOpen)
                            .build();
                    caixaMovimentacaoRepository.save(mv);
                    cashMovIds.add(mv.getId());
                    log.info("[ADJ] RETURN_CASH_MOV corr={} saleId={} itemId={} valor={} movId={} operador={}", corr,
                            id, targetItem.getId(), refundAmount, mv.getId(), operatorUsername);
                }
            } catch (Exception e) {
                log.error("[ADJ] RETURN_CASH_MOV_FAIL corr={} saleId={} itemId={}", corr, id, targetItem.getId(), e);
            }

            // Criar registro de ajuste (não remove item nem altera quantidade)
            SaleAdjustment savedAdj;
            try {
                java.util.Map<String, Object> detail = new java.util.LinkedHashMap<>();
                detail.put("correlation_id", corr);
                detail.put("sale_item_id", targetItem.getId());
                detail.put("produto_id", targetItem.getProduto() != null ? targetItem.getProduto().getId() : null);
                detail.put("returned_quantity", qty);
                detail.put("refund_amount", refundAmount);
                detail.put("cash_movements_ids", cashMovIds);
                String jsonDetail = objectToJson(detail);
                savedAdj = SaleAdjustment.builder()
                        .saleOrder(venda)
                        .saleItem(targetItem)
                        .type("return")
                        .quantity(qty)
                        .replacementProductId(null)
                        .priceDifference(-refundAmount)
                        .paymentMethod("dinheiro")
                        .notes(req.getNotes())
                        .operatorUsername(operatorUsername)
                        .createdAt(OffsetDateTime.now())
                        .detailJson(jsonDetail)
                        .build();
                saleAdjustmentRepository.save(savedAdj);
            } catch (Exception ex) {
                savedAdj = SaleAdjustment.builder()
                        .saleOrder(venda)
                        .saleItem(targetItem)
                        .type("return")
                        .quantity(qty)
                        .replacementProductId(null)
                        .priceDifference(-refundAmount)
                        .paymentMethod("dinheiro")
                        .notes(req.getNotes())
                        .operatorUsername(operatorUsername)
                        .createdAt(OffsetDateTime.now())
                        .build();
                saleAdjustmentRepository.save(savedAdj);
            }

            // Recalcular adjustedTotal = total_final + soma(priceDifference) de todos
            // ajustes
            try {
                var adjsAll = saleAdjustmentRepository.findBySaleOrderId(venda.getId());
                double sumDiff = adjsAll.stream()
                        .mapToDouble(a -> a.getPriceDifference() == null ? 0.0 : a.getPriceDifference()).sum();
                venda.setAdjustedTotal(venda.getTotalFinal() + sumDiff);
            } catch (Exception e) {
                log.warn("[ADJ] RECALC_ADJUSTED_FAIL corr={} saleId={} msg={}", corr, id, e.getMessage());
            }

            // Determinar se totalmente devolvida: para cada item, soma qty returns >=
            // quantidade original
            try {
                var adjsAll = saleAdjustmentRepository.findBySaleOrderId(venda.getId());
                java.util.Map<Long, Integer> returnedByItem = new java.util.HashMap<>();
                for (var a : adjsAll) {
                    if ("return".equalsIgnoreCase(a.getType()) && a.getSaleItem() != null) {
                        returnedByItem.merge(a.getSaleItem().getId(), a.getQuantity() == null ? 0 : a.getQuantity(),
                                Integer::sum);
                    }
                }
                boolean full = true;
                for (var it : venda.getItens()) {
                    int ret = returnedByItem.getOrDefault(it.getId(), 0);
                    if (ret < (it.getQuantidade() == null ? 0 : it.getQuantidade())) {
                        full = false;
                        break;
                    }
                }
                if (full)
                    venda.setStatus("DEVOLVIDA");
                else
                    venda.setStatus("AJUSTADA");
            } catch (Exception e) {
                log.warn("[ADJ] STATUS_EVAL_FAIL corr={} saleId={} msg={}", corr, id, e.getMessage());
            }

            saleOrderRepository.save(venda);

            log.info(
                    "[ADJ] RETURN_DONE corr={} saleId={} itemId={} qty={} refund={} adjustedTotal={} status={} adjustmentId={}",
                    corr, venda.getId(), targetItem.getId(), qty, refundAmount, venda.getAdjustedTotal(),
                    venda.getStatus(), savedAdj.getId());
            return ResponseEntity.status(201)
                    .body(Map.of("message", "Return processed", "adjustmentId", savedAdj.getId()));

        } else if (type.equalsIgnoreCase("exchange")) {
            // (exchange branch original permanece abaixo)
        } else {
            return ResponseEntity.badRequest().body(Map.of("error", "Tipo inválido"));
        }
        // Exchange branch (mantemos código existente a partir daqui)
        if (type.equalsIgnoreCase("exchange")) {
            // exchange flow: replacementProductId required
            if (req.getReplacementProductId() == null)
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "replacementProductId é obrigatório para troca"));
            var replacement = productRepository.findById(req.getReplacementProductId()).orElse(null);
            if (replacement == null)
                return ResponseEntity.status(404).body(Map.of("error", "Produto de troca não encontrado"));
            if (replacement.getQuantidadeEstoque() < qty) {
                log.warn(
                        "[ADJ] EXCHANGE_NO_STOCK corr={} saleId={} originalItemId={} replacementProductId={} requestedQty={} stockReplacement={} type=exchange",
                        corr, id, targetItem.getId(), replacement.getId(), qty, replacement.getQuantidadeEstoque());
                return ResponseEntity.badRequest().body(Map.of("error", "Estoque insuficiente para produto de troca"));
            }
            log.info(
                    "[ADJ] EXCHANGE_PREP corr={} saleId={} itemId={} replacementProductId={} qty={} origUnit={} replUnit={} subtotalBefore={} totalBefore={}",
                    corr, id, targetItem.getId(), replacement.getId(), qty, targetItem.getPrecoUnitario(),
                    replacement.getPrecoVenda(), venda.getSubtotal(), venda.getTotalFinal());

            // restore original product stock
            var original = targetItem.getProduto();
            original.setQuantidadeEstoque(original.getQuantidadeEstoque() + qty);
            productRepository.save(original);

            // reduce replacement stock
            replacement.setQuantidadeEstoque(replacement.getQuantidadeEstoque() - qty);
            productRepository.save(replacement);

            // adjust original sale item quantity / remove if zero
            int newQty = targetItem.getQuantidade() - qty;
            boolean itemRemovedExchange = false;
            if (newQty <= 0) {
                venda.getItens().removeIf(it -> it.getId().equals(targetItem.getId()));
                saleItemRepository.delete(targetItem);
                itemRemovedExchange = true;
            } else {
                targetItem.setQuantidade(newQty);
                targetItem.setPrecoTotal(targetItem.getPrecoUnitario() * newQty);
                saleItemRepository.save(targetItem);
            }

            // create new sale item for replacement and persist it before attaching to the
            // order
            SaleItem newItem = SaleItem.builder()
                    .venda(venda)
                    .produto(replacement)
                    .quantidade(qty)
                    .precoUnitario(replacement.getPrecoVenda())
                    .precoTotal(replacement.getPrecoVenda() * qty)
                    .build();
            // persist the new sale item to avoid transient-instance issues when persisting
            // related entities
            saleItemRepository.save(newItem);
            venda.getItens().add(newItem);

            // compute price difference
            double priceDiffPerUnit = replacement.getPrecoVenda() - targetItem.getPrecoUnitario();
            double totalPriceDiff = priceDiffPerUnit * qty;

            // if positive -> customer pays extra (entrada); if negative -> refund
            // (retirada)
            java.util.List<Long> cashMovIds = new java.util.ArrayList<>();
            if (Math.abs(totalPriceDiff) > 0.001) {
                if (totalPriceDiff > 0) {
                    // customer must pay extra: support multiple payments (payments list) or
                    // fallback
                    double eps = 0.01;
                    java.util.List<PaymentDto> pays = req.getPayments();
                    if (pays == null || pays.isEmpty()) {
                        // fallback to single payment using paymentMethod
                        SalePayment extra = SalePayment.builder()
                                .venda(venda)
                                .metodo(req.getPaymentMethod() == null ? "dinheiro" : req.getPaymentMethod())
                                .valor(totalPriceDiff)
                                .troco(null)
                                .build();
                        if (currentOpen != null)
                            extra.setCaixaStatus(currentOpen);
                        venda.getPagamentos().add(extra);
                        if ("dinheiro".equals(extra.getMetodo())) {
                            // create caixa movimentacao for cash portion
                            com.example.backendspring.caixa.CaixaMovimentacao mvCash = com.example.backendspring.caixa.CaixaMovimentacao
                                    .builder()
                                    .tipo("entrada")
                                    .valor(totalPriceDiff)
                                    .descricao("Pagamento adicional por troca venda " + venda.getId())
                                    .dataMovimento(OffsetDateTime.now())
                                    .criadoEm(OffsetDateTime.now())
                                    .operador(operadorUser)
                                    .caixaStatus(currentOpen)
                                    .build();
                            caixaMovimentacaoRepository.save(mvCash);
                            cashMovIds.add(mvCash.getId());
                        }
                    } else {
                        double sum = pays.stream().mapToDouble(p -> p.getValor() == null ? 0.0 : p.getValor()).sum();
                        if (Math.abs(sum - totalPriceDiff) > eps) {
                            log.warn(
                                    "[ADJ] EXCHANGE_PAYMENTS_MISMATCH corr={} saleId={} itemId={} expectedDiff={} sumPayments={}",
                                    corr, id, targetItem.getId(), totalPriceDiff, sum);
                            return ResponseEntity.badRequest()
                                    .body(Map.of("error", "Soma dos pagamentos não confere com diferença de preço"));
                        }
                        // persist payments: sale payments for all methods, and caixa movimentacao for
                        // cash parts
                        for (var pd : pays) {
                            SalePayment sp = SalePayment.builder()
                                    .venda(venda)
                                    .metodo(pd.getMetodo() == null ? "dinheiro" : pd.getMetodo())
                                    .valor(pd.getValor())
                                    .troco(null)
                                    .build();
                            if (currentOpen != null)
                                sp.setCaixaStatus(currentOpen);
                            venda.getPagamentos().add(sp);
                            if ("dinheiro".equals(sp.getMetodo()) && pd.getValor() != null && pd.getValor() > eps) {
                                com.example.backendspring.caixa.CaixaMovimentacao mvCash = com.example.backendspring.caixa.CaixaMovimentacao
                                        .builder()
                                        .tipo("entrada")
                                        .valor(pd.getValor())
                                        .descricao("Pagamento adicional por troca venda " + venda.getId())
                                        .dataMovimento(OffsetDateTime.now())
                                        .criadoEm(OffsetDateTime.now())
                                        .operador(operadorUser)
                                        .caixaStatus(currentOpen)
                                        .build();
                                caixaMovimentacaoRepository.save(mvCash);
                                cashMovIds.add(mvCash.getId());
                                log.info(
                                        "[ADJ] EXCHANGE_CASH_IN_PART corr={} saleId={} itemId={} valor={} movId={} operador={}",
                                        corr, id, targetItem.getId(), pd.getValor(), mvCash.getId(), operatorUsername);
                            }
                        }
                    }
                } else {
                    // diferença negativa => reembolso ao cliente
                    double refund = Math.abs(totalPriceDiff);
                    java.util.List<PaymentDto> pays = req.getPayments();
                    if (pays != null && !pays.isEmpty()) {
                        double sum = pays.stream().mapToDouble(p -> p.getValor() == null ? 0.0 : p.getValor()).sum();
                        if (Math.abs(sum - refund) > 0.01) {
                            log.warn(
                                    "[ADJ] EXCHANGE_REFUND_MISMATCH corr={} saleId={} itemId={} expectedRefundDiff={} sumPayments={}",
                                    corr, id, targetItem.getId(), refund, sum);
                            return ResponseEntity.badRequest().body(Map.of("error",
                                    "Soma dos pagamentos de reembolso não confere com diferença de preço"));
                        }
                        for (var pd : pays) {
                            double val = pd.getValor() == null ? 0.0 : pd.getValor();
                            if (val <= 0)
                                continue;
                            SalePayment neg = SalePayment.builder()
                                    .venda(venda)
                                    .metodo(pd.getMetodo() == null
                                            ? (req.getPaymentMethod() == null ? "dinheiro" : req.getPaymentMethod())
                                            : pd.getMetodo())
                                    .valor(-val)
                                    .troco(null)
                                    .build();
                            if (currentOpen != null)
                                neg.setCaixaStatus(currentOpen);
                            venda.getPagamentos().add(neg);
                            if ("dinheiro".equalsIgnoreCase(neg.getMetodo())) {
                                com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                                        .builder()
                                        .tipo("retirada")
                                        .valor(val)
                                        .descricao("Reembolso por troca venda " + venda.getId())
                                        .dataMovimento(OffsetDateTime.now())
                                        .criadoEm(OffsetDateTime.now())
                                        .operador(operadorUser)
                                        .caixaStatus(currentOpen)
                                        .build();
                                caixaMovimentacaoRepository.save(mv);
                                cashMovIds.add(mv.getId());
                                log.info(
                                        "[ADJ] EXCHANGE_CASH_OUT_PART corr={} saleId={} itemId={} valor={} movId={} operador={}",
                                        corr, id, targetItem.getId(), val, mv.getId(), operatorUsername);
                            }
                        }
                    } else {
                        String metodo = req.getPaymentMethod() == null ? "dinheiro" : req.getPaymentMethod();
                        SalePayment neg = SalePayment.builder()
                                .venda(venda)
                                .metodo(metodo)
                                .valor(-refund)
                                .troco(null)
                                .build();
                        if (currentOpen != null)
                            neg.setCaixaStatus(currentOpen);
                        venda.getPagamentos().add(neg);
                        if ("dinheiro".equalsIgnoreCase(metodo)) {
                            com.example.backendspring.caixa.CaixaMovimentacao mv = com.example.backendspring.caixa.CaixaMovimentacao
                                    .builder()
                                    .tipo("retirada")
                                    .valor(refund)
                                    .descricao("Reembolso por troca venda " + venda.getId())
                                    .dataMovimento(OffsetDateTime.now())
                                    .criadoEm(OffsetDateTime.now())
                                    .operador(operadorUser)
                                    .caixaStatus(currentOpen)
                                    .build();
                            caixaMovimentacaoRepository.save(mv);
                            cashMovIds.add(mv.getId());
                            log.info(
                                    "[ADJ] EXCHANGE_CASH_OUT_SINGLE corr={} saleId={} itemId={} valor={} movId={} operador={}",
                                    corr, id, targetItem.getId(), refund, mv.getId(), operatorUsername);
                        }
                    }
                }
            }

            // recompute totals
            double newSubtotal = venda.getItens().stream().mapToDouble(it -> it.getPrecoTotal()).sum();
            venda.setSubtotal(newSubtotal);
            venda.setTotalFinal(newSubtotal - (venda.getDesconto() == null ? 0.0 : venda.getDesconto())
                    + (venda.getAcrescimo() == null ? 0.0 : venda.getAcrescimo()));

            // status para diferenciar
            venda.setStatus("TROCADA");
            // recalcula adjustedTotal = soma pagamentos
            try {
                venda.setAdjustedTotal(venda.getPagamentos().stream()
                        .mapToDouble(p -> p.getValor() == null ? 0.0 : p.getValor()).sum());
            } catch (Exception ignored) {
            }
            saleOrderRepository.save(venda);

            // create adjustment record (com detail JSON)
            SaleAdjustment adj;
            try {
                java.util.Map<String, Object> detail = new java.util.LinkedHashMap<>();
                detail.put("correlation_id", corr);
                detail.put("original_item_id", targetItem.getId());
                detail.put("removed_original", itemRemovedExchange);
                detail.put("exchange_quantity", qty);
                detail.put("replacement_product_id", replacement.getId());
                detail.put("price_difference", totalPriceDiff);
                detail.put("cash_movements_ids", cashMovIds);
                detail.put("payments",
                        (req.getPayments() == null ? java.util.List.of()
                                : req.getPayments().stream()
                                        .map(p -> java.util.Map.of("metodo", p.getMetodo(), "valor", p.getValor()))
                                        .toList()));
                String jsonDetail = objectToJson(detail);
                adj = SaleAdjustment.builder()
                        .saleOrder(venda)
                        .saleItem(itemRemovedExchange ? null : targetItem)
                        .type("exchange")
                        .quantity(qty)
                        .replacementProductId(replacement.getId())
                        .priceDifference(totalPriceDiff)
                        .paymentMethod(req.getPaymentMethod())
                        .notes(req.getNotes())
                        .operatorUsername(operatorUsername)
                        .createdAt(OffsetDateTime.now())
                        .detailJson(jsonDetail)
                        .build();
            } catch (Exception ex) {
                adj = SaleAdjustment.builder()
                        .saleOrder(venda)
                        .saleItem(itemRemovedExchange ? null : targetItem)
                        .type("exchange")
                        .quantity(qty)
                        .replacementProductId(replacement.getId())
                        .priceDifference(totalPriceDiff)
                        .paymentMethod(req.getPaymentMethod())
                        .notes(req.getNotes())
                        .operatorUsername(operatorUsername)
                        .createdAt(OffsetDateTime.now())
                        .build();
            }
            saleAdjustmentRepository.save(adj);

            log.info(
                    "[ADJ] EXCHANGE_DONE corr={} saleId={} itemId={} qty={} replacementId={} diff={} adjustedTotal={} status={} adjustmentId={} remainingItems={} replacementItemId={}",
                    corr, venda.getId(), item.getId(), qty, replacement.getId(), totalPriceDiff,
                    venda.getAdjustedTotal(),
                    venda.getStatus(), adj.getId(), (venda.getItens() == null ? 0 : venda.getItens().size()),
                    newItem.getId());
            return ResponseEntity.status(201)
                    .body(Map.of("message", "Exchange processed", "adjustmentId", adj.getId()));
        }

        return ResponseEntity.badRequest().body(Map.of("error", "Tipo inválido"));
    }

    @GetMapping("/{id}/adjustments")
    @Transactional(readOnly = true)
    public ResponseEntity<Object> listAdjustments(@PathVariable Long id) {
        var venda = saleOrderRepository.findById(id).orElse(null);
        if (venda == null)
            return ResponseEntity.status(404).body(Map.of("error", "Venda não encontrada"));
        try {
            var list = saleAdjustmentRepository.findBySaleOrderId(id);
            var out = list.stream().map(a -> {
                java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                m.put("id", a.getId());
                m.put("type", a.getType());
                m.put("sale_item_id", a.getSaleItem() != null ? a.getSaleItem().getId() : null);
                m.put("quantity", a.getQuantity());
                m.put("replacement_product_id", a.getReplacementProductId());
                m.put("price_difference", a.getPriceDifference());
                m.put("payment_method", a.getPaymentMethod());
                m.put("notes", a.getNotes());
                m.put("operator_username", a.getOperatorUsername());
                m.put("created_at", a.getCreatedAt());
                return m;
            }).toList();
            return ResponseEntity.ok(out);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Falha ao listar ajustes"));
        }
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
        private java.util.List<PaymentDto> payments;
        private String correlationId; // optional correlation id from frontend for log tracing
    }

    @Data
    public static class PaymentDto {
        private String metodo;
        private Double valor;
    }
}
