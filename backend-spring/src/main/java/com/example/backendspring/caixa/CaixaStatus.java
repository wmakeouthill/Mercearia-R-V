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
@Table(name = "status_caixa")
public class CaixaStatus {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    @lombok.Builder.Default
    private Boolean aberto = Boolean.FALSE;

    private String horarioAberturaObrigatorio;
    private String horarioFechamentoObrigatorio;

    @ManyToOne
    @JoinColumn(name = "aberto_por")
    private User abertoPor;

    @ManyToOne
    @JoinColumn(name = "fechado_por")
    private User fechadoPor;

    private OffsetDateTime dataAbertura;
    private OffsetDateTime dataFechamento;

    @Version
    private Long version;

    // Saldo inicial informado na abertura do caixa (float)
    private Double saldoInicial;

    // Saldo esperado calculado pelo sistema (vendas + entradas - retiradas)
    private Double saldoEsperado;

    // Saldo contado fisicamente no fechamento
    private Double saldoContado;

    // Variacao: saldoContado - saldoEsperado
    private Double variacao;

    // Identificador do terminal/caixa físico (opcional)
    private String terminalId;

    // Observacoes registradas no fechamento
    private String observacoesFechamento;

    @Column(name = "criado_em")
    @lombok.Builder.Default
    private OffsetDateTime criadoEm = null;

    @Column(name = "atualizado_em")
    @lombok.Builder.Default
    private OffsetDateTime atualizadoEm = null;
}
