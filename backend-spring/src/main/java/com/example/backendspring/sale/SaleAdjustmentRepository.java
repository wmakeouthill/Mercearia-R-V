package com.example.backendspring.sale;

import org.springframework.data.jpa.repository.JpaRepository;

public interface SaleAdjustmentRepository extends JpaRepository<SaleAdjustment, Long> {
    java.util.List<SaleAdjustment> findBySaleOrderId(Long saleOrderId);

}
