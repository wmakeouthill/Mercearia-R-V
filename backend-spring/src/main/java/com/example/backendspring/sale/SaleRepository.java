package com.example.backendspring.sale;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface SaleRepository extends JpaRepository<Sale, Long> {

    @Query(value = "SELECT COUNT(*) FROM vendas v WHERE DATE(v.data_venda) = :dia", nativeQuery = true)
    long countByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT COALESCE(SUM(v.quantidade_vendida),0) FROM vendas v WHERE DATE(v.data_venda) = :dia", nativeQuery = true)
    long somaQuantidadeByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT COALESCE(SUM(v.preco_total),0) FROM vendas v WHERE DATE(v.data_venda) = :dia", nativeQuery = true)
    double somaReceitaByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT * FROM vendas v WHERE DATE(v.data_venda) BETWEEN :inicio AND :fim ORDER BY v.data_venda DESC", nativeQuery = true)
    java.util.List<Sale> findByPeriodo(@Param("inicio") LocalDate inicio, @Param("fim") LocalDate fim);

    @Query(value = "SELECT * FROM vendas v WHERE DATE(v.data_venda) = :dia ORDER BY v.data_venda DESC", nativeQuery = true)
    List<Sale> findByDia(@Param("dia") LocalDate dia);
}
