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

    // Optional net/adjusted total after adjustments (can be null when no
    // adjustments)
    @Column(name = "adjusted_total")
    private Double adjustedTotal;

    // Customer contact fields (optional)
    @Column(name = "customer_name")
    private String customerName;

    @Column(name = "customer_email")
    private String customerEmail;

    @Column(name = "customer_phone")
    private String customerPhone;

    @ManyToOne(optional = true)
    @JoinColumn(name = "cliente_id")
    private com.example.backendspring.client.Client cliente;

    // Usuario/operador que realizou a venda (opcional)
    @ManyToOne(optional = true)
    @JoinColumn(name = "operador_id")
    private com.example.backendspring.user.User operador;

    @OneToMany(mappedBy = "venda", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<SaleItem> itens = new ArrayList<>();

    @OneToMany(mappedBy = "venda", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<SalePayment> pagamentos = new ArrayList<>();

    // Vinculo opcional à sessao/estado do caixa em que a venda foi registrada
    @ManyToOne(optional = true)
    @JoinColumn(name = "caixa_status_id")
    private com.example.backendspring.caixa.CaixaStatus caixaStatus;

    // optional status to indicate adjustments: e.g. 'DEVOLVIDA', 'TROCADA'
    @Column(name = "status")
    private String status;
}
