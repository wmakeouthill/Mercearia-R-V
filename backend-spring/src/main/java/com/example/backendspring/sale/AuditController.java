package com.example.backendspring.sale;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.Optional;

import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

@RestController
@RequestMapping("/api/audit")
@RequiredArgsConstructor
public class AuditController {

    private static final Logger log = LoggerFactory.getLogger(AuditController.class);
    private final SaleDeletionRepository saleDeletionRepository;
    private final SaleRepository saleRepository;
    private final SaleOrderRepository saleOrderRepository;
    private final com.example.backendspring.product.ProductRepository productRepository;
    private final ObjectMapper objectMapper;

    @GetMapping("/sales")
    public ResponseEntity<Map<String, Object>> listDeletedSales(
            @RequestParam(value = "page", required = false, defaultValue = "0") int page,
            @RequestParam(value = "size", required = false, defaultValue = "20") int size) {
        try {
            var pg = saleDeletionRepository
                    .findAll(PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "deletedAt")));
            var items = pg.getContent().stream().map(sd -> {
                java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                m.put("id", sd.getId());
                m.put("saleId", sd.getSaleId());
                m.put("saleType", sd.getSaleType());
                m.put("payload", sd.getPayload());
                m.put("deletedBy", sd.getDeletedBy());
                m.put("deletedAt", sd.getDeletedAt());
                return m;
            }).toList();
            java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
            resp.put("items", items);
            resp.put("total", pg.getTotalElements());
            resp.put("hasNext", pg.hasNext());
            resp.put("page", pg.getNumber());
            resp.put("size", pg.getSize());
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.warn("Failed to load audit sales: {}", e.getMessage());
            return ResponseEntity.ok(Map.of("items", List.of(), "total", 0, "hasNext", false, "page", 0, "size", size));
        }
    }

    @PutMapping("/sales/{id}/restore")
    @Transactional
    public ResponseEntity<Object> restoreDeletedSale(@PathVariable Long id) {
        try {
            Optional<SaleDeletion> maybe = saleDeletionRepository.findById(id);
            if (maybe.isEmpty())
                return ResponseEntity.status(404).body(Map.of("error", "Registro de auditoria não encontrado"));

            SaleDeletion sd = maybe.get();
            String payload = sd.getPayload();
            @SuppressWarnings("unchecked")
            Map<String, Object> data = objectMapper.readValue(payload, Map.class);

            String type = sd.getSaleType() == null ? "legacy" : sd.getSaleType();
            if ("legacy".equals(type)) {
                Number produtoIdNum = (Number) (data.getOrDefault("produto_id", data.get("produtoId")));
                Number quantidadeNum = (Number) (data.getOrDefault("quantidade_vendida",
                        data.getOrDefault("quantidade", 0)));
                Number precoNum = (Number) (data.getOrDefault("preco_total", data.getOrDefault("precoTotal", 0)));
                String metodo = (String) data.getOrDefault("metodo_pagamento",
                        data.getOrDefault("metodoPagamento", "dinheiro"));
                String dataVendaStr = data.getOrDefault("data_venda", data.get("dataVenda")).toString();

                if (produtoIdNum == null)
                    return ResponseEntity.badRequest().body(Map.of("error", "Produto inválido no payload"));

                Long produtoId = produtoIdNum.longValue();
                int quantidade = quantidadeNum == null ? 0 : quantidadeNum.intValue();
                double preco = precoNum == null ? 0.0 : precoNum.doubleValue();

                var produto = productRepository.findById(produtoId).orElse(null);
                if (produto == null)
                    return ResponseEntity.status(404).body(Map.of("error", "Produto não encontrado"));

                if (produto.getQuantidadeEstoque() < quantidade)
                    return ResponseEntity.badRequest()
                            .body(Map.of("error", "Estoque insuficiente para restaurar venda"));

                produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - quantidade);
                productRepository.save(produto);

                OffsetDateTime dt = OffsetDateTime.parse(dataVendaStr);
                Sale sale = Sale.builder()
                        .produto(produto)
                        .quantidadeVendida(quantidade)
                        .precoTotal(preco)
                        .dataVenda(dt)
                        .metodoPagamento(metodo)
                        .build();

                saleRepository.save(sale);
                return ResponseEntity.ok(Map.of("message", "Venda restaurada com sucesso"));
            } else if ("checkout".equals(type)) {
                // payload expected to have keys: id, data_venda, subtotal, desconto, acrescimo,
                // total_final, itens[], pagamentos[]
                String dataVendaStr = data.getOrDefault("data_venda", data.get("dataVenda")).toString();
                Number subtotalNum = (Number) data.getOrDefault("subtotal", 0);
                Number descontoNum = (Number) data.getOrDefault("desconto", 0);
                Number acrescimoNum = (Number) data.getOrDefault("acrescimo", 0);
                Number totalNum = (Number) data.getOrDefault("total_final", data.getOrDefault("totalFinal", 0));

                OffsetDateTime dt = OffsetDateTime.parse(dataVendaStr);
                SaleOrder order = SaleOrder.builder()
                        .dataVenda(dt)
                        .subtotal(subtotalNum == null ? 0.0 : subtotalNum.doubleValue())
                        .desconto(descontoNum == null ? 0.0 : descontoNum.doubleValue())
                        .acrescimo(acrescimoNum == null ? 0.0 : acrescimoNum.doubleValue())
                        .totalFinal(totalNum == null ? 0.0 : totalNum.doubleValue())
                        .build();

                @SuppressWarnings("unchecked")
                List<Map<String, Object>> itens = (List<Map<String, Object>>) data.getOrDefault("itens", List.of());
                for (Map<String, Object> it : itens) {
                    Number prodIdNum = (Number) (it.getOrDefault("produto_id", it.get("produtoId")));
                    Number quantidadeNum = (Number) (it.getOrDefault("quantidade",
                            it.getOrDefault("quantidade_vendida", 0)));
                    Number precoUnitNum = (Number) (it.getOrDefault("preco_unitario",
                            it.getOrDefault("precoUnitario", 0)));
                    Number precoTotalNum = (Number) (it.getOrDefault("preco_total", it.getOrDefault("precoTotal", 0)));
                    if (prodIdNum == null)
                        continue;
                    Long prodId = prodIdNum.longValue();
                    int quantidade = quantidadeNum == null ? 0 : quantidadeNum.intValue();

                    var produto = productRepository.findById(prodId).orElse(null);
                    if (produto == null)
                        return ResponseEntity.status(404).body(Map.of("error", "Produto não encontrado: " + prodId));
                    if (produto.getQuantidadeEstoque() < quantidade)
                        return ResponseEntity.badRequest()
                                .body(Map.of("error", "Estoque insuficiente para restaurar venda"));

                    produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - quantidade);
                    productRepository.save(produto);

                    SaleItem si = SaleItem.builder()
                            .venda(order)
                            .produto(produto)
                            .quantidade(quantidade)
                            .precoUnitario(precoUnitNum == null ? 0.0 : precoUnitNum.doubleValue())
                            .precoTotal(precoTotalNum == null ? 0.0 : precoTotalNum.doubleValue())
                            .build();
                    order.getItens().add(si);
                }

                @SuppressWarnings("unchecked")
                List<Map<String, Object>> pagamentos = (List<Map<String, Object>>) data.getOrDefault("pagamentos",
                        List.of());
                for (Map<String, Object> pg : pagamentos) {
                    String metodo = (String) pg.getOrDefault("metodo", "dinheiro");
                    Number valorNum = (Number) pg.getOrDefault("valor", 0);
                    Number trocoNum = (Number) pg.get("troco");
                    SalePayment sp = SalePayment.builder()
                            .venda(order)
                            .metodo(metodo)
                            .valor(valorNum == null ? 0.0 : valorNum.doubleValue())
                            .troco(trocoNum == null ? null : trocoNum.doubleValue())
                            .build();
                    order.getPagamentos().add(sp);
                }

                saleOrderRepository.save(order);
                return ResponseEntity.ok(Map.of("message", "Venda de checkout restaurada com sucesso"));
            }

            return ResponseEntity.badRequest().body(Map.of("error", "Tipo de venda desconhecido"));
        } catch (Exception e) {
            log.error("Failed to restore deleted sale", e);
            return ResponseEntity.status(500)
                    .body(Map.of("error", "Falha ao restaurar venda", "details", e.getMessage()));
        }
    }

    // Debug endpoint (admins) to get count and recent raw entries to aid
    // troubleshooting
    @GetMapping("/debug")
    public ResponseEntity<Map<String, Object>> debugAudit() {
        try {
            long count = saleDeletionRepository.count();
            var page = saleDeletionRepository.findAll(PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "deletedAt")));
            return ResponseEntity.ok(Map.of("count", count, "recent", page.getContent()));
        } catch (Exception e) {
            log.warn("Failed to debug audit: {}", e.getMessage(), e);
            return ResponseEntity.ok(Map.of("count", 0, "recent", List.of()));
        }
    }
}
