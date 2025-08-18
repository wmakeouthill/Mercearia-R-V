package com.example.backendspring.sale;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "venda_cabecalho")
public class SaleOrder {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "data_venda", nullable = false)
    private OffsetDateTime dataVenda;

    @Column(name = "subtotal", nullable = false)
    private Double subtotal;

    @Column(name = "desconto", nullable = false)
    private Double desconto;

    @Column(name = "acrescimo", nullable = false)
    private Double acrescimo;

    @Column(name = "total_final", nullable = false)
    private Double totalFinal;

    // Customer contact fields (optional)
    @Column(name = "customer_name")
    private String customerName;

    @Column(name = "customer_email")
    private String customerEmail;

    @Column(name = "customer_phone")
    private String customerPhone;

    @OneToMany(mappedBy = "venda", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<SaleItem> itens = new ArrayList<>();

    @OneToMany(mappedBy = "venda", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<SalePayment> pagamentos = new ArrayList<>();
}
