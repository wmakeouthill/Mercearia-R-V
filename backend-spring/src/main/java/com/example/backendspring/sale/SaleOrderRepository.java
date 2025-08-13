package com.example.backendspring.sale;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface SaleOrderRepository extends JpaRepository<SaleOrder, Long> {

    @Query(value = "SELECT * FROM venda_cabecalho WHERE DATE(data_venda) = :dia ORDER BY data_venda DESC", nativeQuery = true)
    List<SaleOrder> findByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT * FROM venda_cabecalho WHERE DATE(data_venda) BETWEEN :inicio AND :fim ORDER BY data_venda DESC", nativeQuery = true)
    List<SaleOrder> findByPeriodo(@Param("inicio") LocalDate inicio, @Param("fim") LocalDate fim);

    @Query(value = "SELECT * FROM venda_cabecalho ORDER BY data_venda DESC", nativeQuery = true)
    List<SaleOrder> findAllOrderByData();
}
