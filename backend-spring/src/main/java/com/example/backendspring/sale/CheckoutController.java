package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/checkout")
@RequiredArgsConstructor
public class CheckoutController {

    private final SaleOrderRepository saleOrderRepository;
    private final ProductRepository productRepository;

    private static final String DEFAULT_PAGAMENTO = "dinheiro";
    private static final Logger log = LoggerFactory.getLogger(CheckoutController.class);

    @PostMapping
    @Transactional
    public ResponseEntity<Object> create(@RequestBody CheckoutRequest req) {
        try {
            if (req.getItens() == null || req.getItens().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Itens da venda são obrigatórios"));
            }
            if (req.getPagamentos() == null || req.getPagamentos().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Pelo menos um pagamento é obrigatório"));
            }

            // Calcular subtotal a partir dos itens
            double subtotal = 0.0;
            for (CheckoutItem item : req.getItens()) {
                if (item.getProdutoId() == null || item.getQuantidade() == null || item.getQuantidade() <= 0
                        || item.getPrecoUnitario() == null) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Item inválido"));
                }
                subtotal += item.getQuantidade() * item.getPrecoUnitario();
            }

            double desconto = req.getDesconto() != null ? req.getDesconto() : 0.0;
            double acrescimo = req.getAcrescimo() != null ? req.getAcrescimo() : 0.0;
            double totalFinal = subtotal - desconto + acrescimo;

            if (totalFinal < 0) {
                return ResponseEntity.badRequest().body(Map.of("error", "Total final inválido"));
            }

            // validar valores e somar pagamentos
            for (CheckoutPayment p : req.getPagamentos()) {
                if (p.getValor() == null || p.getValor() < 0) {
                    return ResponseEntity.badRequest().body(Map.of("error", "Valor do pagamento inválido"));
                }
            }
            double somaPagamentos = req.getPagamentos().stream().mapToDouble(CheckoutPayment::getValor).sum();
            if (Math.abs(somaPagamentos - totalFinal) > 0.01) {
                return ResponseEntity.badRequest().body(Map.of("error", "Soma dos pagamentos deve ser igual ao total"));
            }

            // Validar métodos
            for (CheckoutPayment p : req.getPagamentos()) {
                String metodo = p.getMetodo() == null ? DEFAULT_PAGAMENTO : p.getMetodo();
                switch (metodo) {
                    case DEFAULT_PAGAMENTO, "cartao_credito", "cartao_debito", "pix" -> {
                    }
                    default -> {
                        return ResponseEntity.badRequest()
                                .body(Map.of("error", "Método de pagamento inválido: " + metodo));
                    }
                }
            }

            // Debitar estoque
            for (CheckoutItem item : req.getItens()) {
                Product produto = productRepository.findById(item.getProdutoId()).orElse(null);
                if (produto == null) {
                    return ResponseEntity.status(404)
                            .body(Map.of("error", "Produto não encontrado: " + item.getProdutoId()));
                }
                if (produto.getQuantidadeEstoque() < item.getQuantidade()) {
                    return ResponseEntity.badRequest()
                            .body(Map.of("error", "Estoque insuficiente para o produto: " + produto.getNome()));
                }
            }

            log.info("CHECKOUT request recebido: itens={}, pagamentos={}, subtotal={}, total={}", req.getItens().size(),
                    req.getPagamentos().size(), subtotal, totalFinal);

            // Criar a venda
            SaleOrder venda = SaleOrder.builder()
                    .dataVenda(OffsetDateTime.now())
                    .subtotal(subtotal)
                    .desconto(desconto)
                    .acrescimo(acrescimo)
                    .totalFinal(totalFinal)
                    .build();

            saleOrderRepository.save(venda);

            for (CheckoutItem item : req.getItens()) {
                Product produto = productRepository.findById(item.getProdutoId()).orElseThrow();
                produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() - item.getQuantidade());
                productRepository.save(produto);

                SaleItem si = SaleItem.builder()
                        .venda(venda)
                        .produto(produto)
                        .quantidade(item.getQuantidade())
                        .precoUnitario(item.getPrecoUnitario())
                        .precoTotal(item.getPrecoUnitario() * item.getQuantidade())
                        .build();
                venda.getItens().add(si);
            }

            for (CheckoutPayment p : req.getPagamentos()) {
                String metodo = p.getMetodo() == null ? DEFAULT_PAGAMENTO : p.getMetodo();
                SalePayment sp = SalePayment.builder()
                        .venda(venda)
                        .metodo(metodo)
                        .valor(p.getValor())
                        .troco(p.getTroco())
                        .build();
                venda.getPagamentos().add(sp);
            }

            saleOrderRepository.save(venda);

            return ResponseEntity.status(201).body(Map.of(
                    "id", venda.getId(),
                    "data_venda", venda.getDataVenda(),
                    "subtotal", venda.getSubtotal(),
                    "desconto", venda.getDesconto(),
                    "acrescimo", venda.getAcrescimo(),
                    "total_final", venda.getTotalFinal(),
                    "itens", venda.getItens().stream().map(it -> Map.of(
                            "produto_id", it.getProduto().getId(),
                            "produto_nome", it.getProduto().getNome(),
                            "quantidade", it.getQuantidade(),
                            "preco_unitario", it.getPrecoUnitario(),
                            "preco_total", it.getPrecoTotal())).toList(),
                    "pagamentos", venda.getPagamentos().stream().map(pg -> Map.of(
                            "metodo", pg.getMetodo(),
                            "valor", pg.getValor(),
                            "troco", pg.getTroco())).toList()));
        } catch (Exception e) {
            log.error("Erro no checkout", e);
            return ResponseEntity.status(500)
                    .body(Map.of("error", "Falha ao processar checkout", "details", e.getMessage()));
        }
    }

    @Data
    public static class CheckoutItem {
        @JsonProperty("produtoId")
        private Long produtoId;
        @JsonProperty("quantidade")
        private Integer quantidade;
        @JsonProperty("precoUnitario")
        private Double precoUnitario;
    }

    @Data
    public static class CheckoutPayment {
        @JsonProperty("metodo")
        private String metodo;
        @JsonProperty("valor")
        private Double valor;
        @JsonProperty("troco")
        private Double troco;
    }

    @Data
    public static class CheckoutRequest {
        @JsonProperty("itens")
        private List<CheckoutItem> itens;
        @JsonProperty("pagamentos")
        private List<CheckoutPayment> pagamentos;
        @JsonProperty("desconto")
        private Double desconto;
        @JsonProperty("acrescimo")
        private Double acrescimo;
    }
}
