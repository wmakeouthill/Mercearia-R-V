package com.example.backendspring.sale;

import com.example.backendspring.product.Product;
import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "vendas")
public class Sale {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "produto_id")
    private Product produto;

    @Column(name = "quantidade_vendida", nullable = false)
    private Integer quantidadeVendida;

    @Column(name = "preco_total", nullable = false)
    private Double precoTotal;

    @Column(name = "data_venda", nullable = false)
    private OffsetDateTime dataVenda;

    @Column(name = "metodo_pagamento", nullable = false)
    private String metodoPagamento; // dinheiro | cartao_credito | cartao_debito | pix
}
