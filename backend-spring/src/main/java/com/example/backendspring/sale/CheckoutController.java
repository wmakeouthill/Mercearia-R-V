package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Set;

@RestController
@RequestMapping("/api/checkout")
@RequiredArgsConstructor
public class CheckoutController {

    private final SaleOrderRepository saleOrderRepository;
    private final com.example.backendspring.client.ClientRepository clientRepository;
    private final ProductRepository productRepository;
    private final SaleDeletionRepository saleDeletionRepository;
    private final ObjectMapper objectMapper;

    private static final String DEFAULT_PAGAMENTO = "dinheiro";
    private static final String KEY_ERROR = "error";
    private static final Set<String> ALLOWED_PAYMENT_METHODS = Set.of(
            DEFAULT_PAGAMENTO, "cartao_credito", "cartao_debito", "pix");
    private static final Logger log = LoggerFactory.getLogger(CheckoutController.class);

    @PostMapping
    @Transactional
    public ResponseEntity<Object> create(@RequestBody CheckoutRequest req) {
        try {
            // validações básicas
            if (req.getItens() == null || req.getItens().isEmpty()) {
                return badRequest("Itens da venda são obrigatórios");
            }
            if (req.getPagamentos() == null || req.getPagamentos().isEmpty()) {
                return badRequest("Pelo menos um pagamento é obrigatório");
            }

            String itensError = validateItens(req.getItens());
            if (itensError != null) {
                return badRequest(itensError);
            }

            double subtotal = calculateSubtotal(req.getItens());
            double desconto = req.getDesconto() != null ? req.getDesconto() : 0.0;
            double acrescimo = req.getAcrescimo() != null ? req.getAcrescimo() : 0.0;
            double totalFinal = subtotal - desconto + acrescimo;

            if (totalFinal < 0) {
                return badRequest("Total final inválido");
            }

            String pagamentosError = validatePagamentosValores(req.getPagamentos());
            if (pagamentosError != null) {
                return badRequest(pagamentosError);
            }

            // validar soma de pagamentos
            double somaPagamentos = req.getPagamentos().stream().mapToDouble(CheckoutPayment::getValor).sum();
            if (Math.abs(somaPagamentos - totalFinal) > 0.01) {
                return badRequest("Soma dos pagamentos deve ser igual ao total");
            }

            // validar métodos de pagamento suportados
            String metodoError = validatePaymentMethods(req.getPagamentos());
            if (metodoError != null) {
                return badRequest(metodoError);
            }

            // validar estoque existente
            ResponseEntity<Object> estoqueError = validateStock(req.getItens());
            if (estoqueError != null) {
                return estoqueError;
            }

            log.info("CHECKOUT request recebido: itens={}, pagamentos={}, subtotal={}, total={}",
                    req.getItens().size(), req.getPagamentos().size(), subtotal, totalFinal);

            // criar venda e persistir
            SaleOrder venda = createSaleOrder(subtotal, desconto, acrescimo, totalFinal);
            // se vier dados do cliente, persistir
            if (req.getCustomerName() != null)
                venda.setCustomerName(req.getCustomerName());
            if (req.getCustomerEmail() != null)
                venda.setCustomerEmail(req.getCustomerEmail());
            if (req.getCustomerPhone() != null)
                venda.setCustomerPhone(req.getCustomerPhone());

            // if customer email/phone provided, try to find or create client and link sales
            try {
                if (req.getCustomerEmail() != null || req.getCustomerPhone() != null) {
                    com.example.backendspring.client.Client cliente = null;
                    if (req.getCustomerEmail() != null) {
                        cliente = clientRepository.findByEmail(req.getCustomerEmail()).orElse(null);
                    }
                    if (cliente == null && req.getCustomerPhone() != null) {
                        cliente = clientRepository.findByTelefone(req.getCustomerPhone()).orElse(null);
                    }
                    if (cliente == null) {
                        cliente = com.example.backendspring.client.Client.builder()
                                .nome(req.getCustomerName() != null ? req.getCustomerName() : "Cliente")
                                .email(req.getCustomerEmail())
                                .telefone(req.getCustomerPhone())
                                .createdAt(java.time.OffsetDateTime.now())
                                .build();
                        clientRepository.save(cliente);
                    }
                    // link each sale item to cliente (persisted as Sale rows)
                    // After save(venda) and addItemsToOrder, we'll create Sale rows linked to
                    // cliente
                    // Store on venda for later linking
                    venda.setCustomerName(venda.getCustomerName());
                }
            } catch (Exception e) {
                // ignore non-critical client save errors
            }

            saleOrderRepository.save(venda);

            addItemsToOrder(venda, req.getItens());
            addPaymentsToOrder(venda, req.getPagamentos());

            saleOrderRepository.save(venda);

            Map<String, Object> resp = buildResponse(venda);
            return ResponseEntity.status(201).body(resp);
        } catch (Exception e) {
            log.error("Erro no checkout", e);
            return ResponseEntity.status(500)
                    .body(Map.of(KEY_ERROR, "Falha ao processar checkout", "details", e.getMessage()));
        }
    }

    @PatchMapping("/{id}/contato")
    @Transactional
    public ResponseEntity<Object> updateContact(@PathVariable Long id, @RequestBody Map<String, String> payload) {
        var venda = saleOrderRepository.findById(id).orElse(null);
        if (venda == null)
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Venda não encontrada"));

        if (payload.containsKey("customerName"))
            venda.setCustomerName(payload.get("customerName"));
        if (payload.containsKey("customerEmail"))
            venda.setCustomerEmail(payload.get("customerEmail"));
        if (payload.containsKey("customerPhone"))
            venda.setCustomerPhone(payload.get("customerPhone"));

        // Try to find or create client and associate
        try {
            com.example.backendspring.client.Client cliente = null;
            String email = venda.getCustomerEmail();
            String phone = venda.getCustomerPhone();
            if (email != null && !email.isBlank()) {
                cliente = this.clientRepository.findByEmail(email).orElse(null);
            }
            if (cliente == null && phone != null && !phone.isBlank()) {
                cliente = this.clientRepository.findByTelefone(phone).orElse(null);
            }
            if (cliente == null) {
                cliente = com.example.backendspring.client.Client.builder()
                        .nome(venda.getCustomerName() != null ? venda.getCustomerName() : "Cliente")
                        .email(email)
                        .telefone(phone)
                        .createdAt(java.time.OffsetDateTime.now())
                        .build();
                this.clientRepository.save(cliente);
            }
            if (cliente != null) {
                venda.setCliente(cliente);
            }
        } catch (Exception e) {
            // ignore client creation/link errors
        }

        saleOrderRepository.save(venda);
        java.util.Map<String, Object> resp = new java.util.LinkedHashMap<>();
        resp.put("message", "Contato atualizado");
        try {
            if (venda.getCliente() != null)
                resp.put("cliente_id", venda.getCliente().getId());
        } catch (Exception e) {
            /* ignore */ }
        return ResponseEntity.ok(resp);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<List<Map<String, Object>>> listAll() {
        List<Map<String, Object>> lista = saleOrderRepository.findAll().stream()
                .sorted(Comparator.comparing(SaleOrder::getDataVenda).reversed())
                .map(venda -> {
                    Map<String, Object> resp = new LinkedHashMap<>();
                    resp.put("id", venda.getId());
                    resp.put("data_venda", venda.getDataVenda());
                    resp.put("subtotal", venda.getSubtotal());
                    resp.put("desconto", venda.getDesconto());
                    resp.put("acrescimo", venda.getAcrescimo());
                    resp.put("total_final", venda.getTotalFinal());

                    var itens = venda.getItens().stream().map(it -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("produto_id", it.getProduto().getId());
                        m.put("produto_nome", it.getProduto().getNome());
                        m.put("produto_imagem", it.getProduto().getImagem());
                        m.put("quantidade", it.getQuantidade());
                        m.put("preco_unitario", it.getPrecoUnitario());
                        m.put("preco_total", it.getPrecoTotal());
                        return m;
                    }).toList();
                    var pagamentos = venda.getPagamentos().stream().map(pg -> {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("metodo", pg.getMetodo());
                        m.put("valor", pg.getValor());
                        if (pg.getTroco() != null)
                            m.put("troco", pg.getTroco());
                        return m;
                    }).toList();

                    resp.put("itens", itens);
                    resp.put("pagamentos", pagamentos);
                    return resp;
                }).toList();
        return ResponseEntity.ok(lista);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<Object> deleteOrder(@PathVariable Long id, HttpServletRequest request) {
        var venda = saleOrderRepository.findById(id).orElse(null);
        if (venda == null) {
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Venda não encontrada"));
        }

        // build response payload before deletion
        Map<String, Object> resp = buildResponse(venda);

        // record deletion audit BEFORE deleting to ensure audit exists; keep within
        // transaction so rollback will undo delete if audit fails
        try {
            String payloadJson = objectMapper.writeValueAsString(resp);
            String deletedBy = null;
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null)
                deletedBy = auth.getName();
            SaleDeletion sd = SaleDeletion.builder()
                    .saleId(venda.getId())
                    .saleType("checkout")
                    .payload(payloadJson)
                    .deletedBy(deletedBy)
                    .deletedAt(OffsetDateTime.now())
                    .build();
            saleDeletionRepository.saveAndFlush(sd);
            log.info("SALE_DELETION AUDIT_SAVED saleDeletionId={} saleId={}", sd.getId(), sd.getSaleId());
        } catch (Exception e) {
            log.error("Audit save failed, aborting delete: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to record checkout deletion audit", e);
        }

        // restaurar estoque para cada item da ordem
        venda.getItens().forEach(it -> {
            Product produto = it.getProduto();
            produto.setQuantidadeEstoque(produto.getQuantidadeEstoque() + it.getQuantidade());
            productRepository.save(produto);
        });

        saleOrderRepository.deleteById(id);

        return ResponseEntity.ok(Map.of("message", "Venda deletada com sucesso"));
    }

    private ResponseEntity<Object> badRequest(String message) {
        return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, message));
    }

    private String validateItens(List<CheckoutItem> itens) {
        for (CheckoutItem item : itens) {
            if (item.getProdutoId() == null || item.getQuantidade() == null || item.getQuantidade() <= 0
                    || item.getPrecoUnitario() == null) {
                return "Item inválido";
            }
        }
        return null;
    }

    private double calculateSubtotal(List<CheckoutItem> itens) {
        double subtotal = 0.0;
        for (CheckoutItem item : itens) {
            subtotal += item.getQuantidade() * item.getPrecoUnitario();
        }
        return subtotal;
    }

    private String validatePagamentosValores(List<CheckoutPayment> pagamentos) {
        for (CheckoutPayment p : pagamentos) {
            if (p.getValor() == null || p.getValor() < 0) {
                return "Valor do pagamento inválido";
            }
        }
        return null;
    }

    private String validatePaymentMethods(List<CheckoutPayment> pagamentos) {
        for (CheckoutPayment p : pagamentos) {
            String metodo = p.getMetodo() == null ? DEFAULT_PAGAMENTO : p.getMetodo();
            if (!ALLOWED_PAYMENT_METHODS.contains(metodo)) {
                return "Método de pagamento inválido: " + metodo;
            }
        }
        return null;
    }

    private ResponseEntity<Object> validateStock(List<CheckoutItem> itens) {
        for (CheckoutItem item : itens) {
            Product produto = productRepository.findById(item.getProdutoId()).orElse(null);
            if (produto == null) {
                return ResponseEntity.status(404).body(Map.of(KEY_ERROR,
                        "Produto não encontrado: " + item.getProdutoId()));
            }
            if (produto.getQuantidadeEstoque() < item.getQuantidade()) {
                return badRequest("Estoque insuficiente para o produto: " + produto.getNome());
            }
        }
        return null;
    }

    private SaleOrder createSaleOrder(double subtotal, double desconto, double acrescimo, double totalFinal) {
        return SaleOrder.builder()
                .dataVenda(OffsetDateTime.now())
                .subtotal(subtotal)
                .desconto(desconto)
                .acrescimo(acrescimo)
                .totalFinal(totalFinal)
                .build();
    }

    private void addItemsToOrder(SaleOrder venda, List<CheckoutItem> itens) {
        for (CheckoutItem item : itens) {
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
    }

    private void addPaymentsToOrder(SaleOrder venda, List<CheckoutPayment> pagamentos) {
        for (CheckoutPayment p : pagamentos) {
            String metodo = p.getMetodo() == null ? DEFAULT_PAGAMENTO : p.getMetodo();
            SalePayment sp = SalePayment.builder()
                    .venda(venda)
                    .metodo(metodo)
                    .valor(p.getValor())
                    .troco(p.getTroco())
                    .build();
            venda.getPagamentos().add(sp);
        }
    }

    private Map<String, Object> buildResponse(SaleOrder venda) {
        var itens = venda.getItens().stream().map(it -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("produto_id", it.getProduto().getId());
            m.put("produto_nome", it.getProduto().getNome());
            m.put("produto_imagem", it.getProduto().getImagem());
            m.put("quantidade", it.getQuantidade());
            m.put("preco_unitario", it.getPrecoUnitario());
            m.put("preco_total", it.getPrecoTotal());
            return m;
        }).toList();

        var pagamentos = venda.getPagamentos().stream().map(pg -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("metodo", pg.getMetodo());
            m.put("valor", pg.getValor());
            if (pg.getTroco() != null) {
                m.put("troco", pg.getTroco());
            }
            return m;
        }).toList();

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("id", venda.getId());
        resp.put("data_venda", venda.getDataVenda());
        resp.put("subtotal", venda.getSubtotal());
        resp.put("desconto", venda.getDesconto());
        resp.put("acrescimo", venda.getAcrescimo());
        resp.put("total_final", venda.getTotalFinal());
        resp.put("itens", itens);
        resp.put("pagamentos", pagamentos);
        // include customer contact fields if present
        if (venda.getCustomerName() != null)
            resp.put("customer_name", venda.getCustomerName());
        if (venda.getCustomerEmail() != null)
            resp.put("customer_email", venda.getCustomerEmail());
        if (venda.getCustomerPhone() != null)
            resp.put("customer_phone", venda.getCustomerPhone());
        return resp;
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
        @JsonProperty("customerName")
        private String customerName;
        @JsonProperty("customerEmail")
        private String customerEmail;
        @JsonProperty("customerPhone")
        private String customerPhone;
    }
}
