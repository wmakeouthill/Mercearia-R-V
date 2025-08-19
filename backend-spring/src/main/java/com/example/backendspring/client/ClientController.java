package com.example.backendspring.client;

import com.example.backendspring.sale.Sale;
import com.example.backendspring.sale.SaleRepository;
import com.example.backendspring.sale.SaleOrderRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.data.domain.PageRequest;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/clientes")
@RequiredArgsConstructor
public class ClientController {
    private final ClientRepository clientRepository;
    private final SaleRepository saleRepository;
    private final SaleOrderRepository saleOrderRepository;

    @GetMapping
    public List<Client> list(@RequestParam(value = "q", required = false) String q) {
        if (q == null || q.isBlank()) {
            return clientRepository.findAll();
        }
        String term = q.toLowerCase();
        return clientRepository.findAll().stream()
                .filter(c -> (c.getNome() != null && c.getNome().toLowerCase().contains(term)) ||
                        (c.getEmail() != null && c.getEmail().toLowerCase().contains(term)) ||
                        (c.getTelefone() != null && c.getTelefone().toLowerCase().contains(term)))
                .toList();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Client> get(@PathVariable Long id) {
        return clientRepository.findById(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/vendas")
    public List<Sale> vendas(@PathVariable Long id,
            @RequestParam(value = "limit", required = false, defaultValue = "5") int limit) {
        // Return both legacy sales and checkout orders associated with this client
        var vendasLegado = saleRepository.findByClienteIdOrderByDataVendaDesc(id,
                PageRequest.of(0, Math.max(1, limit)));
        var ordens = saleOrderRepository.findByClienteIdOrderByDataVendaDesc(id);
        // Map SaleOrder to a simplified Sale-like DTO (id, preco_total, data_venda)
        var mappedOrdens = ordens.stream().map(o -> {
            Sale s = new Sale();
            s.setId(o.getId());
            s.setPrecoTotal(o.getTotalFinal());
            s.setDataVenda(o.getDataVenda());
            return s;
        }).toList();
        var merged = new java.util.ArrayList<Sale>();
        merged.addAll(vendasLegado);
        merged.addAll(mappedOrdens);
        // sort by data desc
        merged.sort((a, b) -> b.getDataVenda().compareTo(a.getDataVenda()));
        return merged.stream().limit(Math.max(1, limit)).toList();
    }

    @PostMapping
    public Client create(@RequestBody Client payload) {
        payload.setCreatedAt(OffsetDateTime.now());
        return clientRepository.save(payload);
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
