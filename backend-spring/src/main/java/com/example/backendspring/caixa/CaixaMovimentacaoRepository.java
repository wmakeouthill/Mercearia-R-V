package com.example.backendspring.caixa;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface CaixaMovimentacaoRepository extends JpaRepository<CaixaMovimentacao, Long> {
    /*
     * Use explicit timezone normalization to 'America/Sao_Paulo' when comparing by
     * date to avoid mismatches caused by stored OffsetDateTime values.
     */
    @Query(value = "SELECT * FROM caixa_movimentacoes WHERE (data_movimento AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = :dia ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END),0) FROM caixa_movimentacoes WHERE (data_movimento AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = :dia", nativeQuery = true)
    Double saldoDoDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT * FROM caixa_movimentacoes WHERE (data_movimento AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN :inicio AND :fim ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findByPeriodo(@Param("inicio") LocalDate inicio, @Param("fim") LocalDate fim);

    @Query(value = "SELECT * FROM caixa_movimentacoes ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findAllOrderByData();

    @Query(value = "SELECT * FROM caixa_movimentacoes WHERE data_movimento BETWEEN :from AND :to ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findByPeriodoTimestamps(@Param("from") java.time.OffsetDateTime from,
            @Param("to") java.time.OffsetDateTime to);

    @Query(value = "SELECT * FROM caixa_movimentacoes WHERE caixa_status_id IS NULL AND (data_movimento AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = :dia ORDER BY data_movimento DESC", nativeQuery = true)
    List<CaixaMovimentacao> findByDiaUnassigned(@Param("dia") LocalDate dia);
}
