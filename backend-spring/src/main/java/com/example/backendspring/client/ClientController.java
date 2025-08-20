package com.example.backendspring.client;

// removed unused import Sale
import com.example.backendspring.sale.SaleRepository;
import com.example.backendspring.sale.SaleOrderRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.OffsetDateTime;

@RestController
@RequestMapping("/api/clientes")
@RequiredArgsConstructor
public class ClientController {
    private static final Logger logger = LoggerFactory.getLogger(ClientController.class);
    private final ClientRepository clientRepository;
    private final SaleRepository saleRepository;
    private final SaleOrderRepository saleOrderRepository;

    @GetMapping
    public ResponseEntity<java.util.Map<String, Object>> list(
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "page", required = false, defaultValue = "0") int page,
            @RequestParam(value = "size", required = false, defaultValue = "20") int size) {
        if (q != null && !q.isBlank()) {
            String term = q.toLowerCase();
            var filtered = clientRepository.findAll().stream()
                    .filter(c -> (c.getNome() != null && c.getNome().toLowerCase().contains(term)) ||
                            (c.getEmail() != null && c.getEmail().toLowerCase().contains(term)) ||
                            (c.getTelefone() != null && c.getTelefone().toLowerCase().contains(term)))
                    .toList();
            return ResponseEntity.ok(java.util.Map.of("items", filtered, "total", filtered.size(), "hasNext", false,
                    "page", 0, "size", filtered.size()));
        }
        var pg = clientRepository.findAll(org.springframework.data.domain.PageRequest.of(page, size));
        var items = pg.getContent();
        var resp = new java.util.LinkedHashMap<String, Object>();
        resp.put("items", items);
        resp.put("total", pg.getTotalElements());
        resp.put("hasNext", pg.hasNext());
        resp.put("page", pg.getNumber());
        resp.put("size", pg.getSize());
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Client> get(@PathVariable Long id) {
        return clientRepository.findById(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/vendas")
    @Transactional(readOnly = true)
    public ResponseEntity<Object> vendas(@PathVariable Long id,
            @RequestParam(value = "page", required = false, defaultValue = "0") int page,
            @RequestParam(value = "size", required = false, defaultValue = "50") int size,
            @RequestParam(value = "from", required = false) String from,
            @RequestParam(value = "to", required = false) String to,
            @RequestParam(value = "limit", required = false) Integer limit) {
        java.time.LocalDate inicio = null;
        java.time.LocalDate fim = null;
        if (from != null && !from.isBlank()) {
            try {
                inicio = java.time.LocalDate.parse(from);
            } catch (Exception ignored) {
                inicio = null;
            }
        }
        if (to != null && !to.isBlank()) {
            try {
                fim = java.time.LocalDate.parse(to);
            } catch (Exception ignored) {
                fim = null;
            }
        }

        java.util.List<com.example.backendspring.sale.Sale> vendasLegado = new java.util.ArrayList<>();
        java.util.List<com.example.backendspring.sale.SaleOrder> ordens = new java.util.ArrayList<>();

        if (inicio != null && fim != null) {
            // Period filter: load matching legacy sales and orders for the period
            var tmpLegado = saleRepository.findByPeriodo(inicio, fim).stream()
                    .filter(s -> s.getCliente() != null && s.getCliente().getId() != null
                            && s.getCliente().getId().equals(id))
                    .sorted((a, b) -> b.getDataVenda().compareTo(a.getDataVenda()))
                    .toList();
            vendasLegado.addAll(tmpLegado);
            // sale orders - use pageable variant to limit DB work
            ordens = saleOrderRepository.findByClienteIdAndPeriodo(id, inicio, fim,
                    PageRequest.of(0, Integer.MAX_VALUE));
        } else {
            // No period: use pageable queries for both repositories
            var pr = PageRequest.of(page, size);
            var pageResult = saleRepository.findByClienteIdOrderByDataVendaDesc(id, pr);
            vendasLegado = pageResult != null && pageResult.hasContent() ? pageResult.getContent()
                    : java.util.Collections.emptyList();
            ordens = saleOrderRepository.findByClienteIdOrderByDataVendaDesc(id, pr);
        }

        java.util.List<java.util.Map<String, Object>> merged = new java.util.ArrayList<>();
        vendasLegado.forEach(s -> merged.add(mapLegacySale(s)));
        ordens.forEach(o -> merged.add(mapSaleOrder(o)));

        // sort by data desc
        merged.sort((a, b) -> {
            var da = (java.time.OffsetDateTime) a.get("data_venda");
            var db = (java.time.OffsetDateTime) b.get("data_venda");
            return db.compareTo(da);
        });
        // if a 'limit' param was provided, return a plain list limited to that value
        // (used by frontend)
        if (limit != null) {
            int upto = Math.max(0, Math.min(limit, merged.size()));
            return ResponseEntity.ok(merged.subList(0, upto));
        }

        // pagination: compute total and slice for requested page/size
        final int total = merged.size();
        final int fromIndex = Math.max(0, Math.min(total, page * size));
        final int toIndex = Math.max(fromIndex, Math.min(total, fromIndex + size));
        final java.util.List<java.util.Map<String, Object>> pageItems = merged.subList(fromIndex, toIndex);

        var resp = new java.util.LinkedHashMap<String, Object>();
        resp.put("items", pageItems);
        resp.put("total", total);
        resp.put("hasNext", toIndex < total);
        resp.put("page", page);
        resp.put("size", size);
        return ResponseEntity.ok(resp);
    }

    private java.util.Map<String, Object> mapLegacySale(com.example.backendspring.sale.Sale s) {
        var m = new java.util.LinkedHashMap<String, Object>();
        m.put("id", s.getId());
        m.put("preco_total", s.getPrecoTotal());
        m.put("data_venda", s.getDataVenda());
        m.put("tipo", "legado");
        m.put("quantidade_vendida", s.getQuantidadeVendida());
        if (s.getProduto() != null) {
            m.put("produto_id", s.getProduto().getId());
            m.put("produto_nome", s.getProduto().getNome());
            m.put("produto_imagem", s.getProduto().getImagem());
        }
        // Normalize to include itens array so frontend can display products uniformly
        var itens = new java.util.ArrayList<java.util.Map<String, Object>>();
        var it = new java.util.LinkedHashMap<String, Object>();
        it.put("id", null);
        it.put("produto_id", s.getProduto() != null ? s.getProduto().getId() : null);
        it.put("produto_nome", s.getProduto() != null ? s.getProduto().getNome() : null);
        it.put("produto_imagem", s.getProduto() != null ? s.getProduto().getImagem() : null);
        it.put("quantidade", s.getQuantidadeVendida());
        it.put("preco_unitario", null);
        it.put("preco_total", s.getPrecoTotal());
        itens.add(it);
        m.put("itens", itens);
        return m;
    }

    private java.util.Map<String, Object> mapSaleOrder(com.example.backendspring.sale.SaleOrder o) {
        var m = new java.util.LinkedHashMap<String, Object>();
        m.put("id", o.getId());
        m.put("preco_total", o.getTotalFinal());
        m.put("data_venda", o.getDataVenda());
        m.put("tipo", "order");
        m.put("subtotal", o.getSubtotal());
        m.put("desconto", o.getDesconto());
        m.put("acrescimo", o.getAcrescimo());
        m.put("customer_name", o.getCustomerName());
        m.put("customer_email", o.getCustomerEmail());
        m.put("customer_phone", o.getCustomerPhone());
        var itens = o.getItens().stream().map(it -> {
            var im = new java.util.LinkedHashMap<String, Object>();
            im.put("id", it.getId());
            im.put("produto_id", it.getProduto() != null ? it.getProduto().getId() : null);
            im.put("produto_nome", it.getProduto() != null ? it.getProduto().getNome() : null);
            im.put("produto_imagem", it.getProduto() != null ? it.getProduto().getImagem() : null);
            im.put("quantidade", it.getQuantidade());
            im.put("preco_unitario", it.getPrecoUnitario());
            im.put("preco_total", it.getPrecoTotal());
            return im;
        }).toList();
        m.put("itens", itens);
        return m;
    }

    @PostMapping
    public Client create(@RequestBody Client payload) {
        payload.setCreatedAt(OffsetDateTime.now());
        return clientRepository.save(payload);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<java.util.Map<String, Object>> delete(@PathVariable Long id) {
        if (!clientRepository.existsById(id))
            return ResponseEntity.status(404).body(java.util.Map.of("error", "Cliente não encontrado"));

        // Prevent deletion if there are related sales/orders to avoid FK constraint
        // errors
        try {
            // Nullify FK on sales/orders referencing this client, then delete client
            logger.debug("Nullifying client FK for id {}", id);
            saleRepository.nullifyClienteById(id);
            saleOrderRepository.nullifyClienteById(id);

            clientRepository.deleteById(id);
            logger.info("Cliente {} deletado com sucesso", id);
            return ResponseEntity.ok(java.util.Map.of("message", "Cliente deletado"));
        } catch (DataIntegrityViolationException dive) {
            logger.error("DataIntegrityViolation while deleting client {}", id, dive);
            return ResponseEntity.status(500)
                    .body(java.util.Map.of("error", "Erro ao deletar cliente: violação de integridade referencial"));
        } catch (Exception ex) {
            logger.error("Unexpected error while deleting client {}", id, ex);
            // include details to help debugging
            return ResponseEntity.status(500)
                    .body(java.util.Map.of("error", "Erro interno ao deletar cliente", "details", ex.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<Client> update(@PathVariable Long id, @RequestBody Client payload) {
        return clientRepository.findById(id).map(existing -> {
            if (payload.getNome() != null)
                existing.setNome(payload.getNome());
            existing.setEmail(payload.getEmail());
            existing.setTelefone(payload.getTelefone());
            existing.setDocumento(payload.getDocumento());
            clientRepository.save(existing);
            return ResponseEntity.ok(existing);
        }).orElse(ResponseEntity.notFound().build());
    }
}
