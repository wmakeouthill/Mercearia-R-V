package com.example.backendspring.product;

import com.fasterxml.jackson.annotation.JsonProperty;
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
    @JsonProperty("codigo_barras")
    private String codigoBarras;

    @Column(name = "preco_venda", nullable = false)
    @JsonProperty("preco_venda")
    private Double precoVenda;

    @Column(name = "quantidade_estoque", nullable = false)
    @lombok.Builder.Default
    @JsonProperty("quantidade_estoque")
    private Integer quantidadeEstoque = 0;

    @Column
    private String imagem;
}
