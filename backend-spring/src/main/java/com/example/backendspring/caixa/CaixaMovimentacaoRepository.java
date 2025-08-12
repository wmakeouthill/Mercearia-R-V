package com.example.backendspring.caixa;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface CaixaMovimentacaoRepository extends JpaRepository<CaixaMovimentacao, Long> {
    @Query(value = "SELECT * FROM caixa_movimentacoes WHERE DATE(data_movimento) = :dia ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END),0) FROM caixa_movimentacoes WHERE DATE(data_movimento) = :dia", nativeQuery = true)
    Double saldoDoDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT * FROM caixa_movimentacoes WHERE DATE(data_movimento) BETWEEN :inicio AND :fim ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findByPeriodo(@Param("inicio") LocalDate inicio, @Param("fim") LocalDate fim);

    @Query(value = "SELECT * FROM caixa_movimentacoes ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findAllOrderByData();
}
