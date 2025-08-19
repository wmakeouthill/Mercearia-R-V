package com.example.backendspring.sale;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface SaleOrderRepository extends JpaRepository<SaleOrder, Long> {

    @Query("select so from SaleOrder so left join fetch so.itens left join fetch so.pagamentos where function('date', so.dataVenda) = :dia order by so.dataVenda desc")
    List<SaleOrder> findByDia(@Param("dia") LocalDate dia);

    @Query("select so from SaleOrder so where function('date', so.dataVenda) between :inicio and :fim order by so.dataVenda desc")
    List<SaleOrder> findByPeriodo(@Param("inicio") LocalDate inicio, @Param("fim") LocalDate fim);

    @Query("select distinct so from SaleOrder so left join fetch so.itens left join fetch so.pagamentos order by so.dataVenda desc")
    List<SaleOrder> findAllOrderByData();

    List<SaleOrder> findByClienteIdOrderByDataVendaDesc(Long clienteId);
}
