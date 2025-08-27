package com.example.backendspring.sale;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import com.example.backendspring.product.ProductRepository;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
public class SaleAdjustmentIntegrationTest {

    @Autowired
    private SaleOrderRepository saleOrderRepository;

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private SaleAdjustmentRepository saleAdjustmentRepository;

    @Test
    @Transactional
    void contextLoads() {
        assertThat(saleOrderRepository).isNotNull();
        assertThat(productRepository).isNotNull();
        assertThat(saleAdjustmentRepository).isNotNull();
    }
}
