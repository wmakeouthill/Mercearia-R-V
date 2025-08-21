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
    private final com.example.backendspring.caixa.CaixaStatusRepository caixaStatusRepository;
    private final com.example.backendspring.user.UserRepository userRepository;

    private static final String DEFAULT_PAGAMENTO = "dinheiro";
    private static final String KEY_ERROR = "error";
    private static final Set<String> ALLOWED_PAYMENT_METHODS = Set.of(
            DEFAULT_PAGAMENTO, "cartao_credito", "cartao_debito", "pix");
    private static final Logger log = LoggerFactory.getLogger(CheckoutController.class);

    @PostMapping
    @Transactional
    public ResponseEntity<Object> create(@RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody CheckoutRequest req) {
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

            // bloquear checkout caso caixa fechado para todos os usuários (removida exceção
            // para admin)
            var status = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
            if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
                return ResponseEntity.status(403)
                        .body(Map.of("error", "Caixa fechado. Checkout não é permitido quando o caixa está fechado."));
            }

            // criar venda e persistir
            SaleOrder venda = createSaleOrder(subtotal, desconto, acrescimo, totalFinal);
            // associar operador (usuário autenticado) desde o início para persistir
            // corretamente. Se userId não estiver disponível, tentar via SecurityContext
            try {
                com.example.backendspring.user.User op = null;
                if (userId != null) {
                    op = userRepository.findById(userId).orElse(null);
                }
                if (op == null) {
                    var auth = SecurityContextHolder.getContext().getAuthentication();
                    if (auth != null && auth.getName() != null) {
                        try {
                            op = userRepository.findByUsername(auth.getName()).orElse(null);
                        } catch (Exception ignored) {
                        }
                    }
                }
                if (op != null)
                    venda.setOperador(op);
            } catch (Exception ignored) {
            }

            // (caixa ativa será verificada mais abaixo após associar cliente)
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
                    if (req.getCustomerEmail() != null && !req.getCustomerEmail().isBlank()) {
                        String emailNorm = req.getCustomerEmail().trim().toLowerCase();
                        try {
                            cliente = clientRepository.findByEmailIgnoreCase(emailNorm).orElse(null);
                        } catch (Exception e) {
                            cliente = clientRepository.findByEmail(req.getCustomerEmail()).orElse(null);
                        }
                    }
                    if (cliente == null && req.getCustomerPhone() != null && !req.getCustomerPhone().isBlank()) {
                        cliente = clientRepository.findByTelefone(req.getCustomerPhone()).orElse(null);
                    }
                    if (cliente == null) {
                        // prefer provided name, fallback to email local-part, then to placeholder
                        String nameToUse = null;
                        if (req.getCustomerName() != null && !req.getCustomerName().isBlank()) {
                            nameToUse = req.getCustomerName().trim();
                        } else if (req.getCustomerEmail() != null && req.getCustomerEmail().contains("@")) {
                            nameToUse = req.getCustomerEmail().split("@")[0];
                        } else if (req.getCustomerPhone() != null && !req.getCustomerPhone().isBlank()) {
                            nameToUse = req.getCustomerPhone();
                        } else {
                            nameToUse = "Cliente";
                        }
                        String uniqueName = generateUniqueClientName(nameToUse);
                        cliente = com.example.backendspring.client.Client.builder()
                                .nome(uniqueName)
                                .email(req.getCustomerEmail())
                                .telefone(req.getCustomerPhone())
                                .createdAt(java.time.OffsetDateTime.now())
                                .build();
                        clientRepository.save(cliente);
                    }
                    // associate the sale order with the client
                    if (cliente != null) {
                        venda.setCliente(cliente);
                    }
                }
            } catch (Exception e) {
                // ignore non-critical client save errors
            }

            // Associate sale to current open caixa session if present (obter com lock)
            com.example.backendspring.caixa.CaixaStatus caixaAtiva = null;
            try {
                var caixaAtivaOpt = caixaStatusRepository.findTopByAbertoTrueOrderByIdDesc();
                if (caixaAtivaOpt.isPresent()) {
                    caixaAtiva = caixaAtivaOpt.get();
                    venda.setCaixaStatus(caixaAtiva);
                }
            } catch (Exception e) {
                // Em caso de erro ao obter sessão com lock, continuar sem associação
                log.warn("Não foi possível associar venda à sessão de caixa: {}", e.getMessage());
            }

            // persistir venda, itens e pagamentos (pagamentos receberão referencia ao
            // caixa)
            saleOrderRepository.save(venda);

            addItemsToOrder(venda, req.getItens());
            // Se caixaAtiva foi obtido, preencher operador na venda e em pagamentos
            if (caixaAtiva != null) {
                try {
                    // usar userId (injetado via RequestAttribute) como fonte confiável do operador
                    if (userId != null) {
                        var op = userRepository.findById(userId).orElse(null);
                        if (op != null)
                            venda.setOperador(op);
                    }
                } catch (Exception ignored) {
                }
            }
            addPaymentsToOrder(venda, req.getPagamentos(), caixaAtiva);

            saleOrderRepository.save(venda);

            Map<String, Object> resp = buildResponse(venda);
            // Expor operador no payload de criação para facilitar verificação imediata
            resp.put("operador_username", venda.getOperador() != null ? venda.getOperador().getUsername() : null);
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

        // Try to find or create client and associate (avoid creating placeholder named
        // "Cliente")
        try {
            com.example.backendspring.client.Client cliente = null;
            String email = venda.getCustomerEmail();
            String phone = venda.getCustomerPhone();

            // lookup by email (case-insensitive) then phone
            if (email != null && !email.isBlank()) {
                try {
                    cliente = this.clientRepository.findByEmailIgnoreCase(email.trim().toLowerCase()).orElse(null);
                } catch (Exception ex) {
                    cliente = this.clientRepository.findByEmail(email).orElse(null);
                }
            }
            if (cliente == null && phone != null && !phone.isBlank()) {
                cliente = this.clientRepository.findByTelefone(phone).orElse(null);
            }

            if (cliente != null) {
                // Update existing client with any new info provided (including replacing
                // generic name)
                boolean changed = false;
                String providedName = venda.getCustomerName();
                if (providedName != null && !providedName.isBlank()) {
                    if (cliente.getNome() == null || cliente.getNome().isBlank()
                            || cliente.getNome().equalsIgnoreCase("Cliente")) {
                        cliente.setNome(providedName.trim());
                        changed = true;
                    }
                }
                if (email != null && !email.isBlank() && (cliente.getEmail() == null || cliente.getEmail().isBlank())) {
                    cliente.setEmail(email.trim());
                    changed = true;
                }
                if (phone != null && !phone.isBlank()
                        && (cliente.getTelefone() == null || cliente.getTelefone().isBlank())) {
                    cliente.setTelefone(phone.trim());
                    changed = true;
                }
                if (changed)
                    this.clientRepository.save(cliente);
                venda.setCliente(cliente);
            } else {
                // create new client only if we have some identifying info (name/email/phone)
                String baseName = null;
                if (venda.getCustomerName() != null && !venda.getCustomerName().isBlank()) {
                    baseName = venda.getCustomerName().trim();
                } else if (email != null && email.contains("@")) {
                    baseName = email.split("@")[0];
                } else if (phone != null && !phone.isBlank()) {
                    baseName = phone.trim();
                }
                if (baseName != null) {
                    String uniqueName = generateUniqueClientName(baseName);
                    cliente = com.example.backendspring.client.Client.builder()
                            .nome(uniqueName)
                            .email(email)
                            .telefone(phone)
                            .createdAt(java.time.OffsetDateTime.now())
                            .build();
                    this.clientRepository.save(cliente);
                    venda.setCliente(cliente);
                }
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

    @GetMapping("/{id}")
    @Transactional(readOnly = true)
    public ResponseEntity<Object> getOrderById(@PathVariable Long id) {
        var venda = saleOrderRepository.findById(id).orElse(null);
        if (venda == null) {
            return ResponseEntity.status(404).body(Map.of(KEY_ERROR, "Venda não encontrada"));
        }
        Map<String, Object> resp = buildResponse(venda);
        // expose operador username for convenience
        resp.put("operador_username", venda.getOperador() != null ? venda.getOperador().getUsername() : null);
        return ResponseEntity.ok(resp);
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

    private void addPaymentsToOrder(SaleOrder venda, List<CheckoutPayment> pagamentos,
            com.example.backendspring.caixa.CaixaStatus caixaAtiva) {
        for (CheckoutPayment p : pagamentos) {
            String metodo = p.getMetodo() == null ? DEFAULT_PAGAMENTO : p.getMetodo();
            SalePayment sp = SalePayment.builder()
                    .venda(venda)
                    .metodo(metodo)
                    .valor(p.getValor())
                    .troco(p.getTroco())
                    .build();
            if (caixaAtiva != null) {
                sp.setCaixaStatus(caixaAtiva);
            }
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

    // generate a name unique among clients by appending (2), (3), ... if needed
    private String generateUniqueClientName(String base) {
        String candidate = base;
        int suffix = 1;
        while (true) {
            boolean exists;
            try {
                exists = clientRepository.existsByNomeIgnoreCase(candidate);
            } catch (Exception e) {
                // fallback: assume not exists to avoid infinite loops
                exists = false;
            }
            if (!exists)
                return candidate;
            suffix++;
            candidate = base + " (" + suffix + ")";
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
        @JsonProperty("customerName")
        private String customerName;
        @JsonProperty("customerEmail")
        private String customerEmail;
        @JsonProperty("customerPhone")
        private String customerPhone;
    }
}
