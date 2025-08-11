package com.example.backendspring.sale;

import jakarta.persistence.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "venda_pagamentos")
public class SalePayment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "venda_id")
    private SaleOrder venda;

    @Column(name = "metodo", nullable = false)
    private String metodo; // dinheiro | cartao_credito | cartao_debito | pix

    @Column(name = "valor", nullable = false)
    private Double valor;

    @Column(name = "troco")
    private Double troco;
}
