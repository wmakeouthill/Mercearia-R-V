package com.example.backendspring.sale;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "sale_adjustments")
public class SaleAdjustment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = true)
    @JoinColumn(name = "sale_order_id")
    private SaleOrder saleOrder;

    @ManyToOne(optional = true)
    @JoinColumn(name = "sale_item_id")
    private SaleItem saleItem;

    @Column(name = "type")
    private String type; // return | exchange

    @Column(name = "quantity")
    private Integer quantity;

    @Column(name = "replacement_product_id")
    private Long replacementProductId;

    @Column(name = "price_difference")
    private Double priceDifference;

    @Column(name = "payment_method")
    private String paymentMethod;

    @Column(name = "operator_username")
    private String operatorUsername;

    @Column(name = "notes")
    private String notes;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}
