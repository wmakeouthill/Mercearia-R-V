package com.example.backendspring.caixa;

import com.example.backendspring.user.User;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "caixa_movimentacoes")
public class CaixaMovimentacao {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String tipo; // entrada | retirada

    @Column(nullable = false)
    private Double valor;

    @Column(length = 255)
    private String descricao;

    @ManyToOne
    @JoinColumn(name = "usuario_id")
    private User usuario;

    // Se a movimentação foi gerada por uma venda, guardar o operador responsável
    @ManyToOne(optional = true)
    @JoinColumn(name = "operador_id")
    private User operador;

    // Vinculo opcional à sessão/estado do caixa
    @ManyToOne(optional = true)
    @JoinColumn(name = "caixa_status_id")
    private CaixaStatus caixaStatus;

    // Motivo/subtipo para retiradas ou entradas (ex: sangria, reembolso)
    private String motivo;

    // Usuario que aprovou a movimentacao (quando aplicavel)
    @ManyToOne(optional = true)
    @JoinColumn(name = "aprovado_por")
    private User aprovadoPor;

    @Column(name = "data_movimento", nullable = false)
    private OffsetDateTime dataMovimento;

    @Column(name = "criado_em")
    private OffsetDateTime criadoEm;

    @Column(name = "atualizado_em")
    private OffsetDateTime atualizadoEm;
}
