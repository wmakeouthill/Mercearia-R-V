package com.example.backendspring.caixa;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.Optional;

public interface CaixaStatusRepository extends JpaRepository<CaixaStatus, Long> {
    Optional<CaixaStatus> findTopByOrderByIdDesc();

    // Busca a sessão aberta mais recente com lock pessimista para evitar
    // concorrência
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<CaixaStatus> findTopByAbertoTrueOrderByIdDesc();

    // Buscar por id com lock pessimista
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select cs from CaixaStatus cs where cs.id = :id")
    Optional<CaixaStatus> findByIdForUpdate(@Param("id") Long id);
}
