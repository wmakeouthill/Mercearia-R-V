package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.example.backendspring.client.Client;
import com.example.backendspring.client.ClientRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
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
    private final SaleReportService saleReportService;
    private final SaleDeletionRepository saleDeletionRepository;
    private final ObjectMapper objectMapper;

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
