package com.example.backendspring.product;

import jakarta.persistence.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "produtos")
public class Product {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String nome;

    @Column(name = "codigo_barras", unique = true)
    private String codigoBarras;

    @Column(name = "preco_venda", nullable = false)
    private Double precoVenda;

    @Column(name = "quantidade_estoque", nullable = false)
    @lombok.Builder.Default
    private Integer quantidadeEstoque = 0;

    @Column
    private String imagem;
}
