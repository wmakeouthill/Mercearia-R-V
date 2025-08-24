package com.example.backendspring.sale;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.util.List;

public interface SaleOrderRepository extends JpaRepository<SaleOrder, Long> {

    @Query(value = "SELECT * FROM venda_cabecalho WHERE (data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = :dia ORDER BY data_venda DESC", nativeQuery = true)
    List<SaleOrder> findByDia(@Param("dia") LocalDate dia);

    @Query(value = "SELECT * FROM venda_cabecalho WHERE (data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN :inicio AND :fim ORDER BY data_venda DESC", nativeQuery = true)
    List<SaleOrder> findByPeriodo(@Param("inicio") LocalDate inicio, @Param("fim") LocalDate fim);

    // pageable variants (no fetch-join to avoid MultipleBagFetchException)
    List<SaleOrder> findByClienteIdOrderByDataVendaDesc(Long clienteId, Pageable pageable);

    @Query("select so from SaleOrder so where so.cliente.id = :clienteId and function('date', so.dataVenda) between :inicio and :fim order by so.dataVenda desc")
    List<SaleOrder> findByClienteIdAndPeriodo(@Param("clienteId") Long clienteId, @Param("inicio") LocalDate inicio,
            @Param("fim") LocalDate fim, Pageable pageable);

    @Query("select so from SaleOrder so order by so.dataVenda desc")
    List<SaleOrder> findAllOrderByData();

    List<SaleOrder> findByClienteIdOrderByDataVendaDesc(Long clienteId);

    // Contador rápido para verificar existência de ordens por cliente
    long countByClienteId(Long clienteId);

    @Modifying
    @Transactional
    @Query("update SaleOrder so set so.cliente = null where so.cliente.id = :clienteId")
    void nullifyClienteById(@Param("clienteId") Long clienteId);
}
