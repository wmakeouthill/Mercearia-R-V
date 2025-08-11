package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/vendas")
@RequiredArgsConstructor
public class SaleController {

    private final SaleRepository saleRepository;
    private final ProductRepository productRepository;

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_QTD_VENDIDA = "quantidade_vendida";
    private static final String DEFAULT_PAGAMENTO = "dinheiro";

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

    @PostMapping
    @Transactional
    public ResponseEntity<Object> create(@RequestBody CreateSaleRequest req) {
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

        produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - req.getQuantidadeVendida());
        productRepository.save(produto);

        Sale sale = Sale.builder()
                .produto(produto)
                .quantidadeVendida(req.getQuantidadeVendida())
                .precoTotal(req.getPrecoTotal())
                .dataVenda(OffsetDateTime.now())
                .metodoPagamento(metodo)
                .build();
        saleRepository.save(sale);

        return ResponseEntity.status(201).body(Map.of(
                "id", sale.getId(),
                "produto_id", produto.getId(),
                KEY_QTD_VENDIDA, sale.getQuantidadeVendida(),
                "preco_total", sale.getPrecoTotal(),
                "data_venda", sale.getDataVenda(),
                "metodo_pagamento", sale.getMetodoPagamento(),
                "produto_nome", produto.getNome()));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<Object> delete(@PathVariable Long id) {
        Sale venda = saleRepository.findById(id).orElse(null);
        if (venda == null)
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Venda não encontrada"));
        Product produto = venda.getProduto();
        produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() + venda.getQuantidadeVendida());
        productRepository.save(produto);
        saleRepository.deleteById(id);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Venda deletada com sucesso"));
    }

    @GetMapping("/relatorios/dia")
    public Map<String, Object> relatorioDia() {
        var today = java.time.LocalDate.now();
        long total = saleRepository.countByDia(today);
        long qtd = saleRepository.somaQuantidadeByDia(today);
        double receita = saleRepository.somaReceitaByDia(today);
        return Map.of("data", today.toString(), "total_vendas", total, KEY_QTD_VENDIDA, qtd, "receita_total",
                receita);
    }

    @GetMapping("/relatorios/mes")
    public Map<String, Object> relatorioMes() {
        // Para simplificar, vamos calcular via memória buscando do mês corrente
        List<Sale> vendas = saleRepository.findAll();
        var hoje = OffsetDateTime.now();
        var inicio = hoje.withDayOfMonth(1).toLocalDate();
        var fim = hoje.withDayOfMonth(hoje.toLocalDate().lengthOfMonth()).toLocalDate();
        long total = vendas.stream().filter(
                v -> !v.getDataVenda().toLocalDate().isBefore(inicio) && !v.getDataVenda().toLocalDate().isAfter(fim))
                .count();
        long qtd = vendas.stream().filter(
                v -> !v.getDataVenda().toLocalDate().isBefore(inicio) && !v.getDataVenda().toLocalDate().isAfter(fim))
                .mapToLong(Sale::getQuantidadeVendida).sum();
        double receita = vendas.stream().filter(
                v -> !v.getDataVenda().toLocalDate().isBefore(inicio) && !v.getDataVenda().toLocalDate().isAfter(fim))
                .mapToDouble(Sale::getPrecoTotal).sum();
        return Map.of("periodo", inicio + " a " + fim, "total_vendas", total, KEY_QTD_VENDIDA, qtd,
                "receita_total", receita);
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
    }
}
