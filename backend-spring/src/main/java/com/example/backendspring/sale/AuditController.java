package com.example.backendspring.sale;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Collections;

@RestController
@RequestMapping("/api/audit")
@RequiredArgsConstructor
public class AuditController {

    private static final Logger log = LoggerFactory.getLogger(AuditController.class);
    private final SaleDeletionRepository saleDeletionRepository;

    @GetMapping("/sales")
    public ResponseEntity<List<Map<String, Object>>> listDeletedSales() {
        try {
            List<Map<String, Object>> list = saleDeletionRepository.findAll().stream()
                    .sorted((a, b) -> b.getDeletedAt().compareTo(a.getDeletedAt()))
                    .map(sd -> {
                        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                        m.put("id", sd.getId());
                        m.put("saleId", sd.getSaleId());
                        m.put("saleType", sd.getSaleType());
                        m.put("payload", sd.getPayload());
                        m.put("deletedBy", sd.getDeletedBy());
                        m.put("deletedAt", sd.getDeletedAt());
                        return m;
                    }).toList();
            return ResponseEntity.ok(list);
        } catch (Exception e) {
            // If audit table missing or other DB error occurs, don't return 500 to client;
            // log and return empty list
            log.warn("Failed to load audit sales: {}", e.getMessage());
            return ResponseEntity.ok(Collections.emptyList());
        }
    }
}
